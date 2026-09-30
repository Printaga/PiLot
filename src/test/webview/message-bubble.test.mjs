// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the keyed-each streaming contract in MessageBubble.
// The each-block is keyed by ARRAY INDEX (not by content): non-string parts
// (code/mermaid wrappers) are patched in place as long as their index is
// stable — i.e. for APPEND-ONLY growth at the tail. Anything that inserts
// before a block shifts indices and remounts the block; these tests pin the
// append-only case and document that boundary.

import * as assert from "node:assert";
import "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports.

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
		assert.ok(wrapper, "assistant bubble should render a .text-wrapper");

		// Chunk 2: paragraph + closed code fence → parse list grows at the tail.
		await mounted.rerender({ message: baseMessage(`${PARA}\n\n${FENCE}`) });
		const codeBlock = wrapper.querySelector(".code-block-wrapper");
		assert.ok(codeBlock, "closed code fence should render a code-block-wrapper");
		assert.strictEqual(codeBlock.querySelector(".code-lang")?.textContent, "js");

		// Chunk 3: text appended AFTER the block (append-only growth). Identity
		// assertion: the block's wrapper is the SAME DOM node — patched in place
		// by the index-keyed diff, never remounted.
		await mounted.rerender({ message: baseMessage(`${PARA}\n\n${FENCE}\n\nTail text.`) });
		const codeBlockAfter = wrapper.querySelector(".code-block-wrapper");
		assert.strictEqual(codeBlockAfter, codeBlock, "code block must not remount mid-stream");
		// Same node is not enough: the keyed diff could have patched a *different*
		// part into it. Assert the preserved node still renders the same block.
		assert.strictEqual(
			codeBlockAfter.querySelector(".code-lang")?.textContent,
			"js",
			"reused node must still render the original code block",
		);
		assert.ok(
			codeBlockAfter.textContent.includes("console.log('done');"),
			"reused node must still render the original code body",
		);
		assert.ok(wrapper.querySelector("p.md-p"), "markdown paragraph renders");
		assert.ok(wrapper.textContent.includes("Tail text."));
	});

	test("open fence that closes later switches from text to code without losing the paragraph", async () => {
		const mounted = render(MessageBubble, { message: baseMessage(PARA) });
		const wrapper = mounted.container.querySelector(".text-wrapper");
		assert.ok(wrapper, "assistant bubble should render a .text-wrapper");

		// Chunk 2: fence still OPEN → parser sees only the paragraph as text.
		await mounted.rerender({ message: baseMessage(`${PARA}\n\n\`\`\`js\nconst x = 1;`) });
		assert.strictEqual(
			wrapper.querySelector(".code-block-wrapper"),
			null,
			"an open fence is not yet a code block",
		);

		// Chunk 3: the fence CLOSES → the tail string part becomes a code block.
		// This is the shape change the index key cannot patch in place.
		await mounted.rerender({
			message: baseMessage(`${PARA}\n\n\`\`\`js\nconst x = 1;\n\`\`\``),
		});
		const codeBlock = wrapper.querySelector(".code-block-wrapper");
		assert.ok(codeBlock, "closing the fence must produce a code block");
		assert.strictEqual(codeBlock.querySelector(".code-lang")?.textContent, "js");
		assert.ok(
			codeBlock.textContent.includes("const x = 1;"),
			"code body must survive the shape change",
		);
		assert.ok(wrapper.querySelector("p.md-p"), "the paragraph stays a paragraph");
	});

	test("code body grows while the fence stays open (header/copy state survive)", async () => {
		const mounted = render(MessageBubble, {
			message: baseMessage(`${PARA}\n\n\`\`\`js\nconst x = 1;\n\`\`\``),
		});
		const wrapper = mounted.container.querySelector(".text-wrapper");
		assert.ok(wrapper, "assistant bubble should render a .text-wrapper");
		const codeBlock = wrapper.querySelector(".code-block-wrapper");
		assert.ok(codeBlock, "closed fence should render a code-block-wrapper");

		// Body grows INSIDE the block (fence stays closed) — the stressful case
		// for patch-in-place: the wrapper header/copy state must survive.
		await mounted.rerender({
			message: baseMessage(`${PARA}\n\n\`\`\`js\nconst x = 1;\nconst y = 2;\n\`\`\``),
		});
		const codeBlockAfter = wrapper.querySelector(".code-block-wrapper");
		assert.strictEqual(codeBlockAfter, codeBlock, "growing body must not remount the block");
		assert.ok(
			codeBlockAfter.textContent.includes("const y = 2;"),
			"grown body must be rendered",
		);
	});
});
