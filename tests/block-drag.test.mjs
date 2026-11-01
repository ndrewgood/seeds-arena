import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, drag, droptarget;
before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	drag = await server.ssrLoadModule('/src/lib/dnd.svelte.ts');
	({ droptarget } = await server.ssrLoadModule('/src/lib/actions.ts'));
});
after(async () => { await server?.close(); });

const item = { id: 5, type: 'Image', connection: { id: 9 } };
const source = { id: 1, slug: 'source' };
function transfer() {
	const data = new Map();
	return {
		types: [drag.BLOCK_MIME],
		clearData: () => data.clear(),
		setData: (key, value) => data.set(key, value),
		getData: (key) => data.get(key),
		setDragImage: (...args) => { data.set('preview', args); },
		data
	};
}

test('selection batches preserve anchor fields, order and source connections while excluding channels and duplicates', () => {
	const second = { id: 6, type: 'Text', connection: { id: 10 } };
	const third = { id: 7, type: 'Image' };
	const selected = [second, { id: 5, type: 'Channel' }, { ...item, connection: { id: 99 } }, second, third];
	const payload = drag.blockDragFor(item, source, selected);
	assert.deepEqual(payload, {
		kind: 'block', blockId: 5, connectionId: 9, sourceSlug: 'source', sourceId: 1,
		blocks: [
			{ blockId: 6, connectionId: 10 },
			{ blockId: 5, connectionId: 9 },
			{ blockId: 7, connectionId: null }
		]
	});
	second.connection.id = 100;
	selected.pop();
	assert.equal(payload.blocks[0].connectionId, 10, 'payload snapshots selection data');
	assert.equal(payload.blocks.length, 3);
});

test('unselected anchors and selections with only one distinct block retain the singleton shape', () => {
	const singleton = { kind: 'block', blockId: 5, connectionId: 9, sourceSlug: 'source', sourceId: 1 };
	for (const selected of [undefined, [], [item], [item, item], [{ id: 6, type: 'Text' }], [{ id: 5, type: 'Channel' }]]) {
		assert.deepEqual(drag.blockDragFor(item, source, selected), singleton);
	}
	assert.equal(drag.blockDragFor({ id: 5, type: 'Channel' }, source, [item]), null);
});

test('native batch drag round-trips and styling includes every block, not channels or unrelated IDs', () => {
	const dataTransfer = transfer();
	drag.startBlockDrag({ dataTransfer, metaKey: true }, item, source, [item, { id: 6, type: 'Text' }]);
	assert.equal(dataTransfer.effectAllowed, 'copyMove');
	assert.equal(drag.dnd.copy, true);
	assert.deepEqual(drag.readBlockDrag(dataTransfer), drag.dnd.current);
	assert.equal(drag.dnd.current.blocks.length, 2);
	for (const id of [5, 6]) assert.equal(drag.isBlockDragging(id), true);
	assert.equal(drag.isBlockDragging(7), false);
	drag.dnd.reset();
	assert.equal(drag.isBlockDragging(5), false);
	drag.startBlockDrag({ dataTransfer }, item, source);
	assert.equal(drag.isBlockDragging(5), true);
	assert.equal(drag.isBlockDragging(6), false);
	drag.startFolderDrag({ dataTransfer }, 5);
	assert.equal(drag.isBlockDragging(5), false);
	drag.dnd.reset();
});

test('reader accepts legacy singletons and deduplicates valid batch entries', () => {
	const singleton = drag.blockDragFor(item, source);
	const dataTransfer = transfer();
	dataTransfer.setData(drag.BLOCK_MIME, JSON.stringify(singleton));
	assert.deepEqual(drag.readBlockDrag(dataTransfer), singleton);
	const blocks = [{ blockId: 5, connectionId: 9 }, { blockId: 6, connectionId: null }];
	dataTransfer.setData(drag.BLOCK_MIME, JSON.stringify({ ...singleton, blocks: [...blocks, blocks[0]] }));
	assert.deepEqual(drag.readBlockDrag(dataTransfer), { ...singleton, blocks });
});

test('reader rejects malformed singletons and batches instead of falling back to the anchor', () => {
	const singleton = drag.blockDragFor(item, source);
	const anchor = { blockId: 5, connectionId: 9 };
	const invalid = [
		null, {}, { ...singleton, kind: 'folder' },
		{ ...singleton, blockId: '5' }, { ...singleton, blockId: -1 },
		{ ...singleton, connectionId: '9' }, { ...singleton, connectionId: undefined },
		{ ...singleton, sourceSlug: '' }, { ...singleton, sourceId: '1' },
		...[null, {}, [], [null], [5], [{ blockId: 6, connectionId: 10 }],
			[anchor, { blockId: '6', connectionId: 10 }],
			[anchor, { blockId: 6, connectionId: undefined }],
			[anchor, { blockId: 6, connectionId: 1.5 }],
			[anchor, { blockId: 6.5, connectionId: null }],
			[{ ...anchor, connectionId: 10 }],
			[anchor, { ...anchor, connectionId: 10 }]
		].map((blocks) => ({ ...singleton, blocks }))
	];
	const dataTransfer = transfer();
	for (const payload of invalid) {
		dataTransfer.setData(drag.BLOCK_MIME, JSON.stringify(payload));
		assert.equal(drag.readBlockDrag(dataTransfer), null, JSON.stringify(payload));
	}
	dataTransfer.setData(drag.BLOCK_MIME, '{');
	assert.equal(drag.readBlockDrag(dataTransfer), null);
});

test('Command mode follows presses and releases and resets after a block drag', () => {
	const dataTransfer = transfer();
	drag.startBlockDrag({ dataTransfer, metaKey: true }, item, source);
	assert.equal(dataTransfer.effectAllowed, 'copyMove');
	assert.equal(drag.dnd.copy, true);
	drag.dnd.updateModifiers({ metaKey: false });
	assert.equal(drag.dnd.copy, false);
	drag.dnd.updateModifiers({ metaKey: true });
	assert.equal(drag.dnd.copy, true);
	drag.dnd.reset();
	assert.equal(drag.dnd.copy, false);
	assert.equal(drag.dnd.current, null);
	drag.dnd.updateModifiers({ metaKey: true });
	assert.equal(drag.dnd.copy, false);
});

test('folder dragging remains move-only even with Command held', () => {
	const dataTransfer = transfer();
	drag.startFolderDrag({ dataTransfer }, 7);
	drag.dnd.updateModifiers({ metaKey: true });
	assert.equal(dataTransfer.effectAllowed, 'move');
	assert.equal(drag.dnd.copy, false);
	drag.dnd.reset();
});

test('drop target cursor follows Command at dragover and clears state after drop', () => {
	const listeners = new Map();
	const node = {
		addEventListener: (key, handler) => listeners.set(key, handler),
		removeEventListener: (key) => listeners.delete(key)
	};
	let dropped = false;
	const action = droptarget(node, {
		key: 'target', accepts: () => true,
		ondrop: (event, kind) => {
			assert.equal(event.metaKey, true);
			assert.equal(kind, 'block');
			dropped = true;
		}
	});
	const dataTransfer = transfer();
	drag.startBlockDrag({ dataTransfer, metaKey: false }, item, source);
	const event = { dataTransfer, metaKey: true, preventDefault() {} };
	listeners.get('dragover')(event);
	assert.equal(dataTransfer.dropEffect, 'copy');
	assert.equal(drag.dnd.copy, true);
	listeners.get('dragover')({ ...event, metaKey: false });
	assert.equal(dataTransfer.dropEffect, 'move');
	assert.equal(drag.dnd.copy, false);
	listeners.get('drop')(event);
	assert.equal(dropped, true);
	assert.equal(drag.dnd.current, null);
	assert.equal(drag.dnd.copy, false);
	assert.equal(drag.dnd.over, null);
	action.destroy();
	assert.equal(listeners.size, 0);
});

test('cards, rows and viewer images get bounded translucent drag snapshots cleaned up after capture', async () => {
	const originalElement = globalThis.HTMLElement;
	const originalDocument = globalThis.document;
	class Element {
		constructor(tagName, width = 0, height = 0) {
			this.tagName = tagName;
			this.width = width;
			this.height = height;
			this.style = {};
			this.children = [];
		}
		getBoundingClientRect() { return { width: this.width, height: this.height }; }
		cloneNode() { return new Element(this.tagName, this.width, this.height); }
		removeAttribute() {}
		setAttribute() {}
		querySelectorAll() { return []; }
		appendChild(child) { this.children.push(child); }
		remove() { this.removed = true; }
	}
	globalThis.HTMLElement = Element;
	const body = new Element('BODY');
	globalThis.document = { body, createElement: (name) => new Element(name.toUpperCase()) };
	try {
		for (const [tag, width, height, count] of [['DIV', 300, 200, 1], ['DIV', 300, 200, 3], ['TR', 1200, 120, 3], ['IMG', 1800, 1400, 1]]) {
			const dataTransfer = transfer();
			const selected = count > 1 ? [item, { ...item, id: 6 }, { ...item, id: 7 }] : undefined;
						drag.startBlockDrag({ dataTransfer, currentTarget: new Element(tag, width, height), metaKey: false }, item, source, selected);
			const [preview, x, y] = dataTransfer.data.get('preview');
			assert.equal(preview.style.opacity, '0.5');
			assert.ok(parseFloat(preview.style.width) <= 200);
			assert.ok(parseFloat(preview.style.height) <= 140);
			assert.ok(parseFloat(preview.style.width) <= width / 2);
			assert.equal(x, 12);
			assert.equal(y, 12);
			if (tag === 'TR') assert.equal(preview.children[0].tagName, 'TABLE');
			assert.equal(preview.children.length, count > 1 ? 2 : 1);
			if (count > 1) {
				const badge = preview.children[1];
				assert.equal(badge.textContent, String(count));
				assert.equal(badge.style.top, '6px');
				assert.equal(badge.style.right, '6px');
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
			assert.equal(preview.removed, true);
		}
	} finally {
		if (originalElement === undefined) delete globalThis.HTMLElement;
		else globalThis.HTMLElement = originalElement;
		if (originalDocument === undefined) delete globalThis.document;
		else globalThis.document = originalDocument;
		drag.dnd.reset();
	}
});
