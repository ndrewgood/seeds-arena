import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, arena, feeds, render, Viewer, BlockEditor;
const originalFetch = globalThis.fetch;

before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [svelte({ configFile: false, hot: false })],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	arena = await server.ssrLoadModule('/src/lib/arena.ts');
	feeds = await server.ssrLoadModule('/src/lib/feed.svelte.ts');
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: Viewer } = await server.ssrLoadModule('/src/lib/components/Viewer.svelte'));
	({ default: BlockEditor } = await server.ssrLoadModule('/src/lib/components/BlockEditor.svelte'));
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	arena.setToken(null);
	arena.setUnauthorizedHandler(null);
});
after(async () => { await server?.close(); });

test('Viewer renders Close, Edit block and Open in Are.na without Move', () => {
	const { body } = render(Viewer, {
		props: {
			items: [block(42, { connection: { id: 99 } })], index: 0, source: { slug: 'test-channel', id: 1 },
			onclose() {}, onstep() {}
		}
	});
	assert.match(body, /<button\b[^>]*aria-label="Close"[^>]*>/);
	assert.match(body, /<button\b[^>]*aria-label="Edit block"[^>]*>/);
	const removeButton = body.match(/<button\b[^>]*aria-label="Remove block from folder"[^>]*>/)?.[0];
	assert.ok(removeButton);
	assert.doesNotMatch(removeButton, /\bdisabled\b/);
	assert.match(body, /<a\b[^>]*href="https:\/\/www\.are\.na\/block\/42"[^>]*>Open in Are\.na<\/a>/);
	assert.doesNotMatch(body, /\bMove\b/i);
});

test('BlockEditor prefills title and original Markdown and renders Cancel and Save', () => {
	const item = block(42, {
		title: 'Title to edit',
		description: {
			markdown: '**Original**\n\n[description](https://example.com)',
			html: '<p>Rendered description</p>', plain: 'Plain description'
		}
	});
	const { body } = render(BlockEditor, { props: { item, oncancel() {}, onsaved() {} } });
	assert.match(body, /<label\b[^>]*for="block-title"[^>]*>Title<\/label>/);
	assert.match(body, /<input\b(?=[^>]*id="block-title")(?=[^>]*value="Title to edit")[^>]*>/);
	assert.match(body, /<label\b[^>]*for="block-description"[^>]*>Description<\/label>/);
	const description = body.match(/<textarea\b[^>]*id="block-description"[^>]*>([\s\S]*?)<\/textarea>/);
	assert.ok(description);
	assert.equal(description[1], item.description.markdown);
	assert.match(body, /<button\b[^>]*type="button"[^>]*>Cancel<\/button>/);
	assert.match(body, /<button\b[^>]*type="submit"[^>]*>Save<\/button>/);
	assert.doesNotMatch(body, /Rendered description|Plain description/);
});

test('BlockEditor safely escapes title attributes and Markdown textarea values', () => {
	const item = block(42, {
		title: '\"><img src=x onerror=alert(1)> & title',
		description: markdown('</textarea><script>alert("description")</script> & **markdown**')
	});
	const { body } = render(BlockEditor, { props: { item, oncancel() {}, onsaved() {} } });
	const title = body.match(/<input\b[^>]*id="block-title"[^>]*>/);
	assert.ok(title);
	assert.ok(body.includes('value="&quot;>&lt;img src=x onerror=alert(1)> &amp; title"'));
	const description = body.match(/<textarea\b[^>]*id="block-description"[^>]*>([\s\S]*?)<\/textarea>/);
	assert.ok(description);
	assert.equal(description[1], '&lt;/textarea>&lt;script>alert("description")&lt;/script> &amp; **markdown**');
	assert.doesNotMatch(body, /<img\b|<script\b/i);
	assert.equal((body.match(/<\/textarea>/g) ?? []).length, 1);
});

function markdown(value) {
	return { markdown: value, html: `<p>${value}</p>`, plain: value };
}

function block(id, overrides = {}) {
	return {
		id, base_type: 'Block', type: 'Text', title: 'Original title',
		description: markdown('Original description'), content: markdown('Unchanged content'),
		state: 'available', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
		user: { id: 1, type: 'User', name: 'Tester', slug: 'tester', avatar: null, initials: 'T' },
		...overrides
	};
}

function assertUpdatedFeed({ feed, header, original, other, channel, slug, sort }, updated) {
	assert.strictEqual(feeds.getFeed(slug, sort), feed);
	assert.strictEqual(feed.channel, header);
	assert.equal(feed.items.length, 3);
	assert.strictEqual(feed.items[0], other);
	assert.strictEqual(feed.items[2], channel);
	assert.deepEqual(feed.items[1], { ...updated, connection: original.connection });
	assert.strictEqual(feed.items[1].connection, original.connection);
	assert.notStrictEqual(feed.items[1], original);
	assert.equal(original.title, 'Original title');
	assert.equal(feed.total, 12);
	assert.equal(feed.pages, 2);
	assert.equal(feed.hasMore, true);
	assert.equal(feed.error, 'Existing error');
	assert.equal(feed.started, false);
	assert.equal(feed.loading, false);
}

function connection(id) {
	return Object.freeze({ id, position: id, pinned: id % 2 === 0, connected_at: '2026-01-02T00:00:00Z' });
}

test('updateBlock sends authenticated PUT with top-level title and markdown description and returns the block', async () => {
	arena.setToken('block-edit-token');
	const input = Object.freeze({ title: 'Edited title', description: '**Edited**\n\nDescription' });
	const response = block(42, { title: input.title, description: markdown(input.description) });
	let calls = 0;
	globalThis.fetch = async (url, options) => {
		calls++;
		assert.equal(String(url), 'https://api.are.na/v3/blocks/42');
		assert.equal(options.method, 'PUT');
		assert.deepEqual(options.headers, {
			Accept: 'application/json', Authorization: 'Bearer block-edit-token', 'Content-Type': 'application/json'
		});
		assert.deepEqual(JSON.parse(options.body), input);
		return Response.json(response);
	};
	assert.deepEqual(await arena.updateBlock(42, input), response);
	assert.equal(calls, 1);
});

test('updateBlock omits unspecified fields and sends empty strings for explicit clears', async () => {
	const cases = [
		[{ title: 'Title only' }, { title: 'Title only' }],
		[{ description: '**Description only**' }, { description: '**Description only**' }],
		[{ title: '', description: '' }, { title: '', description: '' }],
		[{ description: null }, { description: '' }],
		[{ title: undefined, description: undefined }, {}]
	];
	for (const [input, expected] of cases) {
		const frozenInput = Object.freeze(input);
		globalThis.fetch = async (url, options) => {
			assert.equal(new URL(url).pathname, '/v3/blocks/42');
			assert.equal(options.method, 'PUT');
			assert.equal(options.headers.Authorization, undefined);
			assert.deepEqual(JSON.parse(options.body), expected);
			return Response.json(block(42));
		};
		await arena.updateBlock(42, frozenInput);
		assert.deepEqual(frozenInput, input);
	}
});

test('updateBlock propagates 401 errors through the existing unauthorized handler', async () => {
	arena.setToken('expired-token');
	let unauthorized = 0;
	arena.setUnauthorizedHandler(() => { unauthorized++; });
	globalThis.fetch = async (_url, options) => {
		assert.equal(options.headers.Authorization, 'Bearer expired-token');
		return Response.json({ error: { message: 'Token expired' } }, { status: 401 });
	};
	await assert.rejects(arena.updateBlock(42, { title: 'Edited' }), (error) => {
		assert.ok(error instanceof arena.ArenaError);
		assert.equal(error.status, 401);
		assert.equal(error.message, 'Token expired');
		return true;
	});
	assert.equal(unauthorized, 1);
});

test('updateBlock preserves write-scope guidance on 403 errors', async () => {
	arena.setToken('read-only-token');
	let unauthorized = 0;
	arena.setUnauthorizedHandler(() => { unauthorized++; });
	globalThis.fetch = async () => Response.json({ error: 'Forbidden' }, { status: 403 });
	await assert.rejects(arena.updateBlock(42, { description: 'Edited' }), (error) => {
		assert.ok(error instanceof arena.ArenaError);
		assert.equal(error.status, 403);
		assert.equal(error.message, 'Forbidden Seeds needs a token with read and write access.');
		return true;
	});
	assert.equal(unauthorized, 0);
});

test('updateBlockFeeds leaves unrelated, channel-only and empty feeds untouched', () => {
	for (const items of [[], [block(900)], [{ id: 901, type: 'Channel', title: 'Same ID channel' }]]) {
		const feed = feeds.refreshFeed(`unrelated-${items.length}-${items[0]?.type}`, 'position_desc');
		feed.items = Object.freeze(items);
		feeds.updateBlockFeeds(block(901, { title: 'Saved' }));
		assert.strictEqual(feed.items, items);
	}
});

test('updateBlockFeeds preserves null and absent cached connections rather than taking response context', () => {
	const feed = feeds.refreshFeed('block-edit-no-connection', 'position_desc');
	const originals = [Object.freeze(block(902)), Object.freeze(block(902, { connection: null }))];
	feed.items = Object.freeze(originals);
	const updated = Object.freeze(block(902, { title: 'Saved', connection: connection(999) }));
	feeds.updateBlockFeeds(updated);
	for (const [index, original] of originals.entries()) {
		assert.deepEqual(feed.items[index], { ...updated, connection: original.connection });
		assert.strictEqual(feed.items[index].connection, original.connection);
	}
	assert.equal(updated.connection.id, 999);
});

for (const includeConnection of [false, true]) {
	test(`updateBlockFeeds updates all channels/sorts with response connection ${includeConnection ? 'present' : 'omitted'}`, () => {
		const updated = Object.freeze(block(700, {
			title: 'Saved title', description: markdown('Saved description'),
			updated_at: '2026-02-01T00:00:00Z',
			...(includeConnection ? { connection: connection(999) } : {})
		}));
		const snapshots = [];
		for (const slug of ['block-edit-a', 'block-edit-b']) {
			for (const sort of ['position_desc', 'created_at_desc', 'created_at_asc']) {
				const feed = feeds.refreshFeed(slug, sort);
				const header = Object.freeze({ id: 700, type: 'Channel', slug, title: 'Header' });
				const original = Object.freeze(block(700, { connection: connection(snapshots.length + 1) }));
				const other = Object.freeze(block(701));
				const channel = Object.freeze({ ...header, connection: connection(800) });
				feed.channel = header;
				feed.items = Object.freeze([other, original, channel]);
				feed.total = 12;
				feed.pages = 2;
				feed.hasMore = true;
				feed.error = 'Existing error';
				snapshots.push({ feed, header, original, other, channel, slug, sort });
			}
		}
		feeds.updateBlockFeeds(updated);
		for (const entry of snapshots) {
			assertUpdatedFeed(entry, updated);
		}
	});
}