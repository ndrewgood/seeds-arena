import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let planFolderRename;
before(async () => {
	server = await createServer({
		configFile: false,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ planFolderRename } = await server.ssrLoadModule('/src/lib/folder-rename.ts'));
});
after(async () => { await server?.close(); });

function channel(id, title) {
	return Object.freeze({
		id,
		type: 'Channel',
		title,
		slug: `channel-${id}`,
		description: Object.freeze({
			markdown: '**Keep me**\n\n[seeds-folder-icon]: {"kind":"emoji","value":"🌿"}',
			html: '<strong>Keep me</strong>',
			plain: 'Keep me'
		})
	});
}

function titles(plan) {
	return plan.map(({ channel, title }) => [channel.id, title]);
}

test('root rename rewrites descendants at every depth, including orphaned descendants', () => {
	const channels = Object.freeze([
		channel(1, '🌱 Design'),
		channel(2, '🌱 Design > Type'),
		channel(3, '🌱 Design > Type > Serif'),
		channel(4, '🌱 Design > Missing > Deep')
	]);
	const before = structuredClone(channels);
	const plan = planFolderRename(1, '  Visual\n\t Design  ', channels);
	assert.deepEqual(titles(plan), [
		[1, '🌱 Visual Design'],
		[2, '🌱 Visual Design > Type'],
		[3, '🌱 Visual Design > Type > Serif'],
		[4, '🌱 Visual Design > Missing > Deep']
	]);
	assert.deepEqual(channels, before);
	for (const [index, entry] of plan.entries()) {
		assert.strictEqual(entry.channel, channels[index]);
		assert.deepEqual(Object.keys(entry).sort(), ['channel', 'title']);
	}
});

test('nested rename preserves all parent segments and descendant depth', () => {
	const channels = [
		channel(1, '🌱 Work'),
		channel(2, '🌱 Work > Design'),
		channel(3, '🌱 Work > Design > Type'),
		channel(4, '🌱 Work > Design > Type > Serif'),
		channel(5, '🌱 Work > Design > Type > Serif > Slab')
	];
	assert.deepEqual(titles(planFolderRename(3, 'Letterforms', channels)), [
		[3, '🌱 Work > Design > Letterforms'],
		[4, '🌱 Work > Design > Letterforms > Serif'],
		[5, '🌱 Work > Design > Letterforms > Serif > Slab']
	]);
});

test('similarly prefixed, differently cased, and unanchored paths stay untouched', () => {
	const channels = [
		channel(1, '🌱 Art'),
		channel(2, '🌱 Art > Sketches'),
		channel(3, '🌱 Artist'),
		channel(4, '🌱 Artist > Sketches'),
		channel(5, '🌱 Other > Art > Sketches'),
		channel(6, '🌱 art > Sketches'),
		channel(7, 'Art > Notes')
	];
	assert.deepEqual(titles(planFolderRename(1, 'Drawing', channels)), [
		[1, '🌱 Drawing'],
		[2, '🌱 Drawing > Sketches']
	]);
});

test('duplicate siblings are rejected case-insensitively without mutations', () => {
	for (const parent of ['', 'Work > ']) {
		const channels = [
			channel(1, `🌱 ${parent}Design`),
			channel(2, `🌱 ${parent}ART`)
		];
		const before = structuredClone(channels);
		assert.throws(() => planFolderRename(1, 'art', channels), /already exists/);
		assert.deepEqual(channels, before);
	}
});

test('every output path is checked against outside orphaned descendants', () => {
	const channels = [
		channel(1, '🌱 Work > Design'),
		channel(2, '🌱 Work > Design > Type'),
		channel(3, '🌱 Work > Design > Type > Serif'),
		channel(4, '🌱 work > ART > type > SERIF')
	];
	const before = structuredClone(channels);
	assert.throws(
		() => planFolderRename(1, 'Art', channels),
		/already exists at "🌱 Work > Art > Type > Serif"/
	);
	assert.deepEqual(channels, before);
});

test('collisions within the moving subtree do not block a rename', () => {
	const channels = [channel(1, '🌱 A'), channel(2, '🌱 A > Child')];
	assert.deepEqual(titles(planFolderRename(1, 'a', channels)), [
		[1, '🌱 a'],
		[2, '🌱 a > Child']
	]);
});

test('unchanged names return an empty plan after whitespace normalization', () => {
	const channels = [channel(1, '🌱 Work > Visual Design'), channel(2, '🌱 Work > Visual Design > Type')];
	for (const name of ['Visual Design', '  Visual\t\nDesign  ']) {
		assert.deepEqual(planFolderRename(1, name, channels), []);
	}
});

test('blank names and path separators are rejected with clear errors', () => {
	const channels = [channel(1, '🌱 Design')];
	for (const name of ['', ' \t\n ']) {
		assert.throws(() => planFolderRename(1, name, channels), /Folder name cannot be blank/);
	}
	for (const name of ['>', 'Art > Type', 'Art>Type']) {
		assert.throws(() => planFolderRename(1, name, channels), /Folder name cannot contain ">"/);
	}
});

test('missing IDs and non-folder channels are rejected', () => {
	const channels = [channel(1, '🌱 Design'), channel(2, '📨 Inbox'), channel(3, 'Regular channel')];
	for (const id of [2, 3, 99]) {
		assert.throws(() => planFolderRename(id, 'Art', channels), /Folder with channel ID .* not found/);
	}
});
