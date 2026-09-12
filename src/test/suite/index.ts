import * as path from "path";
import * as fs from "fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import Mocha from "mocha";
import { glob } from "glob";
import * as vscode from "vscode";

process.env.PI_TEST = "1";

// Inside the VS Code extension host, console output is routed to the Output
// channel rather than stdout, so the default reporter's results are swallowed.
// Mirror results to a file we can read back after the run.
const reportPath = path.resolve(import.meta.dirname, "test-results.log");

// ── VS Code test facade ─────────────────────────────────────────────────────
//
// Unit tests stub the VS Code API through `globalThis.vscode` (see
// `resetVscodeMocks()` in src/test/mocks/pi-sdk-mocks.ts). The real API
// namespace is frozen with getter-only properties, so assigning mocks directly
// throws. Build an overlay facade instead: reads fall through to the real API,
// writes are captured per property, and nested objects like `workspace.fs`
// get the same treatment.

function mutableCopy(target: object, bindFunctions = false): Record<string, unknown> {
	const copy: Record<string, unknown> = {};
	for (const key of Object.getOwnPropertyNames(target)) {
		try {
			const value = (target as any)[key];
			if (typeof value === "undefined") {
				continue;
			}
			// Never bind classes/constructors: binding strips statics like
			// `Uri.file`. Plain host methods keep their receiver via bind().
			const isConstructor =
				typeof value === "function" && value.prototype?.constructor === value;
			copy[key] =
				bindFunctions && typeof value === "function" && !isConstructor
					? value.bind(target)
					: value;
		} catch {
			/* proposal-gated property: skip */
		}
	}
	return copy;
}

function installVscodeFacade(): void {
	const real = vscode as any;
	// Mutate the facade IN PLACE so the shim module (which captured the
	// original object reference at load) keeps observing the same objects that
	// resetVscodeMocks() patches. Replacing the object would make production
	// code read stale shim exports under the plain-Node runner.
	const facade: Record<string, any> =
		((globalThis as any).__vscodeFacade as Record<string, any> | undefined) ?? {};
	const isPlainObject = (v: any): boolean =>
		!!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
	// Nested API namespaces are composed explicitly below; copying them here
	// would put the REAL frozen namespaces (getter-only props on newer VS Code)
	// on the facade and break every mock assignment.
	const namespaceKeys = new Set([
		"window",
		"workspace",
		"commands",
		"env",
		"extensions",
		"languages",
	]);
	const assignProps = (target: any, src: any, bind = false): void => {
		if (!src || typeof src !== "object") return;
		for (const key of Object.getOwnPropertyNames(src)) {
			if (namespaceKeys.has(key)) continue;
			// Proposed-API accessors (e.g. window.linkPresentationRules on newer
			// VS Code) throw on read when the proposal isn't enabled; skip them.
			let value: any;
			try {
				value = src[key];
			} catch {
				continue;
			}
			if (typeof value === "undefined") continue;
			const isCtor = typeof value === "function" && value.prototype?.constructor === value;
			// Skip nested API namespaces (e.g. workspace.fs): they are composed
			// explicitly and copying the real frozen namespace breaks mocks.
			if (!isCtor && typeof value === "object" && !isPlainObject(value)) {
				continue;
			}
			const assigned =
				bind && typeof value === "function" && !isCtor ? value.bind(src) : value;
			// Newer VS Code APIs expose getter-only properties (e.g.
			// window.visibleTextEditors); skip them so reads still fall through
			// to the real API instead of crashing the whole suite.
			try {
				target[key] = assigned;
			} catch {
				/* getter-only property: leave as-is */
			}
		}
	};
	assignProps(facade, real, false);
	const ensureObj = (parent: any, name: string): any => {
		// Never keep a non-plain object (e.g. the real frozen API namespace):
		// mocks must be able to assign arbitrary props on it.
		if (!isPlainObject(parent[name])) {
			try {
				parent[name] = {};
			} catch {
				/* unreplaceable: fall through */
			}
		}
		return isPlainObject(parent[name]) ? parent[name] : {};
	};
	assignProps(ensureObj(facade, "window"), real.window, true);
	const ws = ensureObj(facade, "workspace");
	assignProps(ws, real.workspace, true);
	assignProps(ensureObj(ws, "fs"), real.workspace?.fs, true);
	facade.commands = facade.commands ?? mutableCopy(real.commands);
	facade.env = facade.env ?? mutableCopy(real.env);
	facade.extensions = facade.extensions ?? mutableCopy(real.extensions);
	facade.languages = facade.languages ?? mutableCopy(real.languages);

	(globalThis as any).__vscodeFacade = facade;
	(globalThis as any).vscode = facade;
}

// Modules compiled into dist-tsc must import the facade instead of the real
// frozen API. Redirect their bare `"vscode"` imports to the mutable shim. The
// shim must not import `"vscode"` itself.
function redirectVscodeImportsForCompiledModules(): void {
	const shimUrl = pathToFileURL(
		path.resolve(import.meta.dirname, "../mocks/vscode-shim.js"),
	).href;

	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (
				specifier === "vscode" &&
				typeof context.parentURL === "string" &&
				context.parentURL.includes("/dist-tsc/")
			) {
				return { url: shimUrl, shortCircuit: true };
			}
			return nextResolve(specifier, context);
		},
	});
}

export async function run(): Promise<void> {
	installVscodeFacade();
	redirectVscodeImportsForCompiledModules();

	const appendReport = (line: string) => {
		try {
			fs.appendFileSync(reportPath, line + "\n");
		} catch {
			/* ignore */
		}
	};

	// Surface uncaught errors so a crash still leaves a trail in the report.
	process.on("uncaughtException", (err) =>
		appendReport(`UNCAUGHT: ${err && err.stack ? err.stack : String(err)}`),
	);
	process.on("unhandledRejection", (reason) =>
		appendReport(
			`UNHANDLED: ${reason && (reason as any).stack ? (reason as any).stack : String(reason)}`,
		),
	);

	const mocha = new Mocha({
		ui: "tdd",
		color: false,
		timeout: 10000,
		reporter: "spec",
	});
	// Optional focused runs: MOCHA_GREP="toggleVoiceCapture" node dist-tsc/test/runTest.js
	if (process.env.MOCHA_GREP) {
		mocha.grep(new RegExp(process.env.MOCHA_GREP));
	}

	const testsRoot = path.resolve(import.meta.dirname, ".");
	const files = await glob("**/**.test.js", { cwd: testsRoot });

	for (const file of files) {
		mocha.addFile(path.resolve(testsRoot, file));
	}

	return new Promise((resolve, reject) => {
		try {
			const results = { pass: 0, fail: 0, failures: [] as string[] };
			const runner = mocha.run((failures) => {
				const lines = [`PASS: ${results.pass}  FAIL: ${results.fail}`];
				for (const f of results.failures) {
					lines.push(`FAIL: ${f}`);
				}
				fs.writeFileSync(reportPath, lines.join("\n") + "\n");
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});

			// Inside the VS Code extension host, console output is routed to the
			// Output channel rather than stdout, so the reporter's results are
			// swallowed. Mirror pass/fail results to a file we can read back.
			runner.on("pass", () => {
				results.pass++;
			});
			runner.on("fail", (test: any, err: any) => {
				results.fail++;
				results.failures.push(
					`${test.fullTitle()}: ${err && err.message ? err.message : String(err)}`,
				);
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}

// When invoked directly (e.g. `node dist-tsc/test/suite/index.js`) rather than
// through the VS Code extension-host test runner, run the suite immediately.
// Under the extension host VS Code calls run() itself, so this guard is a no-op
// there. This also lets the suite run under plain Node (no Electron host),
// which avoids the inotify/Agent-Host resource limits of the full IDE.
const isMain =
	typeof process !== "undefined" &&
	!!process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	void run();
}
