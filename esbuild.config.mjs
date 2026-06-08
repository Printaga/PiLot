import * as esbuild from "esbuild";
import * as path from "node:path";
import * as fs from "node:fs";

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

/**
 * Recursively copy a directory.
 */
function copyRecursive(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyRecursive(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * Resolve the root directory of the @earendil-works/pi-coding-agent package.
 *
 * We cannot use require.resolve() because the package declares an "exports" map
 * without a "require" condition, causing ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Instead, we resolve the symlink at node_modules/@earendil-works/pi-coding-agent
 * (which exists under pnpm and npm alike) to its real location.
 */
function resolvePiAgentPackageDir() {
	// Try pnpm symlink first
	const candidate = path.join(
		process.cwd(),
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	if (fs.existsSync(candidate)) {
		try {
			return fs.realpathSync(candidate);
		} catch {
			return candidate;
		}
	}

	// Fallback: search upward for a node_modules/@earendil-works/pi-coding-agent
	let dir = path.resolve(process.cwd());
	while (dir !== path.dirname(dir)) {
		const p = path.join(dir, "node_modules", "@earendil-works", "pi-coding-agent");
		if (fs.existsSync(p)) {
			try {
				return fs.realpathSync(p);
			} catch {
				return p;
			}
		}
		dir = path.dirname(dir);
	}

	throw new Error(
		"Could not locate @earendil-works/pi-coding-agent package in node_modules",
	);
}

/**
 * Copy export-html template assets from the pi-coding-agent package
 * into dist/core/export-html so that the bundled code can read them
 * at runtime via its own import.meta.url-based path resolution.
 */
function copyExportHtmlTemplates() {
	const piAgentPkgPath = resolvePiAgentPackageDir();
	const sourceDir = path.join(
		piAgentPkgPath,
		"dist",
		"core",
		"export-html",
	);
	const targetDir = path.join(process.cwd(), "dist", "core", "export-html");

	if (!fs.existsSync(sourceDir)) {
		console.error(
			`[esbuild] WARNING: source export-html directory not found: ${sourceDir}`,
		);
		return;
	}

	copyRecursive(sourceDir, targetDir);
	console.log(
		`[esbuild] Copied export-html templates (${sourceDir} -> ${targetDir})`,
	);
}

function copyThemeTemplates() {
	const piAgentPkgPath = resolvePiAgentPackageDir();
	const sourceDir = path.join(
		piAgentPkgPath,
		"dist",
		"modes",
		"interactive",
		"theme",
	);
	const targetDir = path.join(process.cwd(), "dist", "modes", "interactive", "theme");

	if (!fs.existsSync(sourceDir)) {
		console.error(
			`[esbuild] WARNING: source theme directory not found: ${sourceDir}`,
		);
		return;
	}

	fs.mkdirSync(targetDir, { recursive: true });
	for (const jsonFile of ["dark.json", "light.json"]) {
		const srcPath = path.join(sourceDir, jsonFile);
		const destPath = path.join(targetDir, jsonFile);
		if (fs.existsSync(srcPath)) {
			fs.copyFileSync(srcPath, destPath);
		}
	}
	console.log(
		`[esbuild] Copied theme templates (${sourceDir} -> ${targetDir})`,
	);
}

async function main() {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log("[esbuild] Watching for changes...");
	} else {
		await esbuild.build(buildOptions);
		console.log("[esbuild] Build complete - bundled dist/extension.js");
		copyExportHtmlTemplates();
		copyThemeTemplates();
	}
}

main().catch((e) => {
	console.error("[esbuild] Build failed:", e);
	process.exit(1);
});
