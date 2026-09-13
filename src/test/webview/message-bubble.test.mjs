// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the keyed-each streaming contract in MessageBubble.
// Non-string parts (code/mermaid wrappers) are keyed-diff items: under a stable
// key they are patched in place as the message grows; under a volatile key
// (e.g. one derived from parsed content) they remount on every streamed chunk.

// ── jsdom DOM setup (must precede any component import) ─────────────────────
import * as assert from "node:assert";
import { JSDOM } from "jsdom";
// Svelte loader hooks are registered by the runner before this spec imports.

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Required by Svelte's client runtime (init_operations + navigator sniff).
// defineProperty because Node ≥21 ships a read-only globalThis.navigator.
for (const k of ["navigator", "Element", "Node", "Text", "Comment"]) {
	Object.defineProperty(globalThis, k, {
		value: dom.window[k],
		configurable: true,
		writable: true,
	});
}

const { render, cleanup } = await import("@testing-library/svelte");
const { default: MessageBubble } = await import("../../webview/components/MessageBubble.svelte");

function baseMessage(content) {
	return { role: "assistant", content, timestamp: 1_700_000_000_000 };
}

const PARA = "Hello, streaming world.";
const FENCE = "```js\nconsole.log('done');\n```";

suite("MessageBubble streaming keyed-each", () => {
	teardown(() => cleanup());

	test("closed code block stays mounted (no remount) while the message keeps streaming", async () => {
		// Chunk 1: paragraph only.
		const mounted = render(MessageBubble, { message: baseMessage(PARA) });
		const wrapper = mounted.container.querySelector(".text-wrapper");

		// Chunk 2: paragraph + closed code fence → parse list grows at the tail.
		await mounted.rerender({ message: baseMessage(`${PARA}\n\n${FENCE}`) });
		const codeBlock = wrapper.querySelector(".code-block-wrapper");
		assert.ok(codeBlock, "closed code fence should render a code-block-wrapper");
		assert.strictEqual(codeBlock.querySelector(".code-lang")?.textContent, "js");

		// Chunk 3: text appended AFTER the block (append-only growth). Identity
		// assertion: the block's wrapper is the SAME DOM node — patched in place
		// by the keyed diff, never remounted.
		await mounted.rerender({ message: baseMessage(`${PARA}\n\n${FENCE}\n\nTail text.`) });
		const codeBlockAfter = wrapper.querySelector(".code-block-wrapper");
		assert.strictEqual(codeBlockAfter, codeBlock, "code block must not remount mid-stream");
		assert.ok(wrapper.querySelector("p.md-p"), "markdown paragraph renders");
		assert.ok(wrapper.textContent.includes("Tail text."));
	});
});
