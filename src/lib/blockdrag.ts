import type { Action } from 'svelte/action';
import type { Connectable } from './types';
import { BLOCK_MIME, blockDragFor, createBlockDragPreview, dnd, type DragSource } from './dnd.svelte';

// macOS can suppress native drop events while Command is held. Track internal block
// gestures with pointers and reuse the existing drop-target protocol instead.
export const blockdrag: Action<HTMLElement, { item: Connectable; source: DragSource }> = (node, params) => {
	let current = params;
	let pointer: number | null = null;
	let startX = 0, startY = 0, x = 0, y = 0;
	let transfer: DataTransfer | null = null;
	let preview: HTMLElement | null = null;
	let hit: Element | null = null;
	let modifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	let savedStyle: { userSelect: string; cursor: string } | null = null;
	let clickTimer: ReturnType<typeof setTimeout> | undefined;

	function prevent(e: Event) {
		e.preventDefault();
		e.stopPropagation();
	}

	function stopClick(e: Event) {
		prevent(e);
		e.stopImmediatePropagation();
		clearClick();
	}

	function clearClick() {
		clearTimeout(clickTimer);
		clickTimer = undefined;
		window.removeEventListener('click', stopClick, true);
	}

	function send(type: string, target: Element, relatedTarget: Element | null = null) {
		target.dispatchEvent(new DragEvent(type, {
			bubbles: true, cancelable: true, dataTransfer: transfer,
			clientX: x, clientY: y, relatedTarget, ...modifiers
		}));
	}

	function hover() {
		const next = document.elementFromPoint(x, y);
		if (hit !== next) {
			if (hit) send('dragleave', hit, next);
			hit = next;
		}
		dnd.updateModifiers(modifiers);
		document.body.style.cursor = dnd.copy ? 'copy' : 'move';
		if (hit) send('dragover', hit);
		else dnd.over = null;
		if (preview) {
			preview.style.left = `${x + 12}px`;
			preview.style.top = `${y + 12}px`;
		}
	}

	function setModifiers(e: MouseEvent | KeyboardEvent) {
		modifiers = { metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey };
	}

	function finish(drop = false) {
		const active = transfer !== null;
		pointer = null;
		window.removeEventListener('pointermove', move, true);
		window.removeEventListener('pointerup', up, true);
		window.removeEventListener('pointercancel', cancel, true);
		window.removeEventListener('keydown', key, true);
		window.removeEventListener('keyup', key, true);
		window.removeEventListener('blur', cancel, true);
		// Only the release position is eligible; never fall back to the last hovered target.
		try {
			if (active && drop) {
				const target = document.elementFromPoint(x, y);
				if (target) send('drop', target);
			}
		} finally {
			if (active && hit) send('dragleave', hit);
			hit = null;
			transfer = null;
			preview?.remove();
			preview = null;
			if (savedStyle) Object.assign(document.body.style, savedStyle);
			savedStyle = null;
			if (active) dnd.reset();
			// Browsers dispatch the compatibility click immediately after pointerup.
			if (active && drop) clickTimer = setTimeout(clearClick, 0);
			else if (active || clickTimer === undefined) clearClick();
		}
	}

	function move(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		x = e.clientX;
		y = e.clientY;
		setModifiers(e);
		if (!transfer) {
			if (Math.hypot(x - startX, y - startY) < 6) return;
			const payload = blockDragFor(current.item, current.source);
			if (!payload) { finish(); return; }
			transfer = new DataTransfer();
			transfer.setData(BLOCK_MIME, JSON.stringify(payload));
			transfer.effectAllowed = 'copyMove';
			dnd.current = payload;
			savedStyle = { userSelect: document.body.style.userSelect, cursor: document.body.style.cursor };
			document.body.style.userSelect = 'none';
			preview = createBlockDragPreview(node);
			if (preview) document.body.appendChild(preview);
			window.addEventListener('click', stopClick, true);
		}
		e.preventDefault();
		hover();
	}

	function up(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		x = e.clientX;
		y = e.clientY;
		setModifiers(e);
		if (transfer) {
			e.preventDefault();
			dnd.updateModifiers(modifiers);
		}
		finish(true);
	}

	function cancel(e: Event) {
		if (e instanceof PointerEvent && e.pointerId !== pointer) return;
		finish();
	}

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (transfer) prevent(e);
			finish();
		} else if (transfer) {
			setModifiers(e);
			hover();
		}
	}

	function down(e: PointerEvent) {
		if (pointer !== null || e.button !== 0 || !e.isPrimary || e.pointerType !== 'mouse') return;
		const target = e.target instanceof Element ? e.target : null;
		if (!target || target.closest('input, textarea, select, option, a, [contenteditable]:not([contenteditable="false"]), .download, .hover-actions')) return;
		const button = target.closest('button, [role="button"]');
		if (button && !button.matches('.tile, .name, .thumbnail')) return;
		clearClick();
		pointer = e.pointerId;
		startX = x = e.clientX;
		startY = y = e.clientY;
		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', cancel, true);
		window.addEventListener('keydown', key, true);
		window.addEventListener('keyup', key, true);
		window.addEventListener('blur', cancel, true);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('dragstart', prevent, true);
	return {
		update(next) { current = next; },
		destroy() {
			finish();
			// A successful move may unmount its source before the compatibility click.
			if (clickTimer === undefined) clearClick();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('dragstart', prevent, true);
		}
	};
};
