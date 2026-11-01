import type { Action } from 'svelte/action';

type Selection = {
	selected: number[];
	onselect: (ids: number[]) => void;
	onmarquee?: (active: boolean) => void;
	key: string;
};

const excluded = '[data-selection-item], [data-block-id], a, button, input, textarea, select, [contenteditable], thead';
const editable = 'input, textarea, select, [contenteditable]';

export const blockselection: Action<HTMLElement, Selection> = (node, params) => {
	let current = params;
	let selected = [...params.selected];
	let original: number[] = [];
	let pointer: number | null = null;
	let additive = false;
	let startX = 0, startY = 0, anchorX = 0, anchorY = 0, x = 0, y = 0;
	let overlay: HTMLElement | null = null;
	let userSelect: string | null = null;
	let frame: number | null = null;
	let lastFrame: number | null = null;
	let clickTimer: ReturnType<typeof setTimeout> | undefined;
	let clickBlock: Element | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let touch: { block: Element; id: number; held: boolean; toggle: boolean } | null = null;
	const callout = node.style.getPropertyValue('-webkit-touch-callout');
	const calloutPriority = node.style.getPropertyPriority('-webkit-touch-callout');
	node.style.setProperty('-webkit-touch-callout', 'none');

	function publish(ids: number[]) {
		if (ids.length === selected.length && ids.every((id, i) => id === selected[i])) return;
		selected = [...ids];
		current.onselect([...ids]);
	}

	function viewport() {
		const rect = node.getBoundingClientRect();
		const left = rect.left + node.clientLeft, top = rect.top + node.clientTop;
		return { left, top, right: left + node.clientWidth, bottom: top + node.clientHeight };
	}

	function clearClick() {
		clearTimeout(clickTimer);
		clickTimer = undefined;
		clickBlock = null;
		window.removeEventListener('click', stopClick, true);
	}

	function stopClick(e: Event) {
		if (clickBlock && (!(e.target instanceof Element) || e.target.closest('[data-block-id]') !== clickBlock)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		clearClick();
	}

	function render() {
		if (!overlay) return;
		const view = viewport();
		const ax = view.left + anchorX - node.scrollLeft;
		const ay = view.top + anchorY - node.scrollTop;
		const left = Math.min(ax, x), top = Math.min(ay, y);
		const right = Math.max(ax, x), bottom = Math.max(ay, y);
		Object.assign(overlay.style, {
			left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`
		});
		const ids = new Set<number>(additive ? original : []);
		for (const item of node.querySelectorAll<HTMLElement>('[data-block-id]')) {
			const raw = item.getAttribute('data-block-id');
			if (!raw?.trim()) continue;
			const id = Number(raw);
			if (!Number.isFinite(id)) continue;
			const rect = item.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0 && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) ids.add(id);
		}
		publish([...ids]);
	}

	function velocity() {
		const view = viewport();
		const speed = (position: number, low: number, high: number, scroll: number, max: number) => {
			if (position < low + 32 && scroll > 0) return -600 * Math.min(1, (low + 32 - position) / 32);
			if (position > high - 32 && scroll < max) return 600 * Math.min(1, (position - high + 32) / 32);
			return 0;
		};
		return {
			x: speed(x, view.left, view.right, node.scrollLeft, node.scrollWidth - node.clientWidth),
			y: speed(y, view.top, view.bottom, node.scrollTop, node.scrollHeight - node.clientHeight)
		};
	}

	function queueScroll() {
		if (!overlay || frame !== null) return;
		const speed = velocity();
		if (speed.x || speed.y) frame = window.requestAnimationFrame(autoScroll);
		else lastFrame = null;
	}

	function autoScroll(time: number) {
		frame = null;
		if (!overlay) return;
		const speed = velocity();
		const elapsed = lastFrame === null ? 16 : Math.max(0, Math.min(32, time - lastFrame));
		lastFrame = time;
		node.scrollLeft = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, node.scrollLeft + speed.x * elapsed / 1000));
		node.scrollTop = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, node.scrollTop + speed.y * elapsed / 1000));
		render();
		queueScroll();
	}

	function touchScroll() {
		if (touch && !touch.held) finish();
	}

	function contextmenu(e: Event) {
		if (touch && e.target instanceof Element && e.target.closest('[data-block-id]') === touch.block) e.preventDefault();
	}

	function scroll() {
		render();
		queueScroll();
	}

	function finish(restore = false, suppressClick = false) {
		const active = overlay !== null;
		const block = touch?.block ?? null;
		clearTimeout(holdTimer);
		holdTimer = undefined;
		touch = null;
		pointer = null;
		window.removeEventListener('pointermove', move, true);
		window.removeEventListener('pointerup', up, true);
		window.removeEventListener('pointercancel', cancel, true);
		window.removeEventListener('blur', cancel, true);
		node.removeEventListener('scroll', scroll);
		window.removeEventListener('scroll', touchScroll, true);
		if (frame !== null) window.cancelAnimationFrame(frame);
		frame = lastFrame = null;
		overlay?.remove();
		overlay = null;
		if (userSelect !== null) document.body.style.userSelect = userSelect;
		userSelect = null;
		clearClick();
		if ((active || block) && suppressClick) {
			// Touch compatibility clicks can be delayed; only consume the touched block's click.
			clickBlock = block;
			window.addEventListener('click', stopClick, true);
			clickTimer = setTimeout(clearClick, block ? 700 : 0);
		}
		if (restore) publish(original);
		if (active) current.onmarquee?.(false);
	}

	function move(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		x = e.clientX;
		y = e.clientY;
		if (touch) {
			if (!touch.held && Math.hypot(x - startX, y - startY) > 10) finish();
			return;
		}
		if (!overlay) {
			if (Math.hypot(x - startX, y - startY) < 5) return;
			overlay = document.createElement('div');
			Object.assign(overlay.style, {
				position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box',
				background: 'rgba(128,128,128,.18)', border: '1px solid rgba(96,96,96,.65)', zIndex: '2147483647'
			});
			document.body.appendChild(overlay);
			userSelect = document.body.style.userSelect;
			document.body.style.userSelect = 'none';
			current.onmarquee?.(true);
		}
		e.preventDefault();
		render();
		queueScroll();
	}

	function up(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		if (touch) {
			const { id, held, toggle } = touch;
			const select = held || (toggle && Math.hypot(e.clientX - startX, e.clientY - startY) <= 10);
			if (select) {
				e.preventDefault();
				if (!held) publish(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
			}
			finish(false, select);
			return;
		}
		if (overlay) {
			x = e.clientX;
			y = e.clientY;
			e.preventDefault();
			render();
		} else if (!additive) publish([]);
		finish(false, true);
	}

	function cancel(e: Event) {
		if (e.type === 'pointercancel' && (e as PointerEvent).pointerId !== pointer) return;
		finish(true);
	}

	function key(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
				if (e.target instanceof Element && e.target.closest('dialog[open]')) return;
		if (pointer !== null) {
			e.preventDefault();
			e.stopPropagation();
			finish(true);
		} else {
			const target = e.target instanceof Element ? e.target : document.activeElement;
			if (target?.closest(editable) || !selected.length) return;
			e.preventDefault();
			publish([]);
		}
	}

	function down(e: PointerEvent) {
		if (pointer !== null || e.button !== 0 || !e.isPrimary) return;
		const target = e.target instanceof Element ? e.target : null;
		if (!target) return;
		if (e.pointerType === 'touch' || e.pointerType === 'pen') {
			clearClick();
			const block = target.closest('[data-block-id]');
			const control = target.closest('a, button, input, textarea, select, [contenteditable]');
			if (!block || !node.contains(block) || (control && !control.matches('button.tile, button.thumbnail, button.name'))) return;
			const raw = block.getAttribute('data-block-id');
			if (!raw?.trim() || !Number.isFinite(Number(raw))) return;
			touch = { block, id: Number(raw), held: false, toggle: selected.length > 0 };
		} else if (e.pointerType !== 'mouse' || target.closest(excluded)) return;
		// Client dimensions exclude borders and scrollbar gutters (including left-side scrollbars).
		for (let element: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement; !touch && element; element = element.parentElement) {
			if (element === node || element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
				const rect = element.getBoundingClientRect();
				const left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
				if (e.clientX < left || e.clientX >= left + element.clientWidth || e.clientY < top || e.clientY >= top + element.clientHeight) return;
			}
			if (element === node) break;
		}
		clearClick();
		pointer = e.pointerId;
		original = [...selected];
		additive = e.shiftKey || e.metaKey || e.ctrlKey;
		startX = x = e.clientX;
		startY = y = e.clientY;
		if (touch) {
			holdTimer = setTimeout(() => {
				holdTimer = undefined;
				if (!touch) return;
				touch.held = true;
				publish(selected.includes(touch.id) ? selected : [...selected, touch.id]);
			}, 500);
			window.addEventListener('scroll', touchScroll, true);
		}
		const view = viewport();
		anchorX = x - view.left + node.scrollLeft;
		anchorY = y - view.top + node.scrollTop;
		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', cancel, true);
		window.addEventListener('blur', cancel, true);
		if (!touch) node.addEventListener('scroll', scroll);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('contextmenu', contextmenu, true);
	window.addEventListener('keydown', key, true);
	return {
		update(next) {
			const changed = next.key !== current.key;
			current = next;
			selected = [...next.selected];
			if (changed) {
				finish();
				// A new channel/view must clear even if its supplied selection is already empty.
				selected = [];
				current.onselect([]);
			}
		},
		destroy() {
			finish(pointer !== null);
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('contextmenu', contextmenu, true);
			if (callout) node.style.setProperty('-webkit-touch-callout', callout, calloutPriority);
			else node.style.removeProperty('-webkit-touch-callout');
			window.removeEventListener('keydown', key, true);
		}
	};
};
