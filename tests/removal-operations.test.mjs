import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, arena, channels, feeds, nav, previews, toast, ui, deleteFolder, removeBlockFromFolder;
let calls, respond, sequence = 0;
const originalFetch = globalThis.fetch;

before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	arena = await server.ssrLoadModule('/src/lib/arena.ts');
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
	feeds = await server.ssrLoadModule('/src/lib/feed.svelte.ts');
	({ nav } = await server.ssrLoadModule('/src/lib/nav.svelte.ts'));
	({ previews } = await server.ssrLoadModule('/src/lib/previews.svelte.ts'));
	({ toast } = await server.ssrLoadModule('/src/lib/toast.svelte.ts'));
	({ ui } = await server.ssrLoadModule('/src/lib/ui.svelte.ts'));
	({ deleteFolder, removeBlockFromFolder } = await server.ssrLoadModule('/src/lib/operations.ts'));
});

beforeEach(() => {
	calls = [];
	respond = () => new Response(null, { status: 204 });
	globalThis.fetch = async (input, options = {}) => {
		calls.push({ url: String(input), ...options });
		return respond(input, options);
	};
	arena.setToken('removal-test-token');
	channels.reset('tester');
	ui.folderRenaming = false;
	nav.clear();
	for (const item of toast.items) toast.dismiss(item.id);
});

after(async () => {
	globalThis.fetch = originalFetch;
	arena?.setToken(null);
	for (const item of toast?.items ?? []) toast.dismiss(item.id);
	await server?.close();
});

function channel(id, title, overrides = {}) {
	return {
		id, type: 'Channel', slug: `removal-${id}`, title, state: 'available',
		counts: { blocks: 3, channels: 1, contents: 4, collaborators: 0 },
		can: { destroy: true, update: true }, ...overrides
	};
}

function block(id, connectionId) {
	return { id, type: 'Text', base_type: 'Block', title: 'Shared block', connection: { id: connectionId } };
}

function fixture() {
	const base = ++sequence * 100;
	const folder = channel(base + 1, '🌱 Design');
	const child = channel(base + 2, '🌱 Design > Type');
	const other = channel(base + 3, '🌱 Other');
	const parent = channel(base + 4, 'Parent');
	const item = block(folder.id, base + 10);
	for (const c of [folder, child, other, parent]) channels.add(c);
	const populate = (c, sort, items) => {
		const feed = feeds.refreshFeed(c.slug, sort);
		feed.channel = c;
		feed.items = items;
		feed.total = 4;
		return feed;
	};
	const sourceFeeds = ['position_desc', 'created_at_asc'].map((sort) =>
		populate(folder, sort, [item, { ...child, id: item.id }, child])
	);
	const otherItem = { ...item, connection: { id: base + 11 } };
	const otherFeed = populate(other, 'position_desc', [otherItem, child]);
	const parentFeeds = ['position_desc', 'created_at_desc'].map((sort) =>
		populate(parent, sort, [{ ...folder, connection: { id: base + 12 } }, item, child])
	);
	// Seed previews synchronously without network traffic; invalidation should affect only its targets.
	for (const c of [folder, child, other, parent]) previews.request({ ...c, counts: { ...c.counts, blocks: 0 } });
	nav.trail = [folder, child, other].map((c) => ({ slug: c.slug, title: c.title }));
	return { folder, child, other, parent, item, sourceFeeds, parentFeeds, otherFeed, otherItem,
		source: { slug: folder.slug, id: folder.id } };
}

function assertRequest(path) {
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, `https://api.are.na/v3/${path}`);
	assert.equal(calls[0].method, 'DELETE');
	assert.equal(calls[0].headers.Authorization, 'Bearer removal-test-token');
	assert.equal(calls[0].body, undefined);
}

function deferredResponse() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	respond = () => promise;
	return resolve;
}

test('removeBlockFromFolder waits for disconnect, removes only source blocks, and updates counts/previews', async () => {
	const f = fixture();
	const trail = nav.trail;
	const resolve = deferredResponse();
	const pending = removeBlockFromFolder(f.item, f.source);
	assert.equal(f.sourceFeeds[0].items[0], f.item, 'no optimistic viewer jump');
	assert.equal(channels.bySlug(f.folder.slug).counts.blocks, 3);
	assert.deepEqual(previews.get(f.folder.id), []);
	resolve(new Response(null, { status: 204 }));
	assert.equal(await pending, true);
	assertRequest(`connections/${f.item.connection.id}`);
	for (const feed of f.sourceFeeds) {
		assert.deepEqual(feed.items.map(feeds.keyOf), [`c${f.item.id}`, `c${f.child.id}`]);
		assert.equal(feed.total, 3);
		assert.equal(feed.channel.counts.blocks, 2);
		assert.equal(feed.channel.counts.contents, 3);
		assert.equal(feed.channel.counts.channels, 1);
	}
	assert.equal(channels.bySlug(f.folder.slug).counts.blocks, 2);
	assert.equal(channels.bySlug(f.folder.slug).counts.contents, 3);
	for (const feed of f.parentFeeds) {
		assert.equal(feed.items[0].counts.blocks, 2, 'embedded source-channel badge updated');
		assert.equal(feed.items[1], f.item, 'same block in a different folder kept');
	}
	assert.equal(f.otherFeed.items[0], f.otherItem);
	assert.equal(channels.bySlug(f.other.slug).counts.blocks, 3);
	assert.equal(previews.get(f.folder.id), undefined);
	assert.deepEqual(previews.get(f.other.id), []);
	assert.strictEqual(nav.trail, trail);
	assert.equal(toast.items.at(-1).kind, 'success');
});

test('block removal failure leaves feeds, sidebar counts, previews and navigation untouched', async () => {
	const f = fixture();
	const items = f.sourceFeeds.map((feed) => feed.items);
	const records = channels.items;
	const trail = nav.trail;
	respond = () => Response.json({ error: 'Disconnect failed' }, { status: 500 });
	assert.equal(await removeBlockFromFolder(f.item, f.source), false);
	assertRequest(`connections/${f.item.connection.id}`);
	f.sourceFeeds.forEach((feed, i) => {
		assert.strictEqual(feed.items, items[i]);
		assert.equal(feed.total, 4);
		assert.strictEqual(feed.channel, f.folder);
	});
	assert.strictEqual(channels.items, records);
	assert.strictEqual(nav.trail, trail);
	assert.deepEqual(previews.get(f.folder.id), []);
	assert.match(toast.items.at(-1).text, /Disconnect failed/);
});

test('missing connection refuses removal without fetching or mutating', async () => {
	const f = fixture();
	for (const connection of [undefined, null, {}]) {
		assert.equal(await removeBlockFromFolder({ ...f.item, connection }, f.source), false);
	}
	assert.deepEqual(calls, []);
	assert.equal(f.sourceFeeds[0].items[0], f.item);
	assert.equal(channels.bySlug(f.folder.slug).counts.blocks, 3);
	assert.match(toast.items.at(-1).text, /connection is missing/);
});

test('null source ID resolves counts and preview invalidation from the source slug', async () => {
	const f = fixture();
	assert.equal(await removeBlockFromFolder(f.item, { ...f.source, id: null }), true);
	assert.equal(channels.bySlug(f.folder.slug).counts.blocks, 2);
	assert.equal(previews.get(f.folder.id), undefined);
	assert.equal(f.otherFeed.items[0], f.otherItem);
});

test('deleteFolder waits for API, deletes one channel, evicts caches and prunes only its nav entries', async () => {
	const f = fixture();
	const childFeed = feeds.refreshFeed(f.child.slug, 'position_desc');
	childFeed.channel = f.child;
	childFeed.items = [f.item];
	const resolve = deferredResponse();
	const pending = deleteFolder(f.folder);
	assert.equal(ui.folderRenaming, true);
	assert.ok(channels.bySlug(f.folder.slug));
	assert.strictEqual(feeds.getFeed(f.folder.slug, 'position_desc'), f.sourceFeeds[0]);
	assert.equal(f.parentFeeds[0].items[0].type, 'Channel');
	resolve(Response.json({ id: f.folder.id, state: 'deleted' }));
	assert.equal(await pending, true);
	assert.equal(ui.folderRenaming, false);
	assertRequest(`channels/${f.folder.id}`);
	assert.equal(channels.bySlug(f.folder.slug), null);
	assert.strictEqual(channels.bySlug(f.child.slug), f.child, 'no recursive channel deletion');
	assert.strictEqual(feeds.getFeed(f.child.slug, 'position_desc'), childFeed);
	assert.equal(childFeed.items[0], f.item);
	for (const feed of f.sourceFeeds) {
		assert.notStrictEqual(feeds.getFeed(feed.slug, feed.sort), feed);
		assert.deepEqual(feed.items, []);
		assert.equal(feed.hasMore, false);
	}
	for (const feed of f.parentFeeds) {
		assert.deepEqual(feed.items, [f.item, f.child], 'same-id Block preserved');
		assert.equal(feed.total, 3);
		assert.equal(feed.channel.counts.channels, 0);
		assert.equal(feed.channel.counts.blocks, 3);
	}
	assert.equal(channels.bySlug(f.parent.slug).counts.channels, 0, 'parent decremented once across sorts');
	assert.equal(channels.bySlug(f.parent.slug).counts.contents, 3);
	assert.equal(f.otherFeed.items[0], f.otherItem);
	assert.equal(previews.get(f.folder.id), undefined);
	assert.equal(previews.get(f.parent.id), undefined);
	assert.deepEqual(previews.get(f.child.id), []);
	assert.deepEqual(previews.get(f.other.id), []);
	assert.deepEqual(nav.trail.map((crumb) => crumb.slug), [f.child.slug, f.other.slug]);
	assert.equal(toast.items.at(-1).kind, 'success');
});

test('failed folder deletion preserves records, cache, counts, previews and nav', async () => {
	const f = fixture();
	const records = channels.items;
	const items = f.parentFeeds[0].items;
	const trail = nav.trail;
	respond = () => Response.json({ error: 'Deletion forbidden' }, { status: 403 });
	assert.equal(await deleteFolder(f.folder), false);
	assertRequest(`channels/${f.folder.id}`);
	assert.strictEqual(channels.items, records);
	assert.strictEqual(f.parentFeeds[0].items, items);
	assert.strictEqual(feeds.getFeed(f.folder.slug, 'position_desc'), f.sourceFeeds[0]);
	assert.strictEqual(nav.trail, trail);
	assert.equal(f.parentFeeds[0].total, 4);
	assert.deepEqual(previews.get(f.folder.id), []);
	assert.deepEqual(previews.get(f.parent.id), []);
	assert.equal(ui.folderRenaming, false);
	assert.match(toast.items.at(-1).text, /Deletion forbidden/);
});

test('permission, rename lock and duplicate pending deletion prevent extra API calls', async () => {
	const f = fixture();
	assert.equal(await deleteFolder({ ...f.folder, can: { destroy: false } }), false);
	ui.folderRenaming = true;
	assert.equal(await deleteFolder(f.folder), false);
	ui.folderRenaming = false;
	assert.equal(await deleteFolder({ ...f.folder, title: 'Not a Seeds folder' }), false);
	assert.deepEqual(calls, []);
	const resolve = deferredResponse();
	const pending = deleteFolder(f.folder);
	assert.equal(await deleteFolder(f.folder), false);
	assert.equal(calls.length, 1);
	resolve(new Response(null, { status: 204 }));
	assert.equal(await pending, true);
	assert.equal(ui.folderRenaming, false);
});

test('network failure returns false without any local removal', async () => {
	const f = fixture();
	respond = () => { throw new TypeError('Offline'); };
	assert.equal(await removeBlockFromFolder(f.item, f.source), false);
	assert.equal(await deleteFolder(f.folder), false);
	assert.equal(f.sourceFeeds[0].items[0], f.item);
	assert.ok(channels.bySlug(f.folder.slug));
	assert.equal(ui.folderRenaming, false);
	assert.match(toast.items.at(-1).text, /Could not reach Are.na/);
});
