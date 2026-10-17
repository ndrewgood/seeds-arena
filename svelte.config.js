import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Pure client-side SPA: the Are.na token lives in the browser and the
		// API is called directly (it sends permissive CORS headers).
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
