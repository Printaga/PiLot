import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");

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

// The extension entry point is dist/loader.cjs (see package.json `main`), which
// requires ./extension.cjs. The copy must happen for watch builds too, or a
// fresh clone running only `bundle:watch` produces an unloadable extension.
function copyLoader() {
	fs.mkdirSync("dist", { recursive: true });
	fs.copyFileSync(path.join("src", "loader.cjs"), path.join("dist", "loader.cjs"));
	console.log("[esbuild] Copied loader.cjs to dist/");
}

async function main() {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		copyLoader();
		await ctx.watch();
		console.log("[esbuild] Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("[esbuild] Build complete - bundled dist/extension.cjs");

		copyLoader();
		console.log(
			"[esbuild] PI SDK and assets will be loaded from global installation at runtime",
		);
	}
}

main().catch((e) => {
	console.error("[esbuild] Build failed:", e);
	process.exit(1);
});
