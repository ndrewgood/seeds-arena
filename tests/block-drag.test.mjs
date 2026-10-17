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
		for (const [tag, width, height] of [['DIV', 300, 200], ['TR', 1200, 120], ['IMG', 1800, 1400]]) {
			const dataTransfer = transfer();
			drag.startBlockDrag({ dataTransfer, currentTarget: new Element(tag, width, height), metaKey: false }, item, source);
			const [preview, x, y] = dataTransfer.data.get('preview');
			assert.equal(preview.style.opacity, '0.5');
			assert.ok(parseFloat(preview.style.width) <= 200);
			assert.ok(parseFloat(preview.style.height) <= 140);
			assert.ok(parseFloat(preview.style.width) <= width / 2);
			assert.equal(x, 12);
			assert.equal(y, 12);
			if (tag === 'TR') assert.equal(preview.children[0].tagName, 'TABLE');
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
