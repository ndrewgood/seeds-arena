import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parse } from 'svelte/compiler';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

let server, render, MoveBlocksDialog, prefs, channels;
const originalStorage = globalThis.localStorage;
const stored = new Map([['seeds.prefs', JSON.stringify({ rowHeight: 280, sort: 'position_desc', viewMode: 'grid' })]]);

before(async () => {
	globalThis.localStorage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, value)
	};
	server = await createServer({
		configFile: false,
		cacheDir: 'node_modules/.vite/mobile-view-tests',
		plugins: [
			{
				name: 'test-move-picker',
				enforce: 'pre',
				transform(code, id) {
					if (!id.endsWith('/components/MoveBlocksDialog.svelte')) return;
					return code.replace('</script>', `
						globalThis.__movePickerSetup?.({
							toggleFolder,
							setQuery: (value) => { query = value; searchCollapsed = new Set(); }
						});
					</script>`);
				}
			},
			svelte({ configFile: false, hot: false })
		],
		resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ render } = await server.ssrLoadModule('svelte/server'));
	({ default: MoveBlocksDialog } = await server.ssrLoadModule('/src/lib/components/MoveBlocksDialog.svelte'));
	({ prefs } = await server.ssrLoadModule('/src/lib/prefs.svelte.ts'));
	({ channels } = await server.ssrLoadModule('/src/lib/channels.svelte.ts'));
});

after(async () => {
	await server?.close();
	if (originalStorage === undefined) delete globalThis.localStorage;
	else globalThis.localStorage = originalStorage;
});

const folder = (id, title, can = {}) => ({
	id, type: 'Channel', slug: `folder-${id}`, title: `🌱 ${title}`, can,
	counts: { contents: 0, blocks: 0, channels: 0 }, description: null
});
const source = { id: 1, slug: 'folder-1' };
const blocks = [{ id: 42, type: 'Text', title: 'Example', connection: { id: 99 } }];
function picker(setup) {
	const original = globalThis.__movePickerSetup;
	globalThis.__movePickerSetup = setup;
	try {
		return render(MoveBlocksDialog, {
			props: { blocks, source, onclose() {}, onmoved() {} }
		}).body;
	} finally {
		if (original === undefined) delete globalThis.__movePickerSetup;
		else globalThis.__movePickerSetup = original;
	}
}

beforeEach(() => {
	channels.items = [];
	channels.loaded = true;
});

test('mobile defaults near the slider midpoint independently of the desktop preference', () => {
	assert.equal(prefs.rowHeight, 280);
	assert.equal(prefs.mobileRowHeight, 260);
});

test('mobile and desktop block sizes save independently', () => {
	prefs.mobileRowHeight = 150;
	assert.equal(prefs.rowHeight, 280);
	prefs.rowHeight = 310;
	assert.equal(prefs.mobileRowHeight, 150);
	const saved = JSON.parse(stored.get('seeds.prefs'));
	assert.equal(saved.rowHeight, 310);
	assert.equal(saved.mobileRowHeight, 150);
});

test('move picker labels the selection and shows collapsed root folders', () => {
	channels.items = [folder(2, 'Design'), folder(3, 'Design > Research')];
	const body = picker();
	assert.match(body, /<dialog[^>]*aria-labelledby="move-title"/);
	assert.match(body, /1 block selected/);
	assert.match(body, /aria-label="Find a destination"/);
	assert.match(body, /title="Design"/);
	assert.match(body, /aria-label="Expand Design folder" aria-expanded="false"/);
	assert.doesNotMatch(body, /title="Design > Research"/);
	assert.match(body, /aria-label="Close folder picker"/);
});

test('move picker excludes the current folder, read-only folders and non-folders', () => {
	channels.items = [folder(1, 'Original'), folder(2, 'Writable'), folder(3, 'Read-only', { add_to: false }), {
		...folder(4, 'Other'), title: 'Ordinary channel'
	}];
	const body = picker();
	assert.match(body, /Writable/);
	assert.doesNotMatch(body, /Original|Read-only|Ordinary channel/);
});

test('move picker explains when there are no destination folders', () => {
	assert.match(picker(), /No matching destinations/);
	channels.loaded = false;
	assert.match(picker(), /Loading destinations/);
});

test('move picker expands and collapses branches independently with nested indentation', () => {
	channels.items = [folder(2, 'Design'), folder(3, 'Design > Research'), folder(4, 'Design > Research > Notes'), folder(5, 'Other')];
	let body = picker(({ toggleFolder }) => toggleFolder(2));
	assert.match(body, /aria-label="Collapse Design folder" aria-expanded="true" aria-controls="move-folder-2"/);
	assert.match(body, /title="Design > Research"/);
	assert.match(body, /padding-left: 24px/);
	assert.doesNotMatch(body, /title="Design > Research > Notes"/);
	body = picker(({ toggleFolder }) => { toggleFolder(2); toggleFolder(3); });
	assert.match(body, /title="Design > Research > Notes"/);
	assert.match(body, /padding-left: 38px/);
	body = picker(({ toggleFolder }) => { toggleFolder(2); toggleFolder(2); });
	assert.doesNotMatch(body, /title="Design > Research"/);
});

test('move picker search reveals matching descendants and permits collapsing results', () => {
	channels.items = [folder(2, 'Design'), folder(3, 'Design > Research'), folder(4, 'Design > Sketches'), folder(5, 'Other')];
	let body = picker(({ setQuery }) => setQuery('Research'));
	assert.match(body, /title="Design"/);
	assert.match(body, /title="Design > Research"/);
	assert.doesNotMatch(body, /title="Design > Sketches"|title="Other"/);
	body = picker(({ setQuery, toggleFolder }) => { setQuery('Research'); toggleFolder(2); });
	assert.match(body, /aria-label="Expand Design folder" aria-expanded="false"/);
	assert.doesNotMatch(body, /title="Design > Research"/);
	body = picker(({ setQuery }) => setQuery('No matches'));
	assert.match(body, /No matching destinations/);
});

test('current and read-only parents remain disabled but expose writable child destinations', () => {
	channels.items = [folder(1, 'Current'), folder(2, 'Current > Child'), folder(3, 'Shared', { add_to: false }), folder(4, 'Shared > Writable')];
	const body = picker(({ toggleFolder }) => { toggleFolder(1); toggleFolder(3); });
	assert.match(body, /title="Current"[^>]*disabled/);
	assert.match(body, /title="Shared"[^>]*disabled/);
	assert.match(body, /title="Current > Child"/);
	assert.match(body, /title="Shared > Writable"/);
	assert.doesNotMatch(body, /title="Current > Child"[^>]*disabled/);
	assert.doesNotMatch(body, /title="Shared > Writable"[^>]*disabled/);
});

test('move picker offers Inbox first, even when there are no folders', () => {
	const inbox = { ...folder(10, 'Inbox'), title: '📨 Inbox' };
	channels.items = [inbox];
	let body = picker();
	assert.match(body, /title="Inbox"/);
	assert.doesNotMatch(body, /No matching destinations/);
	channels.items = [folder(2, 'Design'), inbox];
	body = picker();
	assert.ok(body.indexOf('title="Inbox"') < body.indexOf('title="Design"'));
});

test('move picker excludes Inbox when it is the source or is read-only', () => {
	for (const inbox of [
		{ ...folder(1, 'Inbox'), title: '📨 Inbox' },
		{ ...folder(10, 'Inbox'), slug: source.slug, title: '📨 Inbox' },
		{ ...folder(10, 'Inbox', { add_to: false }), title: '📨 Inbox' }
	]) {
		channels.items = [inbox];
		assert.doesNotMatch(picker(), /title="Inbox"/);
	}
});

test('destination search includes Inbox and filters it out for other terms', () => {
	channels.items = [{ ...folder(10, 'Inbox'), title: '📨 Inbox' }, folder(2, 'Design')];
	let body = picker(({ setQuery }) => setQuery('  INB  '));
	assert.match(body, /title="Inbox"/);
	assert.doesNotMatch(body, /title="Design"/);
	body = picker(({ setQuery }) => setQuery('Design'));
	assert.doesNotMatch(body, /title="Inbox"/);
	assert.match(body, /title="Design"/);
});

// Evaluate class-only rules from the real stylesheet, including source order and specificity.
// This catches desktop visibility regressions caused by later generic icon-button rules.
async function classStyles(file, classes, width) {
	const source = await readFile(new URL(file, import.meta.url), 'utf8');
	const styles = new Map();
	function walk(nodes) {
		for (const node of nodes) {
			if (node.type === 'Atrule') {
				const max = node.name === 'media' && node.prelude.match(/^\(max-width: (\d+)px\)$/);
				if (max && width <= Number(max[1])) walk(node.block.children);
				continue;
			}
			if (node.type !== 'Rule') continue;
			for (const selector of node.prelude.children) {
				if (!selector.children.every((part) => part.type === 'ClassSelector' && classes.includes(part.name))) continue;
				const specificity = selector.children.length;
				for (const declaration of node.block.children) {
					if (declaration.type !== 'Declaration') continue;
					if (specificity >= (styles.get(declaration.property)?.specificity ?? -1)) {
						styles.set(declaration.property, { specificity, value: declaration.value });
					}
				}
			}
		}
	}
	walk(parse(source).css.children);
	return Object.fromEntries([...styles].map(([key, entry]) => [key, entry.value]));
}

test('three-dot button stays hidden above 900px despite generic icon styles', async () => {
	const file = '../src/lib/components/ChannelView.svelte';
	for (const width of [901, 1024, 1440]) {
		assert.equal((await classStyles(file, ['icon-btn', 'more-button'], width)).display, 'none');
	}
	for (const width of [375, 768, 900]) {
		assert.equal((await classStyles(file, ['icon-btn', 'more-button'], width)).display, 'grid');
	}
});

test('drawer and controls share the inclusive 900px breakpoint', async () => {
	const layout = '../src/routes/+layout.svelte';
	const view = '../src/lib/components/ChannelView.svelte';
	const source = await readFile(new URL(layout, import.meta.url), 'utf8');
	assert.ok(source.includes("matchMedia('(max-width: 900px)')"));
	for (const width of [768, 900]) {
		assert.equal((await classStyles(layout, ['sidebar-drawer'], width)).position, 'fixed');
		assert.equal((await classStyles(view, ['controls'], width)).display, 'none');
	}
	assert.equal((await classStyles(layout, ['sidebar-drawer'], 901)).width, '244px');
	assert.equal((await classStyles(view, ['controls'], 901)).display, 'flex');
});

test('mobile sidebar increases type and touch targets without changing desktop rows', async () => {
	const file = '../src/lib/components/Sidebar.svelte';
	assert.equal((await classStyles(file, ['row'], 901)).height, '28px');
	assert.equal((await classStyles(file, ['icon-button', 'close-sidebar'], 901)).display, 'none');
	for (const width of [375, 900]) {
		assert.equal((await classStyles(file, ['sidebar'], width))['font-size'], '15px');
		for (const name of ['row', 'folder-toggle', 'add', 'icon-button']) {
			assert.equal((await classStyles(file, [name], width)).height, '44px');
		}
		assert.equal((await classStyles(file, ['icon-button', 'close-sidebar'], width)).display, 'grid');
	}
});
