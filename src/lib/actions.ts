import type { Action } from 'svelte/action';
import { dnd, dragKind } from './dnd.svelte';

type DragKind = NonNullable<ReturnType<typeof dragKind>>;

interface DropTargetParams {
	/** Unique key; `dnd.over` equals this while a droppable drag is over the node. */
	key: string;
	/** Whether this target takes the current drag. Called on every dragover, so keep it cheap. */
	accepts: (kind: DragKind) => boolean;
	/** Runs synchronously inside the drop event (DataTransfer is cleared once it returns). */
	ondrop: (e: DragEvent, kind: DragKind) => void;
	/** Fires once if a drag lingers over the node (used to auto-expand folders). */
	onhold?: () => void;
}

const HOLD_MS = 650;

/** Makes an element a drop target for Seeds blocks/folders and for things dragged in from outside. */
export const droptarget: Action<HTMLElement, DropTargetParams> = (node, params) => {
	let current = params;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const clearHold = () => {
		clearTimeout(timer);
		timer = undefined;
	};

	const onover = (e: DragEvent) => {
		const kind = dragKind(e);
		dnd.updateModifiers(e);
		if (!kind || !current.accepts(kind)) {
			// Stopped accepting mid-drag (e.g. a collapsed section that just opened): drop the highlight.
			if (dnd.over === current.key) dnd.over = null;
			return;
		}
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = kind === 'external' || (kind === 'block' && e.metaKey) ? 'copy' : 'move';
		dnd.over = current.key;
		if (current.onhold && timer === undefined) {
			timer = setTimeout(() => current.onhold?.(), HOLD_MS);
		}
	};

	const onleave = (e: DragEvent) => {
		if (e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return;
		clearHold();
		if (dnd.over === current.key) dnd.over = null;
	};

	const ondrop = (e: DragEvent) => {
		const kind = dragKind(e);
		if (!kind || !current.accepts(kind)) return;
		e.preventDefault();
		clearHold();
		dnd.over = null;
		current.ondrop(e, kind);
		dnd.reset();
	};

	node.addEventListener('dragover', onover);
	node.addEventListener('dragleave', onleave);
	node.addEventListener('drop', ondrop);

	return {
		update(next) {
			current = next;
		},
		destroy() {
			clearHold();
			node.removeEventListener('dragover', onover);
			node.removeEventListener('dragleave', onleave);
			node.removeEventListener('drop', ondrop);
		}
	};
};

interface InviewParams {
	/** Called whenever the node is (or becomes) visible. */
	onVisible: () => void;
	/** Change this value to force a re-check even if visibility didn't change. */
	key?: unknown;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if (overflowY === 'auto' || overflowY === 'scroll') return el;
	}
	return null;
}

/**
 * Infinite-scroll sentinel. IntersectionObserver only reports *changes*, so when
 * `key` changes we re-observe, which delivers a fresh initial notification. That
 * keeps loading pages until the sentinel is pushed out of view.
 */
export const inview: Action<HTMLElement, InviewParams> = (node, params) => {
	let current = params;
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((e) => e.isIntersecting)) current.onVisible();
		},
		{ root: scrollParent(node), rootMargin: '0px 0px 900px 0px' }
	);
	observer.observe(node);

	return {
		update(next) {
			const changed = next.key !== current.key;
			current = next;
			if (changed) {
				observer.unobserve(node);
				observer.observe(node);
			}
		},
		destroy() {
			observer.disconnect();
		}
	};
};
