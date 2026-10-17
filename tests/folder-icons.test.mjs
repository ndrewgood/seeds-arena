import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let metadata;
before(async () => {
	server = await createServer({
		configFile: false,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	metadata = await server.ssrLoadModule('/src/lib/folder-icons.ts');
});
after(async () => { await server?.close(); });

const icon = (value) => ({ kind: 'icon', library: 'iconoir', value });

test('catalog contains every regular and solid Iconoir SVG, not a curated subset', async () => {
	const expected = [];
	for (const style of ['regular', 'solid']) {
		for (const name of await readdir(`node_modules/iconoir/icons/${style}`)) {
			if (name.endsWith('.svg')) expected.push(`${style}/${name.slice(0, -4)}`);
		}
	}
	assert.ok(expected.length > 1500);
	assert.deepEqual(metadata.iconoirIcons.map((entry) => entry.value).sort(), expected.sort());
	for (const entry of metadata.iconoirIcons) {
		assert.ok(entry.url && !entry.url.startsWith('data:'));
		assert.equal(metadata.validFolderIcon(icon(entry.value)), true);
	}
});

test('outline and solid selections round-trip without changing existing Markdown', () => {
	for (const description of ['', 'Design folder - Seeds for Are.na', '**Research**\n\n[Link](https://example.com)\n']) {
		for (const selection of [icon('regular/camera'), icon('solid/heart')]) {
			const stored = metadata.writeFolderIcon(description, selection);
			assert.deepEqual(metadata.readFolderIcon(stored), selection);
			assert.equal(metadata.writeFolderIcon(stored, null), description);
		}
	}
});

test('changing an icon replaces rather than duplicates metadata', () => {
	const original = 'Keep this description.';
	const first = metadata.writeFolderIcon(original, icon('regular/leaf'));
	const second = metadata.writeFolderIcon(first, icon('regular/palette'));
	assert.equal(second.match(/seeds-folder-icon/g)?.length, 1);
	assert.deepEqual(metadata.readFolderIcon(second), icon('regular/palette'));
	assert.equal(metadata.writeFolderIcon(second, null), original);
});

test('all old Lucide choices map to valid Iconoir equivalents', () => {
	const names = ['folder','archive','book','bookmark','briefcase','camera','code','coffee','compass',
		'document','film','flag','flower','globe','heart','home','image','layers','leaf','lightbulb',
		'map','music','palette','pencil','rocket','search','shapes','sparkles','star','sun','tag',
		'target','trophy','users','video','zap'];
	for (const value of names) {
		const selection = metadata.readFolderIcon(`[seeds-folder-icon]: ${JSON.stringify({ kind: 'icon', value })}`);
		assert.equal(metadata.validFolderIcon(selection), true, value);
	}
	assert.deepEqual(metadata.readFolderIcon('[seeds-folder-icon]: {"kind":"icon","value":"book"}'), icon('regular/open-book'));
});

test('missing metadata, malformed JSON, unknown icons and removed emoji fall back safely', () => {
	for (const value of [null, '', 'Just text', '[seeds-folder-icon]: not-json',
		'[seeds-folder-icon]: {"kind":"icon","value":"not-an-icon"}',
		'[seeds-folder-icon]: {"kind":"icon","value":"__proto__"}',
		'[seeds-folder-icon]: {"kind":"icon","library":"iconoir","value":"regular/not-real"}',
		'[seeds-folder-icon]: {"kind":"icon","library":"unknown","value":"regular/camera"}',
		'[seeds-folder-icon]: {"kind":"emoji","value":"🌿"}']) {
		assert.equal(metadata.readFolderIcon(value), null);
	}
	assert.equal(metadata.validFolderIcon({ kind: 'emoji', value: '🌿' }), false);
	assert.equal(metadata.folderIconUrl('invalid'), metadata.folderIconUrl());
});

test('new selections replace old emoji metadata without changing user text', () => {
	const original = '**Keep this text**';
	const old = `${original}\n\n[seeds-folder-icon]: {"kind":"emoji","value":"🌿"}`;
	const replaced = metadata.writeFolderIcon(old, icon('regular/leaf'));
	assert.deepEqual(metadata.readFolderIcon(replaced), icon('regular/leaf'));
	assert.equal(metadata.writeFolderIcon(replaced, null), original);
});
