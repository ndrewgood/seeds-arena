import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/blockselection.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
});
const { blockselection } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

class MockEvent {
	constructor(type, options = {}) {
		Object.assign(this, {
			type, bubbles: true, cancelable: true, defaultPrevented: false,
			button: 0, isPrimary: true, pointerType: 'mouse', pointerId: 1,
			shiftKey: false, metaKey: false, ctrlKey: false, altKey: false
		}, options);
	}
	preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
	stopPropagation() { this.stopped = true; }
	stopImmediatePropagation() { this.immediate = this.stopped = true; }
}
class Target {
	listeners = [];
	addEventListener(type, handler, capture = false) { this.listeners.push({ type, handler, capture }); }
	removeEventListener(type, handler, capture = false) {
		this.listeners = this.listeners.filter((l) => l.type !== type || l.handler !== handler || l.capture !== capture);
	}
	dispatchEvent(e) {
		e.target = this;
		const path = [];
		for (let p = this; p; p = p.parentElement) path.push(p);
		const invoke = (target, capture) => {
			e.currentTarget = target;
			for (const l of [...target.listeners]) {
				if (l.type === e.type && l.capture === capture) l.handler(e);
				if (e.immediate) break;
			}
		};
		for (const target of [...path].reverse()) {
			invoke(target, true);
			if (e.stopped) return !e.defaultPrevented;
		}
		for (const target of path) {
			invoke(target, false);
			if (e.stopped || !e.bubbles) break;
		}
		return !e.defaultPrevented;
	}
}
class Element extends Target {
	constructor(tag, attrs = {}) {
		super();
		this.tag = tag;
		this.attrs = attrs;
		this.style = {};
		const priorities = {};
		Object.defineProperties(this.style, {
			getPropertyValue: { value: (name) => this.style[name] ?? '' },
			getPropertyPriority: { value: (name) => priorities[name] ?? '' },
			setProperty: { value: (name, value, priority = '') => { this.style[name] = value; priorities[name] = priority; } },
			removeProperty: { value: (name) => { delete this.style[name]; delete priorities[name]; } }
		});
		this.children = [];
		Object.assign(this, { clientLeft: 0, clientTop: 0, clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0, scrollLeft: 0, scrollTop: 0 });
	}
	matches(selector) {
		return selector.split(',').some((s) => {
			s = s.trim();
			if (s.startsWith('[')) return s.slice(1, -1) in this.attrs;
			const [tag, className] = s.split('.');
			return this.tag === tag && (!className || (this.attrs.class ?? '').split(' ').includes(className));
		});
	}
	closest(selector) {
		for (let p = this; p instanceof Element; p = p.parentElement) if (p.matches(selector)) return p;
		return null;
	}
	querySelectorAll(selector) {
		return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
	}
	contains(element) {
		for (let p = element; p; p = p.parentElement) if (p === this) return true;
		return false;
	}
	getAttribute(name) { return this.attrs[name] ?? null; }
	getBoundingClientRect() { return this.rect(); }
	appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
	remove() {
		if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
		this.parentElement = null;
	}
}
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const cleanups = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture(selected = [9], { clock = false, callout = '' } = {}) {
	const window = new Target(), document = new Target();
	document.parentElement = window;
	document.body = new Element('body');
	document.body.parentElement = document;
	document.body.style.userSelect = 'text';
	document.body.style.cursor = 'crosshair';
	document.createElement = (tag) => new Element(tag);
	document.activeElement = document.body;
	const frames = new Map();
	let frameId = 0;
	window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
	window.cancelAnimationFrame = (id) => frames.delete(id);
	const timers = new Map();
	let now = 0, timerId = 0;
	const advance = (ms) => {
		now += ms;
		for (const [id, timer] of [...timers]) {
			if (timer.at <= now && timers.delete(id)) timer.callback();
		}
	};
	const globals = { window, document, Element, HTMLElement: Element, PointerEvent: MockEvent };
	if (clock) Object.assign(globals, {
		setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
		clearTimeout: (id) => timers.delete(id)
	});
	const originals = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	cleanups.push(() => {
		for (const [key, descriptor] of Object.entries(originals)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	const node = document.body.appendChild(new Element('div'));
	node.rect = () => rect(100, 50, 320, 220);
	Object.assign(node, { clientLeft: 2, clientTop: 2, clientWidth: 300, clientHeight: 200, scrollWidth: 600, scrollHeight: 800 });
	const item = (id, left, top, width = 40, height = 30, attrs = {}) => {
		const element = node.appendChild(new Element('div', { 'data-selection-item': '', ...(id === null ? {} : { 'data-block-id': String(id) }), ...attrs }));
		element.rect = () => rect(102 + left - node.scrollLeft, 52 + top - node.scrollTop, width, height);
		return element;
	};
	const first = item(1, 40, 40), second = item(2, 120, 80), channel = item(null, 200, 120);
	const selections = [], marquee = [];
	const params = { selected, key: 'channel-a', onselect: (ids) => selections.push(ids), onmarquee: (active) => marquee.push(active) };
	if (callout) node.style.setProperty('-webkit-touch-callout', callout, 'important');
	const action = blockselection(node, params);
	cleanups.push(() => action.destroy());
	const point = (x, y) => ({ clientX: 102 + x, clientY: 52 + y });
	let position = point(10, 10);
	const emit = (type, options = {}, at = window) => {
		if (type.startsWith('pointer')) position = { ...position, ...Object.fromEntries(Object.entries(options).filter(([key]) => key === 'clientX' || key === 'clientY')) };
		const e = new MockEvent(type, { ...position, ...options });
		at.dispatchEvent(e);
		return e;
	};
	const start = (options = {}) => {
		emit('pointerdown', { ...point(10, 10), ...options }, node);
		emit('pointermove', point(100, 75));
	};
	const tick = (time = 16) => {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(time);
	};
	const assertClean = (destroyed = false) => {
		assert.equal(document.body.children.length, 1);
		assert.deepEqual(document.body.style, { userSelect: 'text', cursor: 'crosshair' });
		assert.equal(frames.size, 0);
		assert.deepEqual(window.listeners.map((l) => l.type), destroyed ? [] : ['keydown']);
		assert.deepEqual(node.listeners.map((l) => l.type), destroyed ? [] : ['pointerdown', 'contextmenu']);
		if (clock) assert.equal(timers.size, 0);
		assert.equal(node.style.getPropertyValue('-webkit-touch-callout'), destroyed ? callout : 'none');
		if (destroyed && callout) assert.equal(node.style.getPropertyPriority('-webkit-touch-callout'), 'important');
	};
	return { window, document, node, first, second, channel, item, params, selections, marquee, action, point, emit, start, frames, tick, assertClean, advance, timers };
}

test('marquee is fixed on body, intersects only numeric blocks, and uses the release position', () => {
	const f = fixture();
	f.item('invalid', 20, 20);
	f.item('', 20, 20);
	f.item(3, 20, 20, 0, 30);
	f.item(1, 25, 25);
	f.start();
	assert.deepEqual(f.selections, [[1]]);
	const overlay = f.document.body.children[1];
	assert.deepEqual(overlay.style, {
		position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box',
		background: 'rgba(128,128,128,.18)', border: '1px solid rgba(96,96,96,.65)', zIndex: '2147483647',
		left: '112px', top: '62px', width: '90px', height: '65px'
	});
	assert.equal(f.document.body.style.userSelect, 'none');
	f.emit('pointermove', f.point(250, 170));
	assert.deepEqual(f.selections.at(-1), [1, 2]);
	f.emit('pointerup', f.point(100, 75));
	assert.deepEqual(f.selections.at(-1), [1]);
	assert.equal(overlay.parentElement, null);
	assert.equal(f.emit('click', {}, f.first).defaultPrevented, true);
	f.assertClean();
});

test('reverse-direction intersection replaces selection and excludes just-touching rectangles', () => {
	const f = fixture();
	f.emit('pointerdown', f.point(180, 120), f.node);
	f.emit('pointermove', f.point(80, 70));
	assert.deepEqual(f.selections.at(-1), [2]);
	f.emit('pointermove', f.point(70, 60));
	assert.deepEqual(f.selections.at(-1), [1, 2]);
	f.emit('pointercancel');
	assert.deepEqual(f.selections.at(-1), [9]);
	f.assertClean();
});

test('5px threshold leaves ordinary empty clicks intact and clears only on release', () => {
	const f = fixture();
	f.emit('pointerdown', {}, f.node);
	assert.equal(f.emit('pointermove', f.point(13, 13)).defaultPrevented, false);
	assert.deepEqual(f.selections, []);
	assert.equal(f.document.body.children.length, 1);
	assert.equal(f.emit('pointerup').defaultPrevented, false);
	assert.deepEqual(f.selections, [[]]);
	assert.equal(f.emit('click', {}, f.node).defaultPrevented, false);
	f.assertClean();
	f.emit('pointerdown', f.point(10, 10), f.node);
	assert.equal(f.emit('pointermove', f.point(15, 10)).defaultPrevented, true);
	assert.equal(f.document.body.children.length, 2);
	f.emit('pointercancel');
	f.assertClean();
});

for (const modifier of ['shiftKey', 'metaKey', 'ctrlKey']) {
	test(`${modifier} unions the original snapshot rather than accumulating earlier hits`, () => {
		const f = fixture([9, 2]);
		f.start({ [modifier]: true });
		assert.deepEqual(f.selections.at(-1), [9, 2, 1]);
		// Releasing the modifier mid-gesture does not replace the initial selection.
		f.emit('pointermove', f.point(30, 30));
		assert.deepEqual(f.selections.at(-1), [9, 2]);
		f.emit('pointermove', f.point(250, 170));
		assert.deepEqual(f.selections.at(-1), [9, 2, 1]);
		assert.deepEqual(f.params.selected, [9, 2]);
		f.emit('pointerup');
		f.emit('click');
		f.assertClean();
	});
	test(`${modifier} empty click preserves selection and is not suppressed`, () => {
		const f = fixture();
		f.emit('pointerdown', { [modifier]: true }, f.node);
		f.emit('pointerup');
		assert.deepEqual(f.selections, []);
		assert.equal(f.emit('click', {}, f.node).defaultPrevented, false);
		f.assertClean();
	});
}

test('ignores block/channel descendants, controls, editable roots and table headers', () => {
	const f = fixture();
	const excluded = [f.first, f.channel, f.node.appendChild(new Element('div', { 'data-block-id': '8' }))];
	for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'thead']) excluded.push(f.node.appendChild(new Element(tag)));
	for (const value of ['', 'true', 'false']) excluded.push(f.node.appendChild(new Element('div', { contenteditable: value })));
	for (const root of excluded) {
		const child = root.appendChild(new Element('span'));
		f.emit('pointerdown', f.point(10, 10), child);
		f.emit('pointermove', f.point(250, 170));
		f.emit('pointerup');
		assert.deepEqual(f.selections, []);
		f.assertClean();
	}
});

test('only primary left mouse gestures can start', () => {
	const f = fixture();
	for (const options of [{ button: 1 }, { button: 2 }, { isPrimary: false }, { pointerType: 'touch' }, { pointerType: 'pen' }]) {
		f.start(options);
		f.emit('pointerup');
		assert.deepEqual(f.selections, []);
		f.assertClean();
	}
});

test('borders, vertical/horizontal scrollbar gutters and nested scrollbars cannot start selection', () => {
	const f = fixture();
	for (const [x, y] of [[0, 10], [310, 10], [10, 210], [10, 0]]) {
		f.emit('pointerdown', { clientX: 100 + x, clientY: 50 + y }, f.node);
		f.emit('pointermove', f.point(100, 75));
		f.assertClean();
	}
	const nested = f.node.appendChild(new Element('div'));
	nested.rect = () => rect(110, 60, 100, 100);
	Object.assign(nested, { clientWidth: 85, clientHeight: 85, scrollWidth: 200, scrollHeight: 200 });
	f.emit('pointerdown', { clientX: 205, clientY: 70 }, nested);
	f.emit('pointermove', f.point(100, 75));
	assert.deepEqual(f.selections, []);
	f.assertClean();
});

test('unmarked empty descendants can start selection; unrelated pointers cannot move, end or cancel it', () => {
	const f = fixture();
	const empty = f.node.appendChild(new Element('div'));
	f.emit('pointerdown', {}, empty);
	f.emit('pointermove', { ...f.point(100, 75), pointerId: 2 });
	assert.deepEqual(f.selections, []);
	f.emit('pointermove', f.point(100, 75));
	assert.deepEqual(f.selections.at(-1), [1]);
	f.emit('pointerup', { pointerId: 2 });
	f.emit('pointercancel', { pointerId: 2 });
	assert.equal(f.document.body.children.length, 2);
	f.emit('pointercancel');
	assert.deepEqual(f.selections.at(-1), [9]);
	f.assertClean();
});

for (const ending of ['Escape', 'pointercancel', 'blur', 'destroy']) {
	test(`${ending} restores the original snapshot and cleans all gesture resources`, () => {
		const f = fixture([8, 9]);
		f.start();
		f.emit('pointermove', f.point(295, 195));
		assert.equal(f.frames.size, 1);
		if (ending === 'destroy') f.action.destroy();
		else if (ending === 'Escape') {
			const event = f.emit('keydown', { key: 'Escape' });
			assert.equal(event.defaultPrevented, true);
			assert.equal(event.stopped, true);
		} else f.emit(ending);
		assert.deepEqual(f.selections.at(-1), [8, 9]);
		f.emit('pointerup');
		f.assertClean(ending === 'destroy');
	});
}

test('Escape before threshold preserves the original selection; idle Escape clears without consuming input Escape', () => {
	const f = fixture();
	f.emit('pointerdown', {}, f.node);
	f.emit('keydown', { key: 'Escape' });
	f.emit('pointerup');
	assert.deepEqual(f.selections, []);
	for (const tag of ['input', 'textarea', 'select']) {
		const input = f.node.appendChild(new Element(tag));
		assert.equal(f.emit('keydown', { key: 'Escape' }, input).defaultPrevented, false);
	}
	const editable = f.node.appendChild(new Element('div', { contenteditable: '' })).appendChild(new Element('span'));
	f.emit('keydown', { key: 'Escape' }, editable);
	f.document.activeElement = editable;
	f.emit('keydown', { key: 'Escape' });
	assert.deepEqual(f.selections, []);
	f.document.activeElement = f.document.body;
	f.emit('keydown', { key: 'Escape', defaultPrevented: true });
	assert.deepEqual(f.selections, []);
	assert.equal(f.emit('keydown', { key: 'Escape' }).defaultPrevented, true);
	assert.deepEqual(f.selections, [[]]);
	f.assertClean();
});

test('external scrolling recomputes intersection from a content-coordinate anchor without pointer movement', () => {
	const f = fixture();
	Object.assign(f.node, { scrollTop: 20, scrollLeft: 10 });
	f.start();
	assert.deepEqual(f.selections.at(-1), [1]);
	Object.assign(f.node, { scrollTop: 70, scrollLeft: 50 });
	f.emit('scroll', { bubbles: false }, f.node);
	assert.deepEqual(f.selections.at(-1), [1, 2]);
	const overlay = f.document.body.children[1];
	assert.equal(overlay.style.left, '72px');
	assert.equal(overlay.style.top, '12px');
	assert.equal(overlay.style.width, '130px');
	assert.equal(overlay.style.height, '115px');
	f.emit('pointercancel');
	f.assertClean();
});

test('edge RAF scrolling selects newly reached blocks, bounds elapsed time and clamps both axes', () => {
	const f = fixture();
	f.item(3, 310, 210);
	f.start();
	assert.equal(f.frames.size, 0);
	f.emit('pointermove', f.point(295, 195));
	assert.deepEqual(f.selections.at(-1), [1, 2]);
	assert.equal(f.frames.size, 1);
	f.tick(16);
	assert.ok(f.node.scrollTop > 0 && f.node.scrollLeft > 0);
	const before = f.node.scrollTop;
	f.tick(10000);
	assert.ok(f.node.scrollTop - before <= 600 * 0.032);
	assert.deepEqual(f.selections.at(-1), [1, 2, 3]);
	Object.assign(f.node, { scrollTop: 599, scrollLeft: 299 });
	f.tick(10016);
	assert.equal(f.node.scrollTop, 600);
	assert.equal(f.node.scrollLeft, 300);
	assert.equal(f.frames.size, 0);
	f.emit('pointermove', f.point(-100, -100));
	assert.equal(f.frames.size, 1);
	Object.assign(f.node, { scrollTop: 1, scrollLeft: 1 });
	f.tick(10032);
	assert.equal(f.node.scrollTop, 0);
	assert.equal(f.node.scrollLeft, 0);
	assert.equal(f.frames.size, 0);
	f.emit('pointercancel');
	f.assertClean();
});

test('moving away from an edge stops auto-scroll and duplicate scroll events do not queue extra RAFs', () => {
	const f = fixture();
	f.start();
	f.emit('pointermove', f.point(295, 195));
	f.emit('scroll', { bubbles: false }, f.node);
	f.emit('scroll', { bubbles: false }, f.node);
	assert.equal(f.frames.size, 1);
	f.emit('pointermove', f.point(100, 75));
	f.tick();
	assert.equal(f.node.scrollTop, 0);
	assert.equal(f.node.scrollLeft, 0);
	assert.equal(f.frames.size, 0);
	f.emit('pointercancel');
	f.assertClean();
});

test('same-key updates use the new callback and selection; key changes cancel and clear the new view', () => {
	const f = fixture();
	const next = [];
	f.action.update({ selected: [7], key: 'channel-a', onselect: (ids) => next.push(ids) });
	f.start({ ctrlKey: true });
	assert.deepEqual(next.at(-1), [7, 1]);
	assert.deepEqual(f.selections, []);
	f.action.update({ selected: [7, 1], key: 'channel-b', onselect: (ids) => next.push(ids) });
	assert.deepEqual(next.at(-1), []);
	f.emit('pointerup');
	f.assertClean();
	f.action.update({ selected: [], key: 'channel-c', onselect: (ids) => next.push(ids) });
	assert.deepEqual(next, [[7, 1], [], []]);
});

test('same-key reactive updates during a gesture do not overwrite the cancellation snapshot', () => {
	const f = fixture();
	f.start();
	f.action.update({ ...f.params, selected: [1] });
	f.emit('pointercancel');
	assert.deepEqual(f.selections, [[1], [9]]);
	f.assertClean();
});

test('key change before threshold clears without a stale release; destroy removes pending click suppression', () => {
	const f = fixture();
	f.emit('pointerdown', {}, f.node);
	f.action.update({ ...f.params, key: 'channel-b' });
	f.emit('pointerup');
	assert.deepEqual(f.selections, [[]]);
	f.assertClean();
	f.start();
	f.emit('pointerup');
	f.action.destroy();
	assert.equal(f.emit('click').defaultPrevented, false);
	f.assertClean(true);
});

test('actual marquees suppress exactly one compatibility click, then later ordinary clicks remain intact', async () => {
	const f = fixture();
	f.start();
	f.emit('pointerup');
	let clicks = 0;
	f.node.addEventListener('click', () => clicks++);
	assert.equal(f.emit('click', {}, f.node).defaultPrevented, true);
	assert.equal(clicks, 0);
	assert.equal(f.emit('click', {}, f.node).defaultPrevented, false);
	assert.equal(clicks, 1);
	f.start();
	f.emit('pointerup');
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(f.emit('click', {}, f.node).defaultPrevented, false);
	assert.deepEqual(f.window.listeners.map((l) => l.type), ['keydown']);
});

for (const pointerType of ['touch', 'pen']) {
	test(`${pointerType} holds select additively at exactly 500ms and suppress the delayed block click`, () => {
		const f = fixture([9], { clock: true });
		const button = f.first.appendChild(new Element('button', { class: 'tile' }));
		const child = button.appendChild(new Element('img'));
		let opens = 0;
		button.addEventListener('click', () => opens++);
		assert.equal(f.emit('pointerdown', { pointerType }, child).defaultPrevented, false);
		f.advance(499);
		assert.deepEqual(f.selections, []);
		f.advance(1);
		assert.deepEqual(f.selections, [[9, 1]]);
		assert.equal(f.document.body.children.length, 1);
		assert.equal(f.emit('pointerup', { pointerType }).defaultPrevented, true);
		f.advance(300);
		assert.equal(f.emit('click', {}, child).defaultPrevented, true);
		assert.equal(opens, 0);
		assert.equal(f.emit('click', {}, child).defaultPrevented, false);
		assert.equal(opens, 1);
		f.assertClean();
	});

	test(`${pointerType} ordinary taps open, selection-mode taps toggle, and a selected hold never deselects`, () => {
		const f = fixture([], { clock: true });
		let opens = 0;
		f.first.addEventListener('click', () => opens++);
		const tap = (block, duration = 100) => {
			f.emit('pointerdown', { pointerType }, block);
			f.advance(duration);
			f.emit('pointerup', { pointerType });
			return f.emit('click', {}, block);
		};
		assert.equal(tap(f.first).defaultPrevented, false);
		assert.equal(opens, 1);
		assert.deepEqual(f.selections, []);
		assert.equal(tap(f.first, 500).defaultPrevented, true);
		assert.deepEqual(f.selections.at(-1), [1]);
		assert.equal(tap(f.first, 500).defaultPrevented, true);
		assert.deepEqual(f.selections, [[1]]);
		assert.equal(tap(f.second).defaultPrevented, true);
		assert.deepEqual(f.selections.at(-1), [1, 2]);
		assert.equal(tap(f.first).defaultPrevented, true);
		assert.deepEqual(f.selections.at(-1), [2]);
		assert.equal(tap(f.second).defaultPrevented, true);
		assert.deepEqual(f.selections.at(-1), []);
		assert.equal(tap(f.first).defaultPrevented, false);
		assert.equal(opens, 2);
		f.assertClean();
	});
}

for (const ending of ['move', 'release movement', 'scroll', 'nested scroll', 'pointercancel', 'blur', 'Escape', 'key change', 'destroy']) {
	test(`touch ${ending} cancels a pending hold without stale timers or selection`, () => {
		const f = fixture([9], { clock: true });
		f.emit('pointerdown', { pointerType: 'touch' }, f.first);
		f.advance(499);
		if (ending === 'move') assert.equal(f.emit('pointermove', f.point(21, 10)).defaultPrevented, false);
		else if (ending === 'release movement') f.emit('pointerup', f.point(10, 21));
		else if (ending === 'scroll') f.emit('scroll', { bubbles: false }, f.node);
		else if (ending === 'nested scroll') f.emit('scroll', { bubbles: false }, f.first);
		else if (ending === 'Escape') f.emit('keydown', { key: 'Escape' });
		else if (ending === 'key change') f.action.update({ ...f.params, key: 'channel-b' });
		else if (ending === 'destroy') f.action.destroy();
		else f.emit(ending);
		f.advance(1001);
		f.emit('pointerup');
		assert.deepEqual(f.selections, ending === 'key change' ? [[]] : []);
		assert.equal(f.emit('click', {}, f.first).defaultPrevented, false);
		f.assertClean(ending === 'destroy');
	});
}

test('touch jitter up to 10px and unrelated pointers do not cancel the hold', () => {
	const f = fixture([], { clock: true });
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	f.emit('pointermove', f.point(16, 18));
	f.emit('pointermove', { ...f.point(100, 100), pointerId: 2 });
	f.emit('pointerup', { pointerId: 2 });
	f.emit('pointercancel', { pointerId: 2 });
	f.advance(500);
	assert.deepEqual(f.selections, [[1]]);
	f.emit('pointerup', { ...f.point(16, 18), pointerType: 'touch' });
	f.emit('click', {}, f.first);
	f.assertClean();
});

test('touch ignores external controls, nested links/downloads/editables, invalid blocks and non-primary gestures', () => {
	const f = fixture([9], { clock: true });
	const targets = [f.node, f.channel, f.item('invalid', 0, 0), f.item('', 0, 0)];
	for (const tag of ['a', 'button', 'input', 'textarea', 'select']) {
		targets.push(f.node.appendChild(new Element(tag)));
		targets.push(f.first.appendChild(new Element(tag, { class: 'download' })));
	}
	targets.push(f.first.appendChild(new Element('div', { contenteditable: '' })));
	for (const target of targets) {
		const child = target.appendChild(new Element('span'));
		f.emit('pointerdown', { pointerType: 'touch' }, child);
		f.advance(500);
		f.emit('pointerup');
		assert.equal(f.emit('click', {}, child).defaultPrevented, false);
		f.assertClean();
	}
	for (const options of [{ button: 2 }, { isPrimary: false }]) {
		f.emit('pointerdown', { pointerType: 'touch', ...options }, f.first);
		f.advance(500);
		f.emit('pointerup');
		f.assertClean();
	}
	assert.deepEqual(f.selections, []);
});

for (const className of ['thumbnail', 'name']) {
	test(`list ${className} buttons support selection-mode touch taps`, () => {
		const f = fixture([9], { clock: true });
		const button = f.first.appendChild(new Element('button', { class: className }));
		f.emit('pointerdown', { pointerType: 'touch' }, button);
		f.emit('pointerup');
		assert.deepEqual(f.selections, [[9, 1]]);
		assert.equal(f.emit('click', {}, button).defaultPrevented, true);
		f.assertClean();
	});
}

test('touch context menus are prevented only on the active block; native callout style is restored', () => {
	const f = fixture([], { clock: true, callout: 'default' });
	assert.equal(f.emit('contextmenu', {}, f.first).defaultPrevented, false);
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	assert.equal(f.emit('contextmenu', {}, f.first).defaultPrevented, true);
	assert.equal(f.emit('contextmenu', {}, f.second).defaultPrevented, false);
	f.advance(500);
	assert.equal(f.emit('contextmenu', {}, f.first).defaultPrevented, true);
	f.emit('pointerup');
	f.action.destroy();
	f.advance(500);
	assert.equal(f.emit('click', {}, f.first).defaultPrevented, false);
	assert.equal(f.emit('contextmenu', {}, f.first).defaultPrevented, false);
	f.assertClean(true);
});

test('touch click suppression ignores other controls and expires if no compatibility click arrives', () => {
	const f = fixture([], { clock: true });
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	f.advance(500);
	f.emit('pointerup');
	assert.equal(f.emit('click', {}, f.channel).defaultPrevented, false);
	f.advance(700);
	assert.equal(f.emit('click', {}, f.first).defaultPrevented, false);
	f.assertClean();
});

for (const ending of ['pointercancel', 'blur', 'Escape', 'key change', 'destroy']) {
	test(`touch ${ending} after selection cleans the active hold`, () => {
		const f = fixture([9], { clock: true });
		f.emit('pointerdown', { pointerType: 'touch' }, f.first);
		f.advance(500);
		assert.deepEqual(f.selections, [[9, 1]]);
		if (ending === 'Escape') f.emit('keydown', { key: 'Escape' });
		else if (ending === 'key change') f.action.update({ ...f.params, key: 'channel-b' });
		else if (ending === 'destroy') f.action.destroy();
		else f.emit(ending);
		f.advance(500);
		f.emit('pointerup');
		assert.deepEqual(f.selections, [[9, 1], ending === 'key change' ? [] : [9]]);
		f.assertClean(ending === 'destroy');
	});
}

test('scrolling or moving after a completed hold cannot turn its release into a viewer click', () => {
	const f = fixture([], { clock: true });
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	f.advance(500);
	f.emit('scroll', { bubbles: false }, f.node);
	f.emit('pointermove', f.point(100, 100));
	assert.equal(f.emit('pointerup').defaultPrevented, true);
	assert.equal(f.emit('click', {}, f.first).defaultPrevented, true);
	assert.deepEqual(f.selections, [[1]]);
	f.assertClean();
});

test('same-key updates provide the live selection/callback to a pending touch hold; key changes clear suppression', () => {
	const f = fixture([], { clock: true });
	const next = [];
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	f.action.update({ ...f.params, selected: [7], onselect: (ids) => next.push(ids) });
	f.advance(500);
	assert.deepEqual(next, [[7, 1]]);
	assert.deepEqual(f.selections, []);
	f.emit('pointerup');
	f.action.update({ ...f.params, key: 'channel-b' });
	assert.equal(f.emit('click', {}, f.first).defaultPrevented, false);
	f.advance(500);
	f.assertClean();
});


test('marquee state starts after the threshold and ends only after the release selection is published', () => {
	const f = fixture([]);
	const events = [];
	f.action.update({ ...f.params, onmarquee: (active) => events.push({ active, selection: f.selections.at(-1) }) });
	f.emit('pointerdown', {}, f.node);
	f.emit('pointermove', f.point(13, 13));
	assert.deepEqual(events, []);
	f.emit('pointermove', f.point(100, 75));
	assert.deepEqual(events.map((event) => event.active), [true]);
	assert.deepEqual(f.selections.at(-1), [1]);
	f.emit('pointermove', f.point(250, 170));
	assert.deepEqual(events.map((event) => event.active), [true]);
	f.emit('pointerup', f.point(250, 170));
	assert.deepEqual(events, [{ active: true, selection: undefined }, { active: false, selection: [1, 2] }]);
});

for (const ending of ['pointercancel', 'blur', 'Escape', 'key change', 'destroy']) {
	test(`marquee ${ending} clears active state without leaving the control bar hidden`, () => {
		const f = fixture();
		f.start();
		assert.deepEqual(f.marquee, [true]);
		if (ending === 'Escape') f.emit('keydown', { key: 'Escape' });
		else if (ending === 'key change') f.action.update({ ...f.params, key: 'channel-b' });
		else if (ending === 'destroy') f.action.destroy();
		else f.emit(ending);
		assert.deepEqual(f.marquee, [true, false]);
		f.action.destroy();
		assert.deepEqual(f.marquee, [true, false]);
	});
}

test('ordinary clicks and touch selection never report a desktop marquee', () => {
	const f = fixture([], { clock: true });
	f.emit('pointerdown', {}, f.node);
	f.emit('pointerup');
	assert.deepEqual(f.marquee, []);
	f.emit('pointerdown', { pointerType: 'touch' }, f.first);
	f.advance(500);
	assert.deepEqual(f.selections.at(-1), [1]);
	assert.deepEqual(f.marquee, []);
	f.emit('pointerup', { pointerType: 'touch' });
	assert.deepEqual(f.marquee, []);
});
