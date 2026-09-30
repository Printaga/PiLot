import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: true,
	},
};

// Consumed dynamically by @sveltejs/vite-plugin-svelte and by
// scripts/webview-test-loader.mjs, so the static import graph can't see it.
// fallow-ignore-next-line unused-export
export default config;
