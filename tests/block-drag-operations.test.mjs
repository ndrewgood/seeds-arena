import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, arena, channels, feeds, previews, toast, dnd, moveBlock, handleChannelDrop;
let calls, respond, sequence = 0;
const originalFetch = globalThis.fetch;
const sorts = ['position_desc', 'created_at_desc', 'created_at_asc'];

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
	({ previews } = await server.ssrLoadModule('/src/lib/previews.svelte.ts'));
	({ toast } = await server.ssrLoadModule('/src/lib/toast.svelte.ts'));
	dnd = await server.ssrLoadModule('/src/lib/dnd.svelte.ts');
	({ moveBlock, handleChannelDrop } = await server.ssrLoadModule('/src/lib/operations.ts'));
});

beforeEach(() => {
	calls = [];
	respond = () => Response.json({ data: [] });
	globalThis.fetch = async (input, options = {}) => {
		calls.push({ url: String(input), ...options });
		return respond(input, options);
	};
	arena.setToken('block-drag-test-token');
	channels.reset('tester');
	dnd.dnd.reset();
	for (const item of toast.items) toast.dismiss(item.id);
});

after(async () => {
	globalThis.fetch = originalFetch;
	arena?.setToken(null);
	for (const item of toast?.items ?? []) toast.dismiss(item.id);
	await server?.close();
});

function channel(id, title) {
	return {
		id, type: 'Channel', slug: `block-drag-${id}`, title, state: 'available',
		counts: { blocks: 3, channels: 1, contents: 4, collaborators: 0 }
	};
}

function fixture() {
	const base = ++sequence * 100;
	const source = channel(base + 1, '🌱 Source');
	const target = channel(base + 2, '🌱 Destination');
	const other = channel(base + 3, '🌱 Other');
	const item = {
		id: base + 10, type: 'Text', base_type: 'Block', title: 'Shared block',
		connection: { id: base + 20 }
	};
	for (const c of [source, target, other]) {
		channels.add(c);
		previews.request({ ...c, counts: { ...c.counts, blocks: 0 } });
	}
	const populate = (c, sort, items) => {
		const feed = feeds.refreshFeed(c.slug, sort);
		feed.channel = c;
		feed.items = items;
		feed.total = 4;
		return feed;
	};
	const sourceFeeds = sorts.map((sort) => populate(source, sort, [item, other]));
	const sourceItems = sourceFeeds.map((feed) => feed.items);
	const targetFeeds = sorts.map((sort) => populate(target, sort, [other]));
	const otherFeed = populate(other, sorts[0], [{ ...item, connection: { id: base + 21 } }]);
	const drag = {
		kind: 'block', blockId: item.id, connectionId: item.connection.id,
		sourceSlug: source.slug, sourceId: source.id
	};
	return { source, target, other, item, drag, sourceFeeds, sourceItems, targetFeeds, otherFeed };
}

function assertConnect(f) {
	assert.equal(calls[0].url, 'https://api.are.na/v3/connections');
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].headers.Authorization, 'Bearer block-drag-test-token');
	assert.deepEqual(JSON.parse(calls[0].body), {
		connectable_id: f.item.id, connectable_type: 'Block', channel_ids: [f.target.id]
	});
}

function assertSourceUntouched(f) {
	assert.strictEqual(channels.bySlug(f.source.slug), f.source);
	assert.deepEqual(previews.get(f.source.id), []);
	f.sourceFeeds.forEach((feed, i) => {
		assert.strictEqual(feeds.getFeed(f.source.slug, sorts[i]), feed);
		assert.strictEqual(feed.items, f.sourceItems[i]);
		assert.strictEqual(feed.channel, f.source);
		assert.equal(feed.total, 4);
		assert.strictEqual(feed.items[0], f.item);
	});
	assert.equal(f.otherFeed.items[0].id, f.item.id);
	assert.deepEqual(previews.get(f.other.id), []);
}

function deferredResponse() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	respond = () => promise;
	return resolve;
}

test('default move connects before disconnecting and removes the source across all sorts', async () => {
	const f = fixture();
	const resolve = deferredResponse();
	const pending = moveBlock(f.drag, f.target);
	assert.equal(calls.length, 1, 'disconnect must wait for connect success');
	assertConnect(f);
	for (const feed of f.sourceFeeds) {
		assert.deepEqual(feed.items, [f.other]);
		assert.equal(feed.total, 3);
	}
	assert.equal(channels.bySlug(f.source.slug).counts.blocks, 2);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 4);
	resolve(Response.json({ data: [] }));
	assert.equal(await pending, true);
	assert.equal(calls.length, 2);
	assert.equal(calls[1].url, `https://api.are.na/v3/connections/${f.drag.connectionId}`);
	assert.equal(calls[1].method, 'DELETE');
	assert.equal(previews.get(f.source.id), undefined);
	assert.equal(previews.get(f.target.id), undefined);
	for (const feed of f.targetFeeds) {
		assert.notStrictEqual(feeds.getFeed(f.target.slug, feed.sort), feed, 'unstarted target cache evicted');
	}
});

test('copy connects only, preserves every source sort and updates target counts and previews', async () => {
	const f = fixture();
	const resolve = deferredResponse();
	const pending = moveBlock(f.drag, f.target, true);
	assertSourceUntouched(f);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 4);
	assert.equal(channels.bySlug(f.target.slug).counts.contents, 5);
	assert.equal(channels.bySlug(f.target.slug).counts.channels, 1);
	resolve(Response.json({ data: [] }));
	assert.equal(await pending, true);
	assert.equal(calls.length, 1);
	assertConnect(f);
	assertSourceUntouched(f);
	assert.equal(previews.get(f.target.id), undefined);
	for (const feed of f.targetFeeds) {
		assert.notStrictEqual(feeds.getFeed(f.target.slug, feed.sort), feed);
	}
	assert.equal(toast.items.at(-1).kind, 'success');
	assert.match(toast.items.at(-1).text, /Connected to “Destination”/);
});

test('copy refreshes started target feeds without refreshing the source', async () => {
	const f = fixture();
	for (const feed of [...f.sourceFeeds, ...f.targetFeeds]) {
		feed.started = true;
		feed.hasMore = false;
	}
	respond = (input, options) => {
		if (options.method === 'POST') return Response.json({ data: [] });
		const url = new URL(input);
		if (url.pathname.endsWith('/contents')) {
			assert.equal(url.pathname, `/v3/channels/${f.target.slug}/contents`);
			return Response.json({ data: [f.item], meta: { total_count: 5, has_more_pages: false } });
		}
		assert.equal(url.pathname, `/v3/channels/${f.target.slug}`);
		return Response.json({ ...f.target, counts: { ...f.target.counts, blocks: 4, contents: 5 } });
	};
	assert.equal(await moveBlock(f.drag, f.target, true), true);
	await setImmediate();
	assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
	assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
	assert.equal(calls.filter((call) => new URL(call.url).pathname.endsWith('/contents')).length, sorts.length);
	for (const feed of f.targetFeeds) {
		assert.ok(feed.items.some((item) => item.id === f.item.id));
		assert.equal(feed.total, 5);
		assert.equal(feed.channel.counts.blocks, 4);
	}
	assertSourceUntouched(f);
});

for (const failure of ['api', 'network']) {
	test(`copy ${failure} failure rolls back target counts and leaves source and target caches untouched`, async () => {
		const f = fixture();
		const resolve = deferredResponse();
		const pending = moveBlock(f.drag, f.target, true);
		assert.equal(channels.bySlug(f.target.slug).counts.blocks, 4);
		assertSourceUntouched(f);
		if (failure === 'api') {
			resolve(Response.json({ error: 'Connect failed' }, { status: 500 }));
		} else {
			resolve(Promise.reject(new TypeError('Offline')));
		}
		assert.equal(await pending, false);
		assert.equal(calls.length, 1);
		assertConnect(f);
		assertSourceUntouched(f);
		assert.deepEqual(channels.bySlug(f.target.slug).counts, f.target.counts);
		assert.deepEqual(previews.get(f.target.id), []);
		for (const feed of f.targetFeeds) {
			assert.strictEqual(feeds.getFeed(f.target.slug, feed.sort), feed);
			assert.strictEqual(feed.channel, f.target);
			assert.deepEqual(feed.items, [f.other]);
			assert.equal(feed.total, 4);
		}
		assert.equal(toast.items.at(-1).kind, 'error');
		assert.match(toast.items.at(-1).text, /Couldn't connect the block/);
	});
}

test('failed default move restores source feeds and both channel counts without disconnecting', async () => {
	const f = fixture();
	respond = () => Response.json({ error: 'Connect failed' }, { status: 500 });
	assert.equal(await moveBlock(f.drag, f.target), false);
	assert.equal(calls.length, 1);
	for (const feed of f.sourceFeeds) {
		assert.deepEqual(feed.items, [f.item, f.other]);
		assert.equal(feed.total, 4);
	}
	assert.deepEqual(channels.bySlug(f.source.slug).counts, f.source.counts);
	assert.deepEqual(channels.bySlug(f.target.slug).counts, f.target.counts);
	assert.deepEqual(previews.get(f.source.id), []);
	assert.deepEqual(previews.get(f.target.id), []);
});

test('same source slug or ID stays a no-op for both move and copy', async () => {
	const f = fixture();
	const records = channels.items;
	for (const copy of [false, true]) {
		for (const target of [f.source, { ...f.target, slug: f.source.slug }, { ...f.target, id: f.source.id }]) {
			assert.equal(await moveBlock(f.drag, target, copy), false);
		}
	}
	assert.deepEqual(calls, []);
	assert.strictEqual(channels.items, records);
	assertSourceUntouched(f);
	assert.deepEqual(previews.get(f.target.id), []);
	assert.deepEqual(toast.items, []);
});

for (const [startMetaKey, dropMetaKey] of [[false, true], [true, false]]) {
	test(`handleChannelDrop uses drop metaKey=${dropMetaKey} after drag started with metaKey=${startMetaKey}`, async () => {
		const f = fixture();
		const data = new Map();
		const dataTransfer = {
			clearData: () => data.clear(),
			setData: (type, value) => data.set(type, value),
			getData: (type) => data.get(type) ?? ''
		};
		dnd.startBlockDrag({ dataTransfer, metaKey: startMetaKey }, f.item, { slug: f.source.slug, id: f.source.id });
		handleChannelDrop({ dataTransfer, metaKey: dropMetaKey }, 'block', f.target);
		await setImmediate();
		assertConnect(f);
		assert.equal(calls.length, dropMetaKey ? 1 : 2);
		if (dropMetaKey) {
			assertSourceUntouched(f);
			assert.match(toast.items.at(-1).text, /Connected/);
		} else {
			assert.equal(calls[1].method, 'DELETE');
			for (const feed of f.sourceFeeds) assert.deepEqual(feed.items, [f.other]);
		}
	});
}
