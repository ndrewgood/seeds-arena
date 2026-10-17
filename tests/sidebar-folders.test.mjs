import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, channels, nav, ui, render, Sidebar;
const originalStorage = globalThis.localStorage;
const originalHandlers = globalThis.__sidebarFolderHandlers;

before(async () => {
	globalThis.localStorage = { getItem: () => null, setItem() {} };
	server = await createServer({
		configFile: false,
		plugins: [
			{
				name: 'test-sidebar',
				enforce: 'pre',
				resolveId(id) {
					if (id === '$app/state' || id === '$app/navigation') return `\0test:${id}`;
				},
				load(id) {
					if (id === '\0test:$app/state') return 'export const page = { params: {}, url: new URL("https://example.com/") };';
					if (id === '\0test:$app/navigation') return 'export function goto() {}';
				},
				transform(code, id) {
					if (!id.endsWith('/components/Sidebar.svelte')) return;
					// Expose the real event closures during SSR tests without a browser dependency.
					return code.replace('</script>', `
						globalThis.__sidebarFolderHandlers = {
							clickFolder, doubleClickFolder, getLastRevealed: () => lastRevealed,
														openSearch, closeSearch, focusOnMount,
														getSearchState: () => ({ open: searchOpen, query }),
														setQuery: (value) => { query = value; }
						};
					</script>`);
				}
			},
			svelte({ configFile: false, hot: false })
		],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
	({ nav } = await server.ssrLoadModule('/src/lib/nav.svelte.ts'));
	({ ui } = await server.ssrLoadModule('/src/lib/ui.svelte.ts'));
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: Sidebar } = await server.ssrLoadModule('/src/lib/components/Sidebar.svelte'));
});
afterEach(() => {
	channels.items = [];
	nav.clear();
	for (const id of [1, 2, 3, 4]) if (ui.isExpanded(id)) ui.toggle(id);
});
after(async () => {
	if (originalStorage === undefined) delete globalThis.localStorage;
	else globalThis.localStorage = originalStorage;
	if (originalHandlers === undefined) delete globalThis.__sidebarFolderHandlers;
	else globalThis.__sidebarFolderHandlers = originalHandlers;
	await server?.close();
});

const folder = (id, path) => ({
	id, type: 'Channel', slug: `sidebar-${id}`, title: `🌱 ${path}`,
	counts: { blocks: 0, channels: 0, contents: 0 }
});
const html = () => render(Sidebar).body;
const row = (body, id) => body.match(new RegExp(`<div[^>]*style="padding-left: [^"]*"[^>]*>(?:(?!<div)[\\s\\S])*?href="/c/sidebar-${id}"[\\s\\S]*?</div>`))?.[0];
function fixture() {
	channels.items = [folder(1, 'A'), folder(2, 'A > B')];
	html();
	return { node: channels.folders.all.find((node) => node.channel.id === 1), ...globalThis.__sidebarFolderHandlers };
}
function doubleClick(handlers, node) {
	const event = { prevented: false, preventDefault() { this.prevented = true; } };
	handlers.clickFolder({ detail: 2 }, node);
	handlers.doubleClickFolder(event, node);
	assert.equal(event.prevented, true);
}

test('sidebar starts with the Seeds home button and right-hand search control, not the filter field', () => {
	const body = html();
	assert.match(body, /class="brand[^\"]*" href="\/inbox"/);
	assert.match(body, /🌱<\/span> Seeds<\/a>/);
	assert.match(body, /aria-label="Show filter" aria-expanded="false"/);
	assert.doesNotMatch(body, /placeholder="Filter"/);
});

test('search opens on demand and closing clears the query and restores the default header state', async () => {
	html();
	const handlers = globalThis.__sidebarFolderHandlers;
	assert.deepEqual(handlers.getSearchState(), { open: false, query: '' });
	handlers.openSearch();
	handlers.setQuery('wood');
	assert.deepEqual(handlers.getSearchState(), { open: true, query: 'wood' });
	await handlers.closeSearch();
	assert.deepEqual(handlers.getSearchState(), { open: false, query: '' });
	let focused = false;
	handlers.focusOnMount({ focus() { focused = true; } });
	assert.equal(focused, true);
});

test('favicon is the seedling emoji without a background or other artwork', async () => {
	const svg = await readFile(new URL('../src/lib/assets/favicon.svg', import.meta.url), 'utf8');
	assert.match(svg, /<text[^>]*>🌱<\/text>/);
	assert.doesNotMatch(svg, /<rect|<path/);
});

test('root leaves have no chevron gutter while parents and nested leaves keep theirs', () => {
	channels.items = [folder(1, 'A'), folder(2, 'A > B'), folder(3, 'Standalone')];
	ui.expand([1]);
	const body = html();
	const rootLeaf = row(body, 3);
	assert.ok(rootLeaf);
	assert.match(rootLeaf, /padding-left: 10px/);
	assert.doesNotMatch(rootLeaf, /class="chevron/);
	assert.match(row(body, 1), /padding-left: 4px/);
	assert.match(row(body, 1), /class="chevron/);
	assert.match(row(body, 2), /padding-left: 18px/);
	assert.match(row(body, 2), /class="chevron[^"\n]*hidden/);
});

test('double-click expands a closed folder and collapses an open folder', () => {
	const handlers = fixture();
	const { node } = handlers;
	nav.push({ slug: 'origin', title: 'Origin' });
	handlers.clickFolder({ detail: 1 }, node);
	assert.deepEqual(nav.trail, []);
	doubleClick(handlers, node);
	assert.equal(ui.isExpanded(1), true);
	handlers.clickFolder({ detail: 1 }, node);
	doubleClick(handlers, node);
	assert.equal(ui.isExpanded(1), false);
	assert.equal(handlers.getLastRevealed(), node.channel.slug);
});

test('first-click navigation auto-expansion does not reverse the intended double-click result', () => {
	const handlers = fixture();
	handlers.clickFolder({ detail: 1 }, handlers.node);
	ui.expand([1]);
	doubleClick(handlers, handlers.node);
	assert.equal(ui.isExpanded(1), true);
});

test('double-clicking a leaf does not add expansion state', () => {
	const handlers = fixture();
	const leaf = channels.folders.all.find((node) => node.channel.id === 2);
	handlers.clickFolder({ detail: 1 }, leaf);
	doubleClick(handlers, leaf);
	assert.equal(ui.isExpanded(2), false);
});
