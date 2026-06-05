import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

// Node.js built-in modules that need "node:" prefix in ESM output.
// VS Code's extension host ESM loader requires explicit node: prefix.
const NODE_BUILTINS = new Set([
	"fs",
	"fs/promises",
	"path",
	"os",
	"crypto",
	"child_process",
	"stream",
	"stream/promises",
	"url",
	"util",
	"http",
	"https",
	"net",
	"zlib",
	"buffer",
	"events",
	"module",
	"readline",
	"worker_threads",
	"perf_hooks",
	"tty",
	"string_decoder",
	"assert",
	"constants",
	"cluster",
	"dgram",
	"dns",
	"domain",
	"http2",
	"inspector",
	"repl",
	"timers",
	"tls",
	"v8",
	"vm",
	"wasi",
	"diagnostics_channel",
	"punycode",
	"querystring",
	"async_hooks",
	"trace_events",
	"console",
	"text_decoder",
	"text_encoder",
	"sqlite",
	"sea",
	"test",
]);

/** @type {esbuild.Plugin} */
const nodePrefixPlugin = {
	name: "node-prefix",
	setup(build) {
		build.onResolve({ filter: /^[a-z_][a-z0-9_/]*$/ }, (args) => {
			if (NODE_BUILTINS.has(args.path)) {
				return { path: `node:${args.path}`, external: true };
			}
		});
	},
};

/** Banner to inject require shim at the top of the bundle */
const REQUIRE_SHIM_BANNER = `
// VS Code ESM extension host shim - provide require for CJS interop
// Node.js >= 22 provides createRequire from node:module in ESM context
import { createRequire as __createRequireShim } from 'node:module';
var require = __createRequireShim(import.meta.url);
`;

/** @type {esbuild.BuildOptions} */
const buildOptions = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.js",
	platform: "node",
	target: "node18",
	format: "esm",
	external: ["vscode"],
	sourcemap: false,
	minify: true,
	tsconfig: "tsconfig.json",
	plugins: [nodePrefixPlugin],
	banner: { js: REQUIRE_SHIM_BANNER },
};

async function main() {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("[esbuild] Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("[esbuild] Build complete - bundled dist/extension.js");
	}
}

main().catch((e) => {
	console.error("[esbuild] Build failed:", e);
	process.exit(1);
});
