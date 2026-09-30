// Host-independent Svelte 5 webview component test (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the System Prompt sidebar panel. The prompt text is
// the payload the host pushes via `system-prompt` messages; the panel must
// render it verbatim (as inert TEXT, never markup), offer it to the clipboard,
// and keep degrading gracefully when no session prompt is available.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports.

const { render, cleanup } = await import("@testing-library/svelte");
const { default: SystemPromptPanel } =
	await import("../../webview/components/SystemPromptPanel.svelte");

const PROMPT = "You are a helpful coding agent.";

/** Flush Svelte 5's batched updates (microtask + timer). */
const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

/** Deliver a `system-prompt` message the way the extension host would. */
function pushSystemPrompt(prompt, source = hostMessageSource) {
	globalThis.window.dispatchEvent(
		new domWindow.MessageEvent("message", {
			data: { type: "system-prompt", data: { prompt } },
			source,
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

	test("host-supplied markup stays inert text, never becomes DOM nodes", async () => {
		const mounted = render(SystemPromptPanel, {});

		const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
		pushSystemPrompt(hostile);
		await flush();

		const pre = mounted.container.querySelector(".prompt-view");
		assert.ok(pre, "the prompt view should render");
		assert.strictEqual(
			pre.querySelector("img, script"),
			null,
			"prompt markup must be escaped, not parsed",
		);
		assert.strictEqual(pre.textContent, hostile, "raw markup must still be shown as text");
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

	test("renders the reply to a live session's request (host-page sender)", async () => {
		// A live session means session resources; the panel then asks the host
		// for the prompt and renders whatever it answers. VS Code forwards that
		// reply from the parent frame, which an earlier guard rejected outright.
		const mounted = render(SystemPromptPanel, { sessionResources: { sessionId: "s-1" } });
		pushSystemPrompt(PROMPT);
		await flush();

		const pre = mounted.container.querySelector(".prompt-view");
		assert.ok(pre, "a live-session reply must render the prompt");
		assert.strictEqual(pre.textContent, PROMPT);
	});

	test("a message from an unrelated frame cannot fake a prompt", async () => {
		const mounted = render(SystemPromptPanel, {});
		pushSystemPrompt("forged", { name: "unrelated-frame" });
		await flush();

		assert.strictEqual(
			mounted.container.querySelector(".prompt-view"),
			null,
			"only the host page may supply the system prompt",
		);
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
		assert.ok(copy, "the copy action should always render");
		assert.ok(copy.disabled, "copy must be disabled without a prompt");
	});

	suite("copy", () => {
		let originalClipboardDescriptor;

		suiteSetup(() => {
			// Mutating the shared jsdom navigator leaks into every later spec in
			// this process; capture it once so suiteTeardown can restore it.
			originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
				globalThis.navigator,
				"clipboard",
			);
		});

		suiteTeardown(() => {
			if (originalClipboardDescriptor) {
				Object.defineProperty(
					globalThis.navigator,
					"clipboard",
					originalClipboardDescriptor,
				);
			} else {
				delete globalThis.navigator.clipboard;
			}
		});

		function stubClipboard(writeText) {
			Object.defineProperty(globalThis.navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});
		}

		test("hands the exact prompt to the clipboard and shows the copied state", async () => {
			const written = [];
			stubClipboard(async (text) => written.push(text));

			const mounted = render(SystemPromptPanel, {});
			pushSystemPrompt(PROMPT);
			await flush();

			const copy = [...mounted.container.querySelectorAll(".action-btn")].find(
				(b) => b.textContent.trim() === "Copy",
			);
			assert.ok(copy, "the copy action should render once a prompt exists");
			copy.click();
			await flush();

			assert.deepStrictEqual(written, [PROMPT]);
			assert.ok(
				copy.textContent.includes("Copied"),
				`copy button should confirm success, got: ${copy.textContent}`,
			);
		});

		test("reports a clipboard failure instead of pretending to succeed", async () => {
			stubClipboard(async () => {
				throw new Error("denied");
			});

			const mounted = render(SystemPromptPanel, {});
			pushSystemPrompt(PROMPT);
			await flush();

			const copy = [...mounted.container.querySelectorAll(".action-btn")].find(
				(b) => b.textContent.trim() === "Copy",
			);
			copy.click();
			await flush();

			assert.ok(
				copy.textContent.includes("fail"),
				`copy button should report failure, got: ${copy.textContent}`,
			);
		});
	});

	test("ignores malformed and unrelated host messages", async () => {
		// Render WITH session resources (a session is waiting on the host): the
		// panel stays in the Loading branch until a real reply arrives. Without
		// them the component deliberately shows the empty state immediately.
		const mounted = render(SystemPromptPanel, { sessionResources: {} });

		globalThis.window.dispatchEvent(new domWindow.MessageEvent("message", { data: "junk" }));
		globalThis.window.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: { type: "unrelated", data: { prompt: "nope" } },
			}),
		);
		await flush();

		const status = mounted.container.querySelector(".prompt-status");
		assert.ok(
			status?.textContent.includes("Loading"),
			"the panel should stay in its initial waiting state",
		);
		assert.strictEqual(
			mounted.container.querySelector(".prompt-view"),
			null,
			"junk messages must not produce a prompt view",
		);
	});
});
