// Chat search navigation: count must correspond to a visible target and
// prev/next must move that target (regression: count showed but the view
// never moved to the phrase).
import * as assert from "node:assert";
import { JSDOM } from "jsdom";

let domWindow = globalThis.window;
if (!domWindow || !domWindow.document) {
	domWindow = new JSDOM("<!doctype html><html><body></body></html>").window;
	globalThis.window = domWindow;
	globalThis.document = domWindow.document;
}
for (const k of [
	"navigator",
	"Element",
	"Node",
	"Text",
	"Comment",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLMediaElement",
	"SVGElement",
	"DocumentFragment",
]) {
	Object.defineProperty(globalThis, k, {
		value: domWindow[k],
		configurable: true,
		writable: true,
	});
}
globalThis.window.requestAnimationFrame ??= (cb) => globalThis.setTimeout(cb, 0);

const { render, cleanup } = await import("@testing-library/svelte");
const { default: ChatPanel } = await import("../../webview/components/ChatPanel.svelte");

function msg(content, extra = {}) {
	return { role: "assistant", content, timestamp: 1_700_000_000_000, ...extra };
}

const MESSAGES = [msg("hello world"), msg("needle in the haystack here"), msg("goodbye world")];

async function flush(rounds = 5) {
	for (let i = 0; i < rounds; i += 1) {
		await new Promise((r) => globalThis.setTimeout(r, 0));
	}
}

function typeSearch(container, text) {
	const input = container.querySelector(".search-input");
	assert.ok(input, "search input should render when searchRequestTick opens search");
	input.focus();
	// Native setter + input event so Svelte's bind:value picks up the change.
	const proto = globalThis.window.HTMLInputElement.prototype ?? Object.getPrototypeOf(input);
	const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
	if (setter) setter.call(input, text);
	else input.value = text;
	input.dispatchEvent(new globalThis.window.Event("input", { bubbles: true }));
}

suite("ChatPanel search navigation", () => {
	teardown(() => cleanup());

	test("single match highlights the phrase and marks the message current", async () => {
		const mounted = render(ChatPanel, {
			messages: MESSAGES,
			isStreaming: false,
			onSend: () => {},
			searchRequestTick: 1,
		});
		await flush();

		typeSearch(mounted.container, "needle");
		await flush();

		const count = mounted.container.querySelector(".search-count")?.textContent;
		assert.strictEqual(count, "1/1");

		const marks = mounted.container.querySelectorAll("mark.search-highlight");
		assert.ok(marks.length >= 1, "match should render a visible <mark> highlight");
		assert.ok(
			[...marks].some((m) => m.textContent?.toLowerCase() === "needle"),
			"highlight should wrap the matched phrase",
		);

		const current = mounted.container.querySelector(".message-wrapper.search-current");
		assert.ok(current, "current match message should carry .search-current");
		assert.strictEqual(current.getAttribute("data-msg-index"), "1");
		assert.ok(
			current.querySelector("mark.search-highlight-current"),
			"active phrase should carry .search-highlight-current",
		);
	});

	test("next/prev move the current match between messages", async () => {
		const mounted = render(ChatPanel, {
			messages: MESSAGES,
			isStreaming: false,
			onSend: () => {},
			searchRequestTick: 1,
		});
		await flush();

		typeSearch(mounted.container, "world");
		await flush();

		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "1/2");
		assert.strictEqual(
			mounted.container
				.querySelector(".message-wrapper.search-current")
				?.getAttribute("data-msg-index"),
			"0",
		);

		const [prev, next] = mounted.container.querySelectorAll(".search-nav");
		assert.ok(next, "next button should render");
		next.click();
		await flush();

		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "2/2");
		assert.strictEqual(
			mounted.container
				.querySelector(".message-wrapper.search-current")
				?.getAttribute("data-msg-index"),
			"2",
		);

		assert.ok(prev, "prev button should render");
		prev.click();
		await flush();

		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "1/2");
		assert.strictEqual(
			mounted.container
				.querySelector(".message-wrapper.search-current")
				?.getAttribute("data-msg-index"),
			"0",
		);
	});
});
