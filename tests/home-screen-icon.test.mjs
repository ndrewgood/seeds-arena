import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

 test('page advertises an Apple touch PNG and the Seeds home-screen title', async () => {
	const html = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
	assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="%sveltekit\.assets%\/apple-touch-icon\.png"\s*\/>/);
	assert.match(html, /<meta name="apple-mobile-web-app-title" content="Seeds"\s*\/>/);
});

for (const [name, size] of [['apple-touch-icon.png', 180], ['seeds-icon.png', 512]]) {
	test(`${name} is a square ${size}px PNG`, async () => {
		const png = await readFile(new URL(`../static/${name}`, import.meta.url));
		assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		assert.equal(png.toString('ascii', 12, 16), 'IHDR');
		assert.equal(png.readUInt32BE(16), size);
		assert.equal(png.readUInt32BE(20), size);
	});
}
