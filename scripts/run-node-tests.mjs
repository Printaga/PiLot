// Run the extension test suite under plain Node (no Electron/VS Code host).
//
// The suite is written against a `vscode` shim (src/test/mocks/vscode-shim.ts)
// exposed via globalThis.vscode, so it does not require a real VS Code host.
// Running under plain Node avoids the inotify-instance / Agent-Host resource
// limits that make the full Electron-hosted run crash (exit 7) in some
// sandboxes. The `vscode` bare import is redirected to the shim via a
// node:module registerHook registered BEFORE the suite modules are imported.
import { registerHooks } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// Build a self-contained vscode facade (no real VS Code host needed) and expose
// it on globalThis BEFORE any module imports the `vscode` specifier.
const facadeUrl = pathToFileURL(path.resolve("dist-tsc/test/mocks/vscode-facade.js")).href;
const facadeMod = await import(facadeUrl);
facadeMod.installVscodeFacade();

const shimUrl = pathToFileURL(path.resolve("dist-tsc/test/mocks/vscode-shim.js")).href;

registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "vscode") {
			return { url: shimUrl, format: "module", shortCircuit: true };
		}
		return next(specifier, context);
	},
});

const indexUrl = pathToFileURL(path.resolve("dist-tsc/test/suite/index.js")).href;
let runPromise;
try {
	const mod = await import(indexUrl);
	runPromise = mod.run();
} catch (err) {
	console.error("[run-node-tests] failed to load the test suite:", err);
	process.exit(1);
}
try {
	await runPromise;
} catch (err) {
	console.error("[run-node-tests] suite run failed:", err);
	// Fall through to the log-based verdict below; a written report is still
	// authoritative, but a crashed run without one must not exit 0.
}

// Watchdog: force-exit once the result log is written. Some suite teardowns
// (disposing providers created by buildProvider) can leave open handles that
// keep the event loop alive; the authoritative result is already in the log.
// If the log never appears the run produced NO result — exit non-zero instead
// of reporting success (previous behavior masked crashed/misconfigured runs).
const { readFileSync, existsSync } = await import("node:fs");
const resultsLog = "dist-tsc/test/suite/test-results.log";
for (let i = 0; i < 100; i++) {
	if (existsSync(resultsLog)) {
		const log = readFileSync(resultsLog, "utf-8");
		const m = /FAIL:\s*(\d+)/.exec(log);
		if (m) process.exit(Number(m[1]) > 0 ? 1 : 0);
	}
	await new Promise((r) => setTimeout(r, 200));
}
console.error(
	`[run-node-tests] no result report was written to ${resultsLog} within the watchdog window — treating the run as failed.`,
);
process.exit(1);
