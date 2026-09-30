// Run webview component tests under plain Node + jsdom (no VS Code host).
// Owns all harness wiring: registers the Svelte loader hooks, installs Mocha's
// tdd globals via the documented pre-require event, then imports each spec —
// literal imports keep the chain statically traceable for Fallow's audit.
import Mocha from "mocha";
// Evaluated for its dependency edge only (Fallow audit); the loader hooks are
// installed by module.register() below. Keep it side-effect free: anything it
// patches at top level would run in this thread too.
import "../scripts/webview-test-loader.mjs";

const { register } = await import("node:module");
// register() (and the resolver string form) require Node >= 20.6; fail with an
// actionable message instead of "register is not a function".
if (typeof register !== "function") {
	console.error(
		`[run-webview-tests] module.register() requires Node >= 20.6.0. Current runtime: ${process.version}`,
	);
	process.exit(1);
}
await register(import.meta.resolve("../scripts/webview-test-loader.mjs"));

const mocha = new Mocha({ ui: "tdd" });
mocha.suite.emit("pre-require", globalThis, "webview-tests", mocha);

// Nothing verifies the emit actually installed the tdd globals; if it silently
// no-ops, specs fail deep inside with a confusing "suite is not defined".
for (const global of ["suite", "test", "setup", "teardown", "suiteSetup", "suiteTeardown"]) {
	if (typeof globalThis[global] !== "function") {
		console.error(
			`[run-webview-tests] Mocha tdd global "${global}" was not installed — the pre-require hook did not run.`,
		);
		process.exit(1);
	}
}

try {
	await import("../src/test/webview/messages-guard.test.mjs");
	await import("../src/test/webview/message-bubble.test.mjs");
	await import("../src/test/webview/chat-search.test.mjs");
	await import("../src/test/webview/settings-commit-model.test.mjs");
	await import("../src/test/webview/system-prompt-panel.test.mjs");
	await import("../src/test/webview/pi-packages-panel.test.mjs");
	await import("../src/test/webview/session-tree.test.mjs");
} catch (err) {
	console.error("[run-webview-tests] failed to load a webview spec:", err);
	process.exit(1);
}

mocha.run((failures) => {
	// Let Node flush stdout/stderr and drain lingering handles before exiting;
	// process.exit() here can truncate piped CI output mid-failure-summary.
	process.exitCode = failures > 0 ? 1 : 0;
});
