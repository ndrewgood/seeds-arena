import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('the home route redirects to Inbox before rendering the empty state', async () => {
	const server = await createServer({
		configFile: false,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	try {
		const { load } = await server.ssrLoadModule('/src/routes/+page.ts');
		assert.throws(() => load({}), (error) => {
			assert.equal(error.status, 307);
			assert.equal(error.location, '/inbox');
			return true;
		});
	} finally {
		await server.close();
	}
});
