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
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";

// Anchor every path to this script's location so the runner works from any cwd
// (the suite writes its report next to the compiled index.js regardless of cwd).
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const distPath = (...segments) => path.resolve(repoRoot, "dist-tsc", ...segments);

// Build a self-contained vscode facade (no real VS Code host needed) and expose
// it on globalThis BEFORE any module imports the `vscode` specifier.
const facadeUrl = pathToFileURL(distPath("test", "mocks", "vscode-facade.js")).href;
const facadeMod = await import(facadeUrl);
facadeMod.installVscodeFacade();

const shimUrl = pathToFileURL(distPath("test", "mocks", "vscode-shim.js")).href;

registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "vscode") {
			return { url: shimUrl, format: "module", shortCircuit: true };
		}
		return next(specifier, context);
	},
});

// The suite APPENDS its summary to the report, so a stale report from a
// previous run must never decide this run's verdict. Delete it up front and
// remember when the run started; only a report written after that counts.
const resultsLog = distPath("test", "suite", "test-results.log");
const runStartedAt = Date.now();
try {
	rmSync(resultsLog, { force: true });
} catch {
	/* best effort; the mtime check below still guards stale content */
}

const indexUrl = pathToFileURL(distPath("test", "suite", "index.js")).href;
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
	// authoritative, but a crashed run must never exit 0.
	process.exitCode = 1;
}

// Watchdog: force-exit once the result log is written. Some suite teardowns
// (disposing providers created by buildProvider) can leave open handles that
// keep the event loop alive; the authoritative result is already in the log.
// If the log never appears the run produced NO result — exit non-zero instead
// of reporting success (previous behavior masked crashed/misconfigured runs).
const WATCHDOG_POLL_MS = 200;
const WATCHDOG_TIMEOUT_MS = 60_000;
for (let waited = 0; waited < WATCHDOG_TIMEOUT_MS; waited += WATCHDOG_POLL_MS) {
	if (existsSync(resultsLog)) {
		try {
			// Only a report written by THIS run counts: the suite appends, so an
			// older run's summary line is still in the file otherwise. Match the
			// anchored summary line, not the per-failure detail lines. Mirrors
			// isGreenReport() in src/test/runTest.ts.
			if (statSync(resultsLog).mtimeMs >= runStartedAt) {
				const log = readFileSync(resultsLog, "utf-8");
				const m = /^PASS: \d+\s+FAIL: (\d+)$/m.exec(log);
				if (m) {
					// Preserve any crash signal (UNCAUGHT/UNHANDLED handlers set
					// process.exitCode) even when mocha itself reported 0 failures.
					process.exit(Number(m[1]) > 0 ? 1 : process.exitCode || 0);
				}
			}
		} catch {
			/* transient read race: poll again */
		}
	}
	await new Promise((r) => setTimeout(r, WATCHDOG_POLL_MS));
}
console.error(
	`[run-node-tests] no result report was written to ${resultsLog} within the watchdog window — treating the run as failed.`,
);
process.exit(1);
