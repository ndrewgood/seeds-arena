import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, channels, nav, feeds, render, ChannelView;

before(async () => {
	server = await createServer({
		configFile: false,
		plugins: [
			{
				name: 'test-navigation',
				resolveId(id) { if (id === '$app/navigation') return '\0test-navigation'; },
				load(id) { if (id === '\0test-navigation') return 'export function goto() {}'; }
			},
			svelte({ configFile: false, hot: false })
		],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
	({ nav } = await server.ssrLoadModule('/src/lib/nav.svelte.ts'));
	feeds = await server.ssrLoadModule('/src/lib/feed.svelte.ts');
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: ChannelView } = await server.ssrLoadModule('/src/lib/components/ChannelView.svelte'));
});
afterEach(() => { channels.items = []; nav.clear(); });
after(async () => { await server?.close(); });

function folder(id, path, slug = `breadcrumb-${id}`) {
	return { id, type: 'Channel', slug, title: `🌱 ${path}`, counts: { blocks: 0, channels: 0, contents: 0 } };
}
function heading(channel) {
	const feed = feeds.refreshFeed(channel.slug, 'position_desc');
	feed.channel = channel;
	feed.items = [];
	return render(ChannelView, { props: { slug: channel.slug } }).body.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
}

test('every ancestor is a clickable breadcrumb without a separate back button', () => {
	const a = folder(1, 'Test');
	const b = folder(2, 'Test > Test 2');
	const c = folder(3, 'Test > Test 2 > Test 3');
	channels.items = [a, b, c];
	nav.push({ slug: b.slug, title: 'Test 2' });
	const html = heading(c);
	assert.match(html, /aria-label="Breadcrumb"/);
	assert.match(html, /href="\/c\/breadcrumb-1"[^>]*>Test<\/a>/);
	assert.match(html, /href="\/c\/breadcrumb-2"[^>]*>Test 2<\/a>/);
	assert.match(html, /<h1\b[^>]*>Test 3<\/h1>/);
	assert.doesNotMatch(html, /class="back"|Back to/);
	assert.doesNotMatch(html, /href="\/c\/breadcrumb-3"/);
});

test('directly opened nested folders resolve ancestors without a navigation trail', () => {
	const a = folder(4, 'A', 'parent with spaces');
	const b = folder(5, 'A > B');
	channels.items = [a, b];
	assert.match(heading(b), /href="\/c\/parent%20with%20spaces"[^>]*>A<\/a>/);
	const renamed = { ...a, slug: 'renamed-parent' };
	channels.items = [renamed, b];
	assert.match(heading(b), /href="\/c\/renamed-parent"[^>]*>A<\/a>/);
});

test('missing ancestors stay readable without inventing a link', () => {
	const a = folder(6, 'A');
	const c = folder(7, 'A > Missing > C');
	channels.items = [a, c];
	const html = heading(c);
	assert.match(html, /href="\/c\/breadcrumb-6"[^>]*>A<\/a>/);
	assert.match(html, /<span>Missing<\/span>/);
	assert.doesNotMatch(html, /<a[^>]*>Missing<\/a>/);
});

test('top-level folders have no ancestor breadcrumbs even when opened from another channel', () => {
	const a = folder(8, 'A');
	channels.items = [a];
	nav.push({ slug: 'unrelated', title: 'Unrelated' });
	const html = heading(a);
	assert.doesNotMatch(html, /aria-label="Breadcrumb"|Unrelated|class="back"/);
});

test('ordinary channels retain their navigation trail as clickable breadcrumbs', () => {
	const channel = { ...folder(9, 'Channel'), title: 'Regular channel' };
	channels.items = [channel];
	nav.push({ slug: 'origin', title: 'Origin' });
	assert.match(heading(channel), /href="\/c\/origin"[^>]*>Origin<\/a>/);
});
