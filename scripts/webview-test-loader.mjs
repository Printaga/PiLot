// Svelte loader for plain-Node webview tests, registered by run-webview-tests.mjs.
// Compiles `.svelte` (and `.svelte.js` runes modules) with the repository's own
// compiler + vitePreprocess, and resolves the client runtime via the `browser`
// export condition. Node consumes resolve/load by name (module.register
// convention, like VS Code's activate) — hence the suppressions.
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compile, compileModule, preprocess } from "svelte/compiler";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const preprocessor = vitePreprocess();

// fallow-ignore-next-line unused-export
export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith(".svelte")) {
		const parentDir = context.parentURL
			? dirname(fileURLToPath(context.parentURL))
			: process.cwd();
		return { url: pathToFileURL(resolvePath(parentDir, specifier)).href, shortCircuit: true };
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
		const { code } = await preprocess(readFileSync(file, "utf8"), preprocessor, {
			filename: file,
		});
		return {
			format: "module",
			source: compile(code, { filename: file, runes: true, generate: "client" }).js.code,
			shortCircuit: true,
		};
	}
	// Runes modules shipped as source by test deps (@testing-library/svelte-core).
	if (url.endsWith(".svelte.js")) {
		const file = fileURLToPath(url);
		return {
			format: "module",
			source: compileModule(readFileSync(file, "utf8"), {
				filename: file,
				generate: "client",
			}).js.code,
			shortCircuit: true,
		};
	}
	return nextLoad(url, context);
}
