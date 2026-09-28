// Host-independent Svelte 5 webview component test (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the System Prompt sidebar panel. The prompt text is
// the payload the host pushes via `system-prompt` messages; the panel must
// render it verbatim, offer it to the clipboard, and keep degrading gracefully
// when no session prompt is available.

// ── jsdom DOM setup (must precede any component import) ─────────────────────
import * as assert from "node:assert";
import { JSDOM } from "jsdom";
// Svelte loader hooks are registered by the runner before this spec imports.

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const k of [
	"navigator",
	"Element",
	"Node",
	"Text",
	"Comment",
	"HTMLElement",
	"HTMLSelectElement",
	"HTMLOptionElement",
	"Event",
	"MessageEvent",
	"MouseEvent",
	// Svelte's select binding observes option changes, so the <select> render
	// path needs MutationObserver on the global scope.
	"MutationObserver",
]) {
	Object.defineProperty(globalThis, k, {
		value: dom.window[k],
		configurable: true,
		writable: true,
	});
}
globalThis.window.requestAnimationFrame ??= (cb) => globalThis.setTimeout(cb, 0);

const { render, cleanup } = await import("@testing-library/svelte");
const { default: SystemPromptPanel } =
	await import("../../webview/components/SystemPromptPanel.svelte");

const PROMPT = "You are a helpful coding agent.";

/** Flush Svelte 5's batched updates (microtask + timer). */
const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

/** Deliver a `system-prompt` message the way the extension host would. */
function pushSystemPrompt(prompt) {
	globalThis.window.dispatchEvent(
		new globalThis.window.MessageEvent("message", {
			data: { type: "system-prompt", data: { prompt } },
			source: globalThis.window,
		}),
	);
}

suite("SystemPromptPanel", () => {
	teardown(() => cleanup());

	test("renders a pushed system prompt verbatim", async () => {
		const mounted = render(SystemPromptPanel, {});
		pushSystemPrompt(PROMPT);
		await flush();

		const pre = mounted.container.querySelector(".prompt-view");
		assert.ok(pre, "the prompt view should render");
		assert.strictEqual(pre.textContent, PROMPT, "the prompt must not be rewritten");
	});

	test("shows usage metadata for the rendered prompt", async () => {
		const mounted = render(SystemPromptPanel, {});
		pushSystemPrompt(PROMPT);
		await flush();

		const meta = mounted.container.querySelector(".prompt-meta");
		assert.ok(meta, "metadata line should render");
		assert.ok(meta.textContent.includes("chars"), "should report char count");
		assert.ok(meta.textContent.includes("lines"), "should report line count");
	});

	test("renders an empty state when no prompt is available", async () => {
		const mounted = render(SystemPromptPanel, {});
		pushSystemPrompt("");
		await flush();

		assert.ok(mounted.container.querySelector(".prompt-status"), "empty state should render");
		assert.strictEqual(
			mounted.container.querySelector(".prompt-view"),
			null,
			"no prompt view without a prompt",
		);
		const copy = [...mounted.container.querySelectorAll(".action-btn")].find(
			(b) => b.textContent.trim() === "Copy",
		);
		assert.ok(copy.disabled, "copy must be disabled without a prompt");
	});

	test("copy hands the exact prompt to the clipboard", async () => {
		const written = [];
		Object.defineProperty(globalThis.navigator, "clipboard", {
			value: { writeText: async (text) => written.push(text) },
			configurable: true,
		});

		const mounted = render(SystemPromptPanel, {});
		pushSystemPrompt(PROMPT);
		await flush();

		const copy = [...mounted.container.querySelectorAll(".action-btn")].find(
			(b) => b.textContent.trim() === "Copy",
		);
		copy.click();
		await flush();

		assert.deepStrictEqual(written, [PROMPT]);
	});

	test("ignores malformed and unrelated host messages", async () => {
		const mounted = render(SystemPromptPanel, {});

		globalThis.window.dispatchEvent(
			new globalThis.window.MessageEvent("message", { data: "junk" }),
		);
		globalThis.window.dispatchEvent(
			new globalThis.window.MessageEvent("message", {
				data: { type: "unrelated", data: { prompt: "nope" } },
			}),
		);
		await flush();

		assert.ok(
			mounted.container.querySelector(".prompt-status"),
			"the panel should stay in its initial waiting state",
		);
	});
});
