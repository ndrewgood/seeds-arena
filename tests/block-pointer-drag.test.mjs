import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

// Exercise the action and real droptarget against a small capture/bubble DOM.
// Only the parent's promised dnd helpers are stubbed; no backend or DOM package is needed.
const BLOCK_MIME = 'application/x-seeds-block';
const dnd = {
	current: null, over: null, copy: false,
	updateModifiers(e) { this.copy = this.current?.kind === 'block' && e.metaKey === true; },
	reset() { this.current = null; this.over = null; this.copy = false; }
};
const api = {
	BLOCK_MIME, dnd,
	blockDragFor(item, source) {
		return item.type === 'Channel' ? null : {
			kind: 'block', blockId: item.id, connectionId: item.connection?.id ?? null,
			sourceSlug: source.slug, sourceId: source.id
		};
	},
	createBlockDragPreview() {
		const preview = new Element('div');
		Object.assign(preview.style, { position: 'fixed', pointerEvents: 'none', opacity: '0.5' });
		return preview;
	},
	dragKind(e) { return e.dataTransfer?.types.includes(BLOCK_MIME) ? 'block' : null; }
};
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const dependency = moduleUrl('export const { BLOCK_MIME, dnd, blockDragFor, createBlockDragPreview, dragKind } = globalThis.__pointerDragTestAPI;');
globalThis.__pointerDragTestAPI = api;
async function load(path) {
	const source = await readFile(new URL(path, import.meta.url), 'utf8');
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
	});
	return import(moduleUrl(outputText.replaceAll("'./dnd.svelte'", JSON.stringify(dependency))));
}
const { blockdrag } = await load('../src/lib/blockdrag.ts');
const { droptarget } = await load('../src/lib/actions.ts');
delete globalThis.__pointerDragTestAPI;

class MockEvent {
	constructor(type, options = {}) {
		Object.assign(this, {
			type, bubbles: true, cancelable: true, defaultPrevented: false,
			metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
			button: 0, isPrimary: true, pointerType: 'mouse', pointerId: 1,
			clientX: 10, clientY: 20, relatedTarget: null
		}, options);
	}
	preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
	stopPropagation() { this.stopped = true; }
	stopImmediatePropagation() { this.immediate = this.stopped = true; }
}
class Target {
	listeners = [];
	addEventListener(type, handler, capture = false) {
		this.listeners.push({ type, handler, capture });
	}
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
	constructor(tag, classes = '', attrs = {}) {
		super();
		this.tag = tag;
		this.classes = classes.split(' ');
		this.attrs = attrs;
		this.style = {};
		this.children = [];
	}
	matches(selector) {
		return selector.split(',').some((s) => {
			s = s.trim();
			if (s.startsWith('.')) return this.classes.includes(s.slice(1));
			if (s.startsWith('[contenteditable]')) return 'contenteditable' in this.attrs && this.attrs.contenteditable !== 'false';
			if (s === '[role="button"]') return this.attrs.role === 'button';
			return this.tag === s;
		});
	}
	closest(selector) {
		for (let p = this; p instanceof Element; p = p.parentElement) if (p.matches(selector)) return p;
		return null;
	}
	contains(other) {
		for (let p = other; p; p = p.parentElement) if (p === this) return true;
		return false;
	}
	appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
	remove() {
		if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
		this.parentElement = null;
	}
}
class Transfer {
	data = new Map();
	setData(key, value) { this.data.set(key, value); }
	getData(key) { return this.data.get(key) ?? ''; }
	get types() { return [...this.data.keys()]; }
}
const cleanups = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	dnd.reset();
});
function fixture() {
	const window = new Target(), document = new Target();
	document.parentElement = window;
	document.body = new Element('body');
	document.body.parentElement = document;
	Object.assign(document.body.style, { userSelect: 'text', cursor: 'crosshair' });
	let hit = null;
	document.elementFromPoint = () => hit;
	const globals = { window, document, Element, HTMLElement: Element, Node: Target, PointerEvent: MockEvent, DragEvent: MockEvent, DataTransfer: Transfer };
	const originals = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	cleanups.push(() => {
		for (const [key, descriptor] of Object.entries(originals)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	const node = document.body.appendChild(new Element('div'));
	const tile = node.appendChild(new Element('button', 'tile'));
	const target = document.body.appendChild(new Element('div'));
	const child = target.appendChild(new Element('span'));
	const drops = [], events = [];
	for (const type of ['dragover', 'dragleave', 'drop']) target.addEventListener(type, (e) => events.push(e));
	const action = blockdrag(node, { item: { id: 5, type: 'Image', connection: { id: 9 } }, source: { slug: 'source', id: 1 } });
	const drop = droptarget(target, { key: 'target', accepts: () => true, ondrop: (e, kind) => drops.push({ e, kind, payload: JSON.parse(e.dataTransfer.getData(BLOCK_MIME)) }) });
	cleanups.push(() => { action.destroy(); drop.destroy(); });
	const emit = (type, options = {}, at = window) => {
		const event = new MockEvent(type, options);
		at.dispatchEvent(event);
		return event;
	};
	const start = (options = {}) => {
		emit('pointerdown', options, tile);
		emit('pointermove', { clientX: 18, ...options });
	};
	const assertClean = () => {
		assert.equal(dnd.current, null);
		assert.equal(dnd.over, null);
		assert.equal(dnd.copy, false);
		assert.equal(document.body.children.length, 2);
		assert.deepEqual(document.body.style, { userSelect: 'text', cursor: 'crosshair' });
		assert.equal(window.listeners.filter((l) => l.type !== 'click').length, 0);
	};
	return { window, document, node, tile, target, child, drops, events, action, emit, start, assertClean, hit: (value) => { hit = value; } };
}

test('Command pointerup delivers exactly one synthetic block drop without any native drop', () => {
	const f = fixture();
	f.hit(f.child);
	f.start({ metaKey: true });
	assert.equal(dnd.copy, true);
	assert.equal(dnd.over, 'target');
	assert.equal(f.document.body.style.cursor, 'copy');
	const preview = f.document.body.children[2];
	assert.equal(preview.style.pointerEvents, 'none');
	assert.equal(preview.style.left, '30px');
	f.emit('pointerup', { metaKey: true, clientX: 40 });
	f.emit('pointerup', { metaKey: true });
	assert.equal(f.drops.length, 1);
	const { e, kind, payload } = f.drops[0];
	assert.equal(e.metaKey, true);
	assert.equal(e.clientX, 40);
	assert.equal(e.target, f.child);
	assert.equal(e.dataTransfer.effectAllowed, 'copyMove');
	assert.equal(kind, 'block');
	assert.deepEqual(payload, { kind: 'block', blockId: 5, connectionId: 9, sourceSlug: 'source', sourceId: 1 });
	assert.equal(preview.parentElement, null);
	assert.equal(f.emit('click', {}, f.tile).defaultPrevented, true);
	assert.equal(f.window.listeners.length, 0);
	f.assertClean();
});

test('Command press/release replays dragover at the last pointer coordinates with all modifiers', () => {
	const f = fixture();
	f.hit(f.target);
	f.start();
	for (const [type, metaKey] of [['keydown', true], ['keyup', false], ['keydown', true]]) {
		f.emit(type, { key: 'Meta', metaKey, ctrlKey: true, altKey: true, shiftKey: true });
		assert.equal(dnd.copy, metaKey);
		assert.equal(f.document.body.style.cursor, metaKey ? 'copy' : 'move');
		const event = f.events.at(-1);
		assert.equal(event.type, 'dragover');
		assert.equal(event.clientX, 18);
		assert.equal(event.metaKey, metaKey);
		assert.equal(event.ctrlKey && event.altKey && event.shiftKey, true);
		assert.equal(event.dataTransfer.dropEffect, metaKey ? 'copy' : 'move');
	}
	f.emit('pointerup', { metaKey: false });
	assert.equal(f.drops[0].e.metaKey, false);
	f.assertClean();
});

test('ordinary clicks below threshold stay intact and native dragstart is always blocked', () => {
	const f = fixture();
	f.emit('pointerdown', {}, f.tile);
	assert.equal(f.emit('pointermove', { clientX: 13 }).defaultPrevented, false);
	assert.equal(f.emit('pointerup').defaultPrevented, false);
	assert.equal(f.emit('click', {}, f.tile).defaultPrevented, false);
	assert.equal(f.events.length, 0);
	const native = f.emit('dragstart', {}, f.tile);
	assert.equal(native.defaultPrevented, true);
	assert.equal(native.stopped, true);
	f.assertClean();
});

for (const ending of ['Escape', 'pointercancel', 'outside', 'destroy', 'blur']) {
	test(`${ending} cleans preview, hover and listeners without a drop`, async () => {
		const f = fixture();
		f.hit(f.target);
		f.start();
		if (ending === 'Escape') {
			const event = f.emit('keydown', { key: 'Escape' });
			assert.equal(event.defaultPrevented, true);
			assert.equal(event.stopped, true);
		} else if (ending === 'destroy') f.action.destroy();
		else if (ending === 'outside') {
			f.hit(null);
			f.emit('pointermove', { clientX: -10 });
			assert.equal(dnd.over, null);
			assert.equal(f.events.at(-1).type, 'dragleave');
			f.emit('pointerup', { clientX: -10 });
		} else f.emit(ending);
		assert.equal(f.drops.length, 0);
		f.assertClean();
		await new Promise((resolve) => setTimeout(resolve, 5));
		assert.equal(f.window.listeners.length, 0);
		f.emit('pointerup');
		assert.equal(f.drops.length, 0);
	});
}

test('pointerup drops on the actual new hit rather than the last hovered element', () => {
	const f = fixture();
	f.hit(f.target);
	f.start();
	f.hit(f.child);
	f.emit('pointerup', { metaKey: true });
	assert.equal(f.drops.length, 1);
	assert.equal(f.drops[0].e.target, f.child);
	assert.equal(f.drops[0].e.metaKey, true);
	f.assertClean();
});

test('click suppression expires without swallowing the next ordinary click', async () => {
	const f = fixture();
	f.hit(f.target);
	f.start();
	f.emit('pointerup');
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(f.window.listeners.length, 0);
	assert.equal(f.emit('click', {}, f.tile).defaultPrevented, false);
	f.assertClean();
});

test('release hit testing never drops on a stale hover target', () => {
	const f = fixture();
	f.hit(f.target);
	f.start();
	f.hit(null);
	f.emit('pointerup');
	assert.equal(f.drops.length, 0);
	f.assertClean();
});

test('crossing descendants supplies relatedTarget, and leaving cancels the real hold timer', async () => {
	const f = fixture();
	let holds = 0;
	const hold = droptarget(f.target, { key: 'hold', accepts: () => true, ondrop() {}, onhold: () => holds++ });
	cleanups.push(() => hold.destroy());
	f.hit(f.target);
	f.start();
	f.hit(f.child);
	f.emit('pointermove', { clientX: 25 });
	const leave = f.events.find((e) => e.type === 'dragleave');
	assert.equal(leave.relatedTarget, f.child);
	assert.equal(f.target.contains(leave.relatedTarget), true);
	f.hit(null);
	f.emit('pointermove', { clientX: -1 });
	assert.equal(dnd.over, null);
	await new Promise((resolve) => setTimeout(resolve, 700));
	assert.equal(holds, 0);
	f.emit('pointercancel');
	f.assertClean();
});

test('ignores controls, links, action buttons and non-primary/non-mouse pointers', () => {
	const f = fixture();
	for (const element of [
		new Element('input'), new Element('textarea'), new Element('select'), new Element('a'),
		new Element('div', '', { contenteditable: '' }), new Element('button', 'download tile'),
		new Element('div', 'hover-actions'), new Element('button', 'edit')
	]) {
		const child = f.node.appendChild(element).appendChild(new Element('span'));
		f.emit('pointerdown', {}, child);
		f.emit('pointermove', { clientX: 30 });
		assert.equal(dnd.current, null);
		assert.equal(f.window.listeners.length, 0);
	}
	for (const options of [{ button: 2 }, { isPrimary: false }, { pointerType: 'touch' }, { pointerType: 'pen' }]) {
		f.emit('pointerdown', options, f.tile);
		assert.equal(f.window.listeners.length, 0);
	}
});

test('plain rows and name buttons drag, action updates payload, and unrelated pointers are ignored', () => {
	const f = fixture();
	f.action.update({ item: { id: 7, type: 'Text' }, source: { slug: 'next', id: 2 } });
	for (const target of [f.node, f.node.appendChild(new Element('button', 'name'))]) {
		f.hit(f.target);
		f.emit('pointerdown', {}, target);
		f.emit('pointermove', { pointerId: 2, clientX: 30 });
		assert.equal(dnd.current, null);
		f.emit('pointermove', { clientX: 30 });
		assert.equal(dnd.current.blockId, 7);
		assert.equal(dnd.current.sourceSlug, 'next');
		f.emit('pointercancel', { pointerId: 2 });
		assert.notEqual(dnd.current, null);
		f.emit('pointercancel');
		f.assertClean();
	}
	f.action.update({ item: { id: 8, type: 'Channel' }, source: { slug: 'next', id: 2 } });
	f.start();
	f.assertClean();
});
