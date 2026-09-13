// Run webview component tests under plain Node + jsdom (no VS Code host).
// Owns all harness wiring: registers the Svelte loader hooks, installs Mocha's
// tdd globals via the documented pre-require event, then imports each spec —
// literal imports keep the chain statically traceable for Fallow's audit.
import Mocha from "mocha";
// The register() string path below is invisible to static analysis; this
// static import is the loader's traceable dependency edge (Fallow audit).
import "../scripts/webview-test-loader.mjs";

const { register } = await import("node:module");
await register(import.meta.resolve("../scripts/webview-test-loader.mjs"));

const mocha = new Mocha({ ui: "tdd" });
mocha.suite.emit("pre-require", globalThis, "webview-tests", mocha);

await import("../src/test/webview/message-bubble.test.mjs");
await import("../src/test/webview/chat-search.test.mjs");

mocha.run((failures) => process.exit(failures > 0 ? 1 : 0));
