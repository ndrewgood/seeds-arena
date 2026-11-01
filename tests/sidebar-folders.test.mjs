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
							clickFolder, getLastRevealed: () => lastRevealed,
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
const click = (handlers, node, overrides = {}) => handlers.clickFolder({ button: 0, detail: 1, ...overrides }, node);

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

test('folder icons stay on the left and parent toggles replace counts on the right', () => {
	channels.items = [folder(1, 'A'), folder(2, 'A > B'), folder(3, 'Standalone')];
	ui.expand([1]);
	const body = html();
	const rootLeaf = row(body, 3);
	assert.ok(rootLeaf);
	assert.match(rootLeaf, /padding-left: 10px/);
	assert.doesNotMatch(rootLeaf, /class="chevron/);
	const parent = row(body, 1);
	assert.match(parent, /padding-left: 10px/);
	assert.match(parent, /class="folder-toggle/);
	assert.match(parent, /class="folder-slot/);
	assert.match(parent, /<\/a>[\s\S]*<button[^>]*class="folder-toggle/);
	assert.doesNotMatch(parent, /class="count/);
	assert.doesNotMatch(rootLeaf, /class="count|class="folder-toggle/);
	assert.match(parent, /aria-label="Collapse folder" aria-expanded="true"/);
	assert.equal((parent.match(/class="folder-icon/g) ?? []).length, 1);
	assert.match(row(body, 2), /padding-left: 24px/);
	assert.match(row(body, 2), /class="folder-slot/);
	assert.doesNotMatch(row(body, 2), /class="count/);
	assert.doesNotMatch(row(body, 2), /class="folder-toggle/);
});

test('one click expands a closed folder and collapses an open folder', () => {
	const handlers = fixture();
	const { node } = handlers;
	nav.push({ slug: 'origin', title: 'Origin' });
	click(handlers, node);
	assert.deepEqual(nav.trail, []);
	assert.equal(ui.isExpanded(1), true);
	assert.equal(handlers.getLastRevealed(), node.channel.slug);
	click(handlers, node);
	assert.equal(ui.isExpanded(1), false);
});

test('the second click of a double-click does not reverse the first toggle', () => {
	const handlers = fixture();
	click(handlers, handlers.node);
	click(handlers, handlers.node, { detail: 2 });
	assert.equal(ui.isExpanded(1), true);
});

test('keyboard activation toggles folders', () => {
	const handlers = fixture();
	click(handlers, handlers.node, { detail: 0 });
	assert.equal(ui.isExpanded(1), true);
});

test('modified clicks leave expansion and navigation history alone', () => {
	const handlers = fixture();
	nav.push({ slug: 'origin', title: 'Origin' });
	for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
		click(handlers, handlers.node, overrides);
		assert.equal(ui.isExpanded(1), false);
		assert.equal(nav.trail.length, 1);
		assert.equal(handlers.getLastRevealed(), undefined);
	}
});

test('clicking a leaf does not add expansion state', () => {
	const handlers = fixture();
	const leaf = channels.folders.all.find((node) => node.channel.id === 2);
	click(handlers, leaf);
	assert.equal(ui.isExpanded(2), false);
});
