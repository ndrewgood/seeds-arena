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

function batchFixture() {
	const f = fixture();
	const items = [f.item, ...[1, 2].map((offset) => ({
		...f.item, id: f.item.id + offset, connection: { id: f.item.connection.id + offset }
	}))];
	for (const feed of f.sourceFeeds) feed.items = [...items, f.other];
	f.sourceItems = f.sourceFeeds.map((feed) => feed.items);
	return {
		...f, items,
		drag: dnd.blockDragFor(f.item, { slug: f.source.slug, id: f.source.id }, items)
	};
}

test('batch moves await each connect and disconnect before the next block and refresh only after all writes', async () => {
	const f = batchFixture();
	let resolve;
	respond = () => new Promise((done) => { resolve = done; });
	const refreshes = [];
	for (const feed of f.targetFeeds) {
		feed.started = true;
		feed.refresh = async () => refreshes.push({ sort: feed.sort, writes: calls.length });
	}
	const pending = moveBlock(f.drag, f.target);
	for (let index = 0; index < 6; index++) {
		assert.equal(calls.length, index + 1, 'only one write may be in flight');
		assert.deepEqual(refreshes, []);
		assert.equal(toast.items.length, 0, 'no per-block notifications');
		const block = f.items[Math.floor(index / 2)];
		if (index % 2 === 0) {
			assert.equal(calls[index].method, 'POST');
			assert.equal(JSON.parse(calls[index].body).connectable_id, block.id);
		} else {
			assert.equal(calls[index].method, 'DELETE');
			assert.ok(calls[index].url.endsWith(`/connections/${block.connection.id}`));
		}
		resolve(Response.json({ data: [] }));
		await setImmediate();
	}
	assert.equal(await pending, true);
	assert.deepEqual(refreshes, sorts.map((sort) => ({ sort, writes: 6 })));
	for (const feed of f.sourceFeeds) {
		assert.deepEqual(feed.items, [f.other]);
		assert.equal(feed.total, 1);
	}
	assert.equal(channels.bySlug(f.source.slug).counts.blocks, 0);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 6);
	assert.equal(previews.get(f.source.id), undefined);
	assert.equal(previews.get(f.target.id), undefined);
	assert.equal(f.otherFeed.items[0].id, f.item.id);
	assert.equal(toast.items.length, 1);
	assert.equal(toast.items[0].kind, 'success');
	assert.match(toast.items[0].text, /Moved 3 blocks to “Destination”/);
});

test('batch refresh fetches final target contents once per started sort, never intermediate contents', async () => {
	const f = batchFixture();
	let writes = 0;
	for (const feed of f.targetFeeds) {
		feed.started = true;
		feed.hasMore = false;
	}
	respond = (input, options) => {
		if (options.method === 'POST') {
			writes++;
			return Response.json({ data: [] });
		}
		assert.equal(writes, 3, 'refresh must wait for the last connection');
		const url = new URL(input);
		if (url.pathname.endsWith('/contents')) {
			return Response.json({ data: f.items, meta: { total_count: 7, has_more_pages: false } });
		}
		return Response.json({ ...f.target, counts: { ...f.target.counts, blocks: 6, contents: 7 } });
	};
	assert.equal(await moveBlock(f.drag, f.target, true), true);
	await setImmediate();
	assert.equal(calls.filter((call) => new URL(call.url).pathname.endsWith('/contents')).length, sorts.length);
	for (const feed of f.targetFeeds) {
		for (const item of f.items) assert.ok(feed.items.some((entry) => entry.id === item.id));
		assert.equal(feed.total, 7);
	}
	assertSourceUntouched(f);
});

test('batch blocks without source connection IDs connect without issuing a delete for that block', async () => {
	const f = batchFixture();
	f.drag.blocks[1].connectionId = null;
	assert.equal(await moveBlock(f.drag, f.target), true);
	assert.equal(calls.filter((call) => call.method === 'POST').length, 3);
	assert.deepEqual(calls.filter((call) => call.method === 'DELETE').map((call) => call.url),
		[f.items[0], f.items[2]].map((item) => `https://api.are.na/v3/connections/${item.connection.id}`));
});

test('singleton disconnect failure retains its existing error, successful return and both connections', async () => {
	const f = fixture();
	respond = (input, options) => options.method === 'DELETE'
		? Response.json({ error: 'Disconnect failed' }, { status: 500 })
		: Response.json({ data: [] });
	assert.equal(await moveBlock(f.drag, f.target), true);
	for (const feed of f.sourceFeeds) assert.deepEqual(feed.items, [f.item, f.other]);
	assert.deepEqual(channels.bySlug(f.source.slug).counts, f.source.counts);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 4);
	assert.equal(toast.items.length, 1);
	assert.equal(toast.items[0].kind, 'error');
	assert.match(toast.items[0].text, /Added to “Destination” but couldn't remove it from the original/);
});

test('batch copy keeps source caches untouched, connects each distinct block once and emits one toast', async () => {
	const f = batchFixture();
	f.drag.blocks.push({ ...f.drag.blocks[0] });
	assert.equal(await moveBlock(f.drag, f.target, true), true);
	assert.deepEqual(calls.map((call) => call.method), ['POST', 'POST', 'POST']);
	assert.deepEqual(calls.map((call) => JSON.parse(call.body).connectable_id), f.items.map((item) => item.id));
	assertSourceUntouched(f);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 6);
	assert.equal(previews.get(f.target.id), undefined);
	assert.equal(toast.items.length, 1);
	assert.match(toast.items[0].text, /Connected 3 blocks to “Destination”/);
});

for (const copy of [false, true]) {
	test(`batch ${copy ? 'copy' : 'move'} continues after a failed connect and rolls back only that block`, async () => {
		const f = batchFixture();
		respond = (input, options) => options.method === 'POST' && JSON.parse(options.body).connectable_id === f.items[1].id
			? Response.json({ error: 'Connect failed' }, { status: 500 })
			: Response.json({ data: [] });
		assert.equal(await moveBlock(f.drag, f.target, copy), true);
		assert.equal(calls.filter((call) => call.method === 'POST').length, 3);
		assert.equal(calls.filter((call) => call.method === 'DELETE').length, copy ? 0 : 2);
		if (copy) assertSourceUntouched(f);
		else {
			for (const feed of f.sourceFeeds) {
				assert.deepEqual(feed.items, [f.items[1], f.other]);
				assert.equal(feed.total, 2);
			}
			assert.equal(channels.bySlug(f.source.slug).counts.blocks, 1);
		}
		assert.equal(channels.bySlug(f.target.slug).counts.blocks, 5);
		assert.equal(toast.items.length, 1);
		assert.equal(toast.items[0].kind, 'error');
		assert.match(toast.items[0].text, /Added 2 of 3 blocks/);
		assert.match(toast.items[0].text, /Connect failed/);
	});
}

test('batch disconnect failure restores that source block but keeps its successful target connection', async () => {
	const f = batchFixture();
	respond = (input, options) => options.method === 'DELETE' && String(input).endsWith(`/${f.items[1].connection.id}`)
		? Response.json({ error: 'Disconnect failed' }, { status: 500 })
		: Response.json({ data: [] });
	assert.equal(await moveBlock(f.drag, f.target), true);
	assert.deepEqual(calls.map((call) => call.method), ['POST', 'DELETE', 'POST', 'DELETE', 'POST', 'DELETE']);
	for (const feed of f.sourceFeeds) assert.deepEqual(feed.items, [f.items[1], f.other]);
	assert.equal(channels.bySlug(f.source.slug).counts.blocks, 1);
	assert.equal(channels.bySlug(f.target.slug).counts.blocks, 6);
	assert.equal(toast.items.length, 1);
	assert.equal(toast.items[0].kind, 'error');
	assert.match(toast.items[0].text, /Added 3 of 3 blocks/);
	assert.match(toast.items[0].text, /couldn't remove it from the original/);
});

test('all failed batch connects restore original ordering and counts without refreshing or invalidating', async () => {
	const f = batchFixture();
	respond = () => Response.json({ error: 'Offline' }, { status: 500 });
	assert.equal(await moveBlock(f.drag, f.target), false);
	assert.equal(calls.length, 3);
	for (const feed of f.sourceFeeds) {
		assert.deepEqual(feed.items, [...f.items, f.other]);
		assert.equal(feed.total, 4);
	}
	assert.deepEqual(channels.bySlug(f.source.slug).counts, f.source.counts);
	assert.deepEqual(channels.bySlug(f.target.slug).counts, f.target.counts);
	assert.deepEqual(previews.get(f.source.id), []);
	assert.deepEqual(previews.get(f.target.id), []);
	for (const feed of f.targetFeeds) assert.strictEqual(feeds.getFeed(f.target.slug, feed.sort), feed);
	assert.equal(toast.items.length, 1);
	assert.match(toast.items[0].text, /Added 0 of 3 blocks/);
});

test('same-source batches are silent no-ops for both slug and ID, including copies', async () => {
	const f = batchFixture();
	for (const copy of [false, true]) {
		for (const target of [f.source, { ...f.target, id: f.source.id }, { ...f.target, slug: f.source.slug }]) {
			assert.equal(await moveBlock(f.drag, target, copy), false);
		}
	}
	assert.deepEqual(calls, []);
	assert.deepEqual(toast.items, []);
	assertSourceUntouched(f);
});

for (const dropMetaKey of [false, true]) {
	test(`batch drop snapshots payload and release copy=${dropMetaKey} synchronously`, async () => {
		const f = batchFixture();
		let serialized = JSON.stringify(f.drag);
		const event = { dataTransfer: { getData: () => serialized }, metaKey: dropMetaKey };
		handleChannelDrop(event, 'block', f.target);
		serialized = '';
		event.metaKey = !dropMetaKey;
		dnd.dnd.reset();
		await setImmediate();
		assert.equal(calls.filter((call) => call.method === 'POST').length, 3);
		assert.equal(calls.filter((call) => call.method === 'DELETE').length, dropMetaKey ? 0 : 3);
		assert.equal(toast.items.length, 1);
		if (dropMetaKey) assertSourceUntouched(f);
	});
}

test('malformed batch drop is ignored rather than moving only the anchor', async () => {
	const f = batchFixture();
	const dataTransfer = { getData: () => JSON.stringify({ ...f.drag, blocks: [] }) };
	handleChannelDrop({ dataTransfer, metaKey: false }, 'block', f.target);
	await setImmediate();
	assert.deepEqual(calls, []);
	assert.deepEqual(toast.items, []);
});

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
