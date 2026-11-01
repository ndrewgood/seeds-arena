import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, ui, auth, render, Layout, navigation;
const originalStorage = globalThis.localStorage;
const writes = [];

before(async () => {
	globalThis.localStorage = {
		getItem: () => JSON.stringify({ mobile: true, sidebarOpen: true }),
		setItem: (key, value) => writes.push([key, JSON.parse(value)])
	};
	server = await createServer({
		configFile: false,
		plugins: [
			{
				name: 'test-mobile-sidebar',
				resolveId(id) {
					if (id === '$app/state' || id === '$app/navigation') return `\0test:${id}`;
				},
				load(id) {
					if (id === '\0test:$app/state') return 'export const page = { params: {}, url: new URL("https://example.com/inbox") };';
					if (id === '\0test:$app/navigation') return `
						export const callbacks = [];
						export function afterNavigate(callback) { callbacks.push(callback); }
						export function goto() {}
					`;
				}
			},
			svelte({ configFile: false, hot: false })
		],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ ui } = await server.ssrLoadModule('/src/lib/ui.svelte.ts'));
	({ auth } = await server.ssrLoadModule('/src/lib/auth.svelte.ts'));
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: Layout } = await server.ssrLoadModule('/src/routes/+layout.svelte'));
	navigation = await server.ssrLoadModule('$app/navigation');
});

after(async () => {
	await server?.close();
	if (originalStorage === undefined) delete globalThis.localStorage;
	else globalThis.localStorage = originalStorage;
});

beforeEach(() => {
	auth.status = 'ready';
	ui.mobile = false;
	ui.sidebarOpen = false;
	ui.initPrompt = false;
	navigation.callbacks.length = 0;
});

const html = () => render(Layout, { props: { children: () => {} } }).body;
const drawerTag = (body) => body.match(/<div id="sidebar-drawer"[^>]*>/)?.[0];

test('responsive flags start false and are not restored or saved with sidebar preferences', () => {
	assert.equal(ui.mobile, false);
	assert.equal(ui.sidebarOpen, false);
	ui.mobile = true;
	ui.sidebarOpen = true;
	ui.toggleChannels();
	assert.deepEqual(Object.keys(writes.at(-1)[1]).sort(), ['channelsOpen', 'expanded']);
});

test('desktop sidebar stays available without dialog semantics or a backdrop', () => {
	const body = html();
	assert.doesNotMatch(drawerTag(body), /inert|aria-hidden|role="dialog"/);
	assert.doesNotMatch(body, /class="drawer-backdrop/);
});

test('closed mobile sidebar is hidden and inert, with an accessible toolbar control', () => {
	ui.mobile = true;
	const body = html();
	assert.match(drawerTag(body), /aria-hidden="true" inert/);
	assert.match(body, /aria-label="Toggle sidebar" aria-expanded="false" aria-controls="sidebar-drawer"/);
	assert.doesNotMatch(body, /class="workspace[^>]* inert/);
});

test('mobile header displays the seedling Seeds title', () => {
	ui.mobile = true;
	const header = html().match(/<header class="mobile-toolbar[^"]*"[^>]*>[\s\S]*?<\/header>/)?.[0];
	assert.ok(header);
	assert.match(header, /<span>🌱 Seeds<\/span>/);
});

test('open mobile drawer is modal, makes the workspace inert, and provides both dismiss controls', () => {
	ui.mobile = true;
	ui.sidebarOpen = true;
	const body = html();
	assert.match(drawerTag(body), /role="dialog" aria-modal="true" aria-label="Navigation"/);
	assert.doesNotMatch(drawerTag(body), /inert|aria-hidden/);
	assert.match(body, /class="workspace[^>]* inert/);
	assert.match(body, /aria-label="Close sidebar"/);
	assert.match(body, /aria-label="Dismiss sidebar"/);
	assert.match(body, /aria-label="Toggle sidebar" aria-expanded="true"/);
});

test('mobile drawer has one seedling brand in the top row alongside its close button', () => {
	ui.mobile = true;
	ui.sidebarOpen = true;
	const body = html();
	const drawer = body.slice(body.indexOf('id="sidebar-drawer"'), body.indexOf('class="workspace'));
	assert.equal((drawer.match(/Seeds/g) ?? []).length, 1);
	assert.match(drawer, /class="sidebar-header[^\"]*"[\s\S]*?🌱<\/span> Seeds<\/a>[\s\S]*?aria-label="Close sidebar"/);
	assert.doesNotMatch(drawer, /drawer-toolbar/);
});

test('toolbar is present during Inbox initialization and navigation closes the drawer', () => {
	ui.mobile = true;
	ui.sidebarOpen = true;
	ui.initPrompt = true;
	const body = html();
	assert.match(body, /aria-label="Toggle sidebar"/);
	assert.match(body, /Set up Seeds/);
	assert.equal(navigation.callbacks.length, 1);
	navigation.callbacks[0]();
	assert.equal(ui.sidebarOpen, false);
});
