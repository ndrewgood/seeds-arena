import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, seeds, Previews, channels, render, Tile, BlockList;
const originalFetch = globalThis.fetch;

before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	seeds = await server.ssrLoadModule('/src/lib/seeds.ts');
	({ Previews } = await server.ssrLoadModule('/src/lib/previews.svelte.ts'));
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: Tile } = await server.ssrLoadModule('/src/lib/components/Tile.svelte'));
	({ default: BlockList } = await server.ssrLoadModule('/src/lib/components/BlockList.svelte'));
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	channels.items = [];
});
after(async () => { await server?.close(); });

function folder(id, path, blocks = 0) {
	return {
		id, type: 'Channel', slug: `folder-${id}`, title: `🌱 ${path}`,
		counts: { blocks, channels: 0, contents: blocks }, updated_at: '2026-01-01'
	};
}
const image = (id, src = `https://example.com/${id}.jpg`) => ({
	id, type: 'Image', image: { square: { src } }
});
const tree = (items) => seeds.buildFolders(items).all;
async function ready(previews, id) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (previews.get(id) !== undefined) return previews.get(id);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail('Preview did not finish');
}
function mockContents(pages) {
	const requests = [];
	globalThis.fetch = async (input) => {
		const url = new URL(input);
		const slug = decodeURIComponent(url.pathname.split('/').at(-2));
		const page = Number(url.searchParams.get('page'));
		requests.push([slug, page]);
		const result = pages[slug]?.[page - 1];
		if (result instanceof Error) throw result;
		assert.ok(result, `Unexpected request: ${slug}, page ${page}`);
		return new Response(JSON.stringify({
			data: result,
			meta: { has_more_pages: page < pages[slug].length }
		}), { status: 200 });
	};
	return requests;
}

test('counts include all descendant blocks and folders, but not the folder itself or siblings', () => {
	const a = folder(1, 'A');
	const b = folder(2, 'A > B');
	const c = folder(3, 'A > B > C', 4);
	const all = tree([a, b, c, folder(4, 'Another A', 50)]);
	assert.equal(seeds.folderSummary(a, all), '4 blocks, 2 folders');
	assert.equal(seeds.folderSummary(b, all), '4 blocks, 1 folder');
	assert.equal(seeds.folderSummary(c, all), '4 blocks, 0 folders');
	assert.equal(seeds.folderSummary(folder(5, 'Empty'), all), '0 blocks, 0 folders');
	assert.equal(seeds.folderSummary(folder(6, 'Single', 1), all), '1 block, 0 folders');
	assert.equal(seeds.folderSummary({ ...a, counts: { blocks: 2 } }, all), '6 blocks, 2 folders');
});

test('descendant lookup includes deep folders even when an intermediate folder is missing', () => {
	const a = folder(1, 'A');
	const c = folder(3, 'A > Missing > C', 4);
	assert.deepEqual(seeds.folderMembers(a, tree([a, c])).map((item) => item.id), [1, 3]);
	assert.equal(seeds.folderSummary(a, tree([a, c])), '4 blocks, 1 folder');
});

test('folder tile and list labels use recursive totals and update with the channel list', () => {
	const a = folder(1, 'A');
	channels.items = [a, folder(2, 'A > B'), folder(3, 'A > B > C', 4)];
	const source = { slug: 'parent', id: 9 };
	const tile = () => render(Tile, { props: { item: a, width: 200, source, onopen() {} } }).body;
	const list = () => render(BlockList, { props: { items: [a], source, onopen() {}, onchannel() {} } }).body;
	assert.match(tile(), /4 blocks, 2 folders/);
	assert.match(list(), /4 blocks, 2 folders/);
	channels.adjustCount(3, 1);
	assert.match(tile(), /5 blocks, 2 folders/);
	channels.retitle(new Map([[3, '🌱 Elsewhere > C']]));
	assert.match(list(), /0 blocks, 1 folder/);
});

test('entirely empty subtrees are cached immediately without occupying fetch slots', () => {
	const previews = new Previews();
	for (let id = 1; id <= 4; id++) {
		const empty = folder(id, `Empty ${id}`);
		previews.request(empty);
		assert.deepEqual(previews.get(id), []);
	}
});

test('empty ancestors obtain thumbnails from a grandchild without fetching empty folders', async () => {
	const a = folder(1, 'A');
	const items = [a, folder(2, 'A > B'), folder(3, 'A > B > C', 4)];
	const requests = mockContents({ 'folder-3': [[image(1), image(2), image(3), image(4)]] });
	const previews = new Previews();
	previews.request(a, seeds.folderMembers(a, tree(items)));
	assert.deepEqual(await ready(previews, 1), [1, 2, 3, 4].map((id) => image(id).image.square.src));
	assert.deepEqual(requests, [['folder-3', 1]]);
});

test('previews prefer direct images, page past non-image blocks, deduplicate and stop at four', async () => {
	const a = folder(1, 'A', 2);
	const b = folder(2, 'A > B', 5);
	const requests = mockContents({
		'folder-1': [[{ id: 1, type: 'Text', content: { plain: 'Text' } }], [image(1)]],
		'folder-2': [[image(1), image(2), image(3), image(4), image(5)]]
	});
	const previews = new Previews();
	previews.request(a, [a, b]);
	assert.deepEqual(await ready(previews, 1), [1, 2, 3, 4].map((id) => image(id).image.square.src));
	assert.deepEqual(requests, [['folder-1', 1], ['folder-1', 2], ['folder-2', 1]]);
});

test('an inaccessible descendant does not prevent thumbnails from other descendants', async () => {
	const a = folder(1, 'A');
	const requests = mockContents({
		'folder-2': [new Error('Unavailable')], 'folder-3': [[image(3)]]
	});
	const previews = new Previews();
	previews.request(a, [a, folder(2, 'A > B', 1), folder(3, 'A > C', 1)]);
	assert.deepEqual(await ready(previews, 1), [image(3).image.square.src]);
	assert.equal(requests.length, 2);
});

test('changing or invalidating a descendant refreshes its ancestor preview', async () => {
	const a = folder(1, 'A');
	const b = folder(2, 'A > B', 1);
	mockContents({ 'folder-2': [[image(1)]] });
	const previews = new Previews();
	previews.request(a, [a, b]);
	await ready(previews, 1);
	previews.invalidate(2);
	assert.equal(previews.get(1), undefined);
	mockContents({ 'folder-2': [[image(2)]] });
	previews.request(a, [a, b]);
	assert.deepEqual(await ready(previews, 1), [image(2).image.square.src]);
	previews.request(a, [a]);
	assert.deepEqual(await ready(previews, 1), []);
});
