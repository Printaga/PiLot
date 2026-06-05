import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte()],
	base: './',
	root: 'src/webview',
	publicDir: '../../resources',
	build: {
		outDir: '../../dist/webview',
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			input: path.resolve(__dirname, 'src/webview/index.html')
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src/webview')
		}
	},
	server: {
		port: 5173,
		strictPort: true
	}
});
