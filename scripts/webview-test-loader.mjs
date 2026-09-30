import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compile, compileModule, preprocess } from "svelte/compiler";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const svelteConfigJs = new URL("../svelte.config.js", import.meta.url);

let compilerOptions = { runes: true };
let preprocessor = vitePreprocess();
try {
	// Single source of truth: reuse the repository's svelte.config.js so the
	// test loader compiles exactly like the app build (runes, preprocessors,
	// future options) instead of restating values here.
	const loaded = await import(svelteConfigJs.href);
	if (loaded.default?.compilerOptions) {
		compilerOptions = { ...loaded.default.compilerOptions };
	}
	if (loaded.default?.preprocess) {
		preprocessor = loaded.default.preprocess;
	}
} catch (err) {
	throw new Error(
		`webview-test-loader: could not load svelte.config.js (${err?.message ?? err}).`,
		{ cause: err },
	);
}

// Sibling extensions probed when Node's own resolution fails; components
// import workspace modules without an extension ("../messages"), and Vite
// resolves those at build time while plain Node does not.
const PROBE_EXTENSIONS = [".ts", ".js", ".svelte"];

/** Parent directory of the importing module, or the process cwd. */
function parentDirOf(context) {
	return context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
}

/**
 * Resolve relative specifiers Node cannot handle on its own (extensionless
 * workspace imports). Specifiers Node CAN resolve (.mjs specs, explicit
 * extensions, existing .svelte files) pass through untouched.
 * Returns the resolved URL or null to defer to the default resolver.
 */
async function resolveWorkspaceSpecifier(specifier, context, nextResolve) {
	if (!specifier.startsWith(".")) return null;
	try {
		await nextResolve(specifier, context);
		return null; // Node resolved it — no probing needed.
	} catch {
		// Fall through to extension probing.
	}
	const base = resolvePath(parentDirOf(context), specifier);
	return probeExtensions(base, context, nextResolve);
}

/** Try resolving `base` with each candidate extension; first hit wins. */
async function probeExtensions(base, context, nextResolve) {
	const attempts = [];
	for (const ext of PROBE_EXTENSIONS) {
		const candidate = pathToFileURL(base + ext).href;
		try {
			await nextResolve(candidate, context);
			return candidate;
		} catch (err) {
			attempts.push(`${candidate}: ${err?.code ?? err?.message ?? err}`);
		}
	}
	// A genuinely missing/misnamed import should say what was probed, not only
	// surface the default resolver's ERR_MODULE_NOT_FOUND.
	throw new Error(
		`webview-test-loader: could not resolve "${base}" (tried ${PROBE_EXTENSIONS.join(", ")})`,
	);
}

/** Append `map` to `code` as an inline sourceMappingURL comment. */
function withInlineSourceMap(code, map) {
	if (!map) return code;
	const payload = Buffer.from(JSON.stringify(map)).toString("base64");
	return `${code}\n//# sourceMappingURL=data:application/json;base64,${payload}\n`;
}

// fallow-ignore-next-line unused-export
export async function resolve(specifier, context, nextResolve) {
	// Only path-like specifiers are short-circuited: a bare package subpath
	// (`some-lib/Comp.svelte`) must fall through to the default resolver.
	const isPathSpecifier =
		specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
	if (isPathSpecifier && specifier.split("?")[0].endsWith(".svelte")) {
		return {
			url: pathToFileURL(resolvePath(parentDirOf(context), specifier)).href,
			shortCircuit: true,
		};
	}
	const workspaceUrl = await resolveWorkspaceSpecifier(specifier, context, nextResolve);
	if (workspaceUrl) {
		return { url: workspaceUrl, shortCircuit: true };
	}
	// Client runtime: svelte's "." → src/index-client.js, esm-env → browser build.
	const conditions = context.conditions.includes("browser")
		? context.conditions
		: [...context.conditions, "browser"];
	return nextResolve(specifier, { ...context, conditions });
}

// fallow-ignore-next-line unused-export
export async function load(url, context, nextLoad) {
	if (url.endsWith(".svelte")) {
		const file = fileURLToPath(url);
		let code;
		try {
			code = (
				await preprocess(readFileSync(file, "utf8"), preprocessor, {
					filename: file,
				})
			).code;
		} catch (err) {
			throw new Error(
				`webview-test-loader: failed to preprocess ${file}: ${err?.message ?? err}`,
				{ cause: err },
			);
		}
		const compiled = compile(code, {
			...compilerOptions,
			filename: file,
			generate: "client",
		});
		return {
			format: "module",
			// Inline map so stack frames point at the original .svelte source.
			source: withInlineSourceMap(compiled.js.code, compiled.js.map),
			shortCircuit: true,
		};
	}
	// Runes modules shipped as source by test deps (@testing-library/svelte-core).
	if (url.endsWith(".svelte.js")) {
		const file = fileURLToPath(url);
		try {
			const compiled = compileModule(readFileSync(file, "utf8"), {
				...compilerOptions,
				filename: file,
				generate: "client",
			});
			return {
				format: "module",
				source: withInlineSourceMap(compiled.js.code, compiled.js.map),
				shortCircuit: true,
			};
		} catch (err) {
			throw new Error(
				`webview-test-loader: failed to compile ${file}: ${err?.message ?? err}`,
				{ cause: err },
			);
		}
	}
	return nextLoad(url, context);
}
