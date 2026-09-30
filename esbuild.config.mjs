import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const watch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const buildOptions = {
	// Anchor every path to the project root so the script works from any cwd.
	absWorkingDir: projectRoot,
	entryPoints: [path.join(projectRoot, "src/extension.ts")],
	bundle: true,
	outfile: path.join(projectRoot, "dist/extension.cjs"),
	platform: "node",
	target: "node18",
	format: "cjs",
	// The PI SDK is NOT a package.json dependency: src/loader.cjs resolves it
	// from the user's global installation at runtime. Bundling it would crash
	// at module scope (its Bun-detection code calls fileURLToPath on a
	// import.meta.url esbuild's CJS shim leaves undefined), so the SDK scope
	// plus its transitive re-exported packages stay external.
	external: ["vscode", "@earendil-works/*", "@mariozechner/*", "@sinclair/*", "typebox"],
	// Dev/watch builds stay debuggable; release builds stay small.
	sourcemap: watch ? "inline" : false,
	minify: !watch,
	tsconfig: path.join(projectRoot, "tsconfig.json"),
	plugins: [
		{
			name: "copy-loader",
			// Runs on every build AND rebuild, so `bundle:watch` never serves a
			// stale dist/loader.cjs after src/loader.cjs changes.
			setup(build) {
				build.onStart(() => copyLoader());
			},
		},
	],
};

// The extension entry point is dist/loader.cjs (see package.json `main`), which
// requires ./extension.cjs.
function copyLoader() {
	fs.mkdirSync(path.join(projectRoot, "dist"), { recursive: true });
	fs.copyFileSync(
		path.join(projectRoot, "src", "loader.cjs"),
		path.join(projectRoot, "dist", "loader.cjs"),
	);
	console.log("[esbuild] Copied loader.cjs to dist/");
}

async function main() {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("[esbuild] Watching for changes...");

		// Dispose gracefully so the esbuild service child does not linger.
		const shutdown = async () => {
			await ctx.dispose();
			process.exit(0);
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	} else {
		await esbuild.build(buildOptions);
		console.log("[esbuild] Build complete - bundled dist/extension.cjs");

		console.log(
			"[esbuild] PI SDK and assets will be loaded from global installation at runtime",
		);
	}
}

main().catch((e) => {
	console.error("[esbuild] Build failed:", e instanceof Error ? e.message : e);
	// exitCode (not exit()) so piped/buffered output can drain before exit.
	process.exitCode = 1;
});
