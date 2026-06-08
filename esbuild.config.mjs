import * as esbuild from "esbuild";
import * as path from "node:path";
import * as fs from "node:fs";

const watch = process.argv.includes("--watch");

// Node.js built-in modules that need "node:" prefix in ESM output.
// VS Code's extension host ESM loader requires explicit node: prefix.
/** @type {esbuild.BuildOptions} */
const buildOptions = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.cjs",
	platform: "node",
	target: "node18",
	format: "cjs",
	external: [
		"vscode",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-tui",
		"@earendil-works/pi-agent-core",
		"@mariozechner/*",
		"@sinclair/*",
		"typebox",
	],
	sourcemap: false,
	minify: true,
	tsconfig: "tsconfig.json",
};

async function main() {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("[esbuild] Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("[esbuild] Build complete - bundled dist/extension.cjs");
		
		// Copy loader.cjs to dist/
		fs.copyFileSync("src/loader.cjs", "dist/loader.cjs");
		console.log("[esbuild] Copied loader.cjs to dist/");
		
		console.log("[esbuild] PI SDK and assets will be loaded from global installation at runtime");
	}
}

main().catch((e) => {
	console.error("[esbuild] Build failed:", e);
	process.exit(1);
});
