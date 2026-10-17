import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, channels, renameFolder, feeds, nav, toast;
const originalFetch = globalThis.fetch;
let backend, writes, failId;

before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
	({ renameFolder } = await server.ssrLoadModule('/src/lib/operations.ts'));
	feeds = await server.ssrLoadModule('/src/lib/feed.svelte.ts');
	({ nav } = await server.ssrLoadModule('/src/lib/nav.svelte.ts'));
	({ toast } = await server.ssrLoadModule('/src/lib/toast.svelte.ts'));
	globalThis.fetch = async (input, options = {}) => {
		const url = new URL(input);
		if (url.pathname.endsWith('/contents')) {
			return Response.json({ data: [...backend.values()], meta: { has_more_pages: false } });
		}
		assert.equal(options.method, 'PUT');
		const id = Number(url.pathname.split('/').at(-1));
		const body = JSON.parse(options.body);
		assert.deepEqual(Object.keys(body), ['title']);
		writes.push({ id, ...body });
		if (id === failId) {
			failId = null;
			return Response.json({ error: 'Test failure' }, { status: 500 });
		}
		const channel = { ...backend.get(id), title: body.title, slug: `renamed-${id}` };
		backend.set(id, channel);
		return Response.json(channel);
	};
});

after(async () => {
	globalThis.fetch = originalFetch;
	for (const item of toast?.items ?? []) toast.dismiss(item.id);
	await server?.close();
});

async function setup() {
	backend = new Map([
		[1, { id: 1, type: 'Channel', title: '🌱 Design', slug: 'design' }],
		[2, { id: 2, type: 'Channel', title: '🌱 Design > Type', slug: 'type' }]
	].map(([id, channel]) => [id, {
		...channel, description: { markdown: 'Original text\n\n[seeds-folder-icon]: {"kind":"emoji","value":"🌿"}' },
		counts: { blocks: 3, channels: 0, contents: 3 }, can: { update: true }
	}]));
	writes = [];
	failId = null;
	channels.reset('tester');
	await channels.loadAll();
	nav.clear();
}

test('rename updates backend paths, cached feeds, embedded tiles and navigation', async () => {
	await setup();
	const root = structuredClone(backend.get(1));
	const child = structuredClone(backend.get(2));
	const feed = feeds.refreshFeed(root.slug, 'position_desc');
	feed.channel = root;
	feed.items = [{ ...child, connection: { id: 99 } }];
	nav.push({ slug: root.slug, title: 'Design' });
	assert.equal(await renameFolder(root, 'Art'), true);
	assert.equal(backend.get(1).title, '🌱 Art');
	assert.equal(backend.get(2).title, '🌱 Art > Type');
	assert.deepEqual(backend.get(1).description, root.description);
	assert.deepEqual(backend.get(1).counts, root.counts);
	assert.equal(channels.items.find((c) => c.id === 2).title, '🌱 Art > Type');
	assert.equal(feed.slug, 'renamed-1');
	assert.strictEqual(feeds.getFeed('renamed-1', 'position_desc'), feed);
	assert.equal(feed.items[0].title, '🌱 Art > Type');
	assert.deepEqual(feed.items[0].connection, { id: 99 });
	assert.deepEqual(nav.trail, [{ slug: 'renamed-1', title: 'Art' }]);
});

test('a failed descendant write restores completed backend titles and sidebar state', async () => {
	await setup();
	failId = 2;
	assert.equal(await renameFolder(backend.get(1), 'Art'), false);
	assert.equal(backend.get(1).title, '🌱 Design');
	assert.equal(backend.get(2).title, '🌱 Design > Type');
	assert.equal(channels.items.find((c) => c.id === 1).title, '🌱 Design');
	assert.deepEqual(writes.map((w) => w.id), [1, 2, 1]);
});

test('invalid or unchanged names never issue writes', async () => {
	await setup();
	assert.equal(await renameFolder(backend.get(1), 'Design'), true);
	assert.equal(await renameFolder(backend.get(1), ' '), false);
	assert.equal(await renameFolder(backend.get(1), 'Art > Type'), false);
	assert.deepEqual(writes, []);
});
