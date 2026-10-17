import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, BlockList, Tile, prefs, drag, render;
const originalStorage = globalThis.localStorage;
const stored = new Map();

before(async () => {
	globalThis.localStorage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, value)
	};
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: BlockList } = await server.ssrLoadModule('/src/lib/components/BlockList.svelte'));
	({ default: Tile } = await server.ssrLoadModule('/src/lib/components/Tile.svelte'));
	({ prefs } = await server.ssrLoadModule('/src/lib/prefs.svelte.ts'));
	drag = await server.ssrLoadModule('/src/lib/dnd.svelte.ts');
});

after(async () => {
	if (originalStorage === undefined) delete globalThis.localStorage;
	else globalThis.localStorage = originalStorage;
	await server?.close();
});

const source = { slug: 'inbox', id: 10 };
const block = {
	id: 42, type: 'Text', title: 'Example block',
	description: { plain: 'A useful description' },
	content: { plain: 'Some text' },
	source: { url: 'https://example.com/article' },
	connection: { id: 99 }
};
const table = (items) => render(BlockList, {
	props: { items, source, onopen() {}, onchannel() {} }
}).body;

test('grid is the default and view selection preserves other preferences', () => {
	assert.equal(prefs.viewMode, 'grid');
	prefs.rowHeight = 250;
	prefs.viewMode = 'list';
	assert.deepEqual(JSON.parse(stored.get('seeds.prefs')), {
		rowHeight: 250, sort: 'position_desc', viewMode: 'list'
	});
	prefs.sort = 'created_at_asc';
	assert.equal(JSON.parse(stored.get('seeds.prefs')).viewMode, 'list');
});

test('list renders block details and a safe external URL', () => {
	const html = table([block]);
	for (const text of ['Thumbnail', 'Name', 'Description', 'URL', block.title, block.description.plain]) {
		assert.ok(html.includes(text), text);
	}
	assert.match(html, /draggable="true"/);
	assert.match(html, /href="https:\/\/example.com\/article"/);
	assert.match(html, /target="_blank" rel="noopener noreferrer"/);
	assert.doesNotMatch(table([{ ...block, source: { url: 'javascript:alert(1)' } }]), /href="javascript:/);
});

test('channel rows retain navigation and are not draggable', () => {
	const html = table([{
		id: 7, type: 'Channel', title: 'Research', slug: 'research',
		description: null, counts: { contents: 3 }
	}]);
	assert.match(html, /href="\/c\/research"/);
	assert.match(html, /3 items/);
	assert.doesNotMatch(html, /draggable="true"/);
});

test('list thumbnails use the original preview rather than a cropped square', () => {
	const version = { src: 'https://example.com/preview.jpg', src_2x: 'https://example.com/preview@2x.jpg' };
	const html = table([{
		...block, type: 'Image', image: {
			width: 1600, height: 900, content_type: 'image/jpeg', alt_text: 'Landscape',
			medium: version, square: { src: 'https://example.com/square.jpg' }
		}
	}]);
	assert.match(html, /src="https:\/\/example.com\/preview.jpg"/);
	assert.match(html, /loading="lazy"/);
	assert.doesNotMatch(html, /square.jpg/);
});

test('grid tiles expose a download button for images, GIFs and image previews', () => {
	for (const [type, contentType, label] of [
		['Image', 'image/jpeg', 'Download image'],
		['Image', 'image/gif', 'Download GIF'],
		['Link', 'image/png', 'Download image']
	]) {
		const version = { src: 'https://example.com/preview.jpg', src_2x: 'https://example.com/preview@2x.jpg' };
		const item = { ...block, type, image: { src: 'https://example.com/original', content_type: contentType, medium: version } };
		const { body } = render(Tile, { props: { item, source, width: 200, onopen() {} } });
		assert.match(body, new RegExp(`<button[^>]*aria-label="${label}"`));
		assert.match(body, /class="download /);
	}
});

test('grid tiles without images do not expose a download button', () => {
	const { body } = render(Tile, { props: { item: block, source, width: 200, onopen() {} } });
	assert.doesNotMatch(body, /aria-label="Download/);
});

test('row drag handler preserves the connection and source needed to move into folders', () => {
	const data = new Map();
	const dataTransfer = {
		clearData: () => data.clear(),
		setData: (key, value) => data.set(key, value)
	};
	drag.startBlockDrag({ dataTransfer }, block, source);
	assert.equal(dataTransfer.effectAllowed, 'copyMove');
	assert.deepEqual(JSON.parse(data.get(drag.BLOCK_MIME)), {
		kind: 'block', blockId: 42, connectionId: 99, sourceSlug: 'inbox', sourceId: 10
	});
	assert.equal(drag.dnd.current.blockId, 42);
	drag.dnd.reset();
	assert.equal(drag.dnd.current, null);
});
