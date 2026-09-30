// Chat search navigation: count must correspond to a visible target and
// prev/next must move that target (regression: count showed but the view
// never moved to the phrase).
import * as assert from "node:assert";
import { domWindow } from "./test-dom-setup.mjs";

/**
 * Make `scrollTop` writable and geometry observable on `el` (jsdom's
 * prototype accessor is getter-only and rects are all-zero, which makes the
 * component's scroll writes no-op silently). Returns a restore function.
 */
function stubScroll(el) {
	scrollWrites = 0; // each install measures only its own test's writes
	let scrollTop = 0;
	Object.defineProperty(el, "scrollTop", {
		get: () => scrollTop,
		set: (v) => {
			scrollTop = Math.max(0, v); // no layout: clamp like a real scroller
			scrollWrites += 1;
		},
		configurable: true,
	});
	el.getBoundingClientRect = () => ({ top: 0, height: 400 });
	return () => {
		delete el.scrollTop; // drop the own property → prototype accessor again
		delete el.getBoundingClientRect;
	};
}

let scrollWrites = 0;

const { render, cleanup } = await import("@testing-library/svelte");
const { default: ChatPanel } = await import("../../webview/components/ChatPanel.svelte");

function msg(content) {
	return { role: "assistant", content, timestamp: 1_700_000_000_000 };
}

const MESSAGES = [msg("hello world"), msg("needle in the haystack here"), msg("goodbye world")];

/**
 * Open the search bar the way a user does: click the toolbar toggle. (The
 * Ctrl+F bridge intentionally ignores a mount-time tick so a stale counter
 * cannot re-open the bar on remount, so mounting with searchRequestTick > 0
 * alone would not open it.)
 */
async function openSearchBar(mounted) {
	const toggle = mounted.container.querySelector('button[aria-label="Search chat history"]');
	assert.ok(toggle, "search toolbar button should render");
	toggle.click();
	await flush();
}

/** Drain Svelte's batched updates after typing (microtask + timer rounds). */
async function flush(rounds = 5) {
	for (let i = 0; i < rounds; i += 1) {
		await new Promise((r) => globalThis.setTimeout(r, 0));
	}
}

/** Wait until `predicate()` holds, failing loudly instead of guessing a tick count. */
async function waitFor(predicate, { timeout = 1000, interval = 5 } = {}) {
	const deadline = Date.now() + timeout;
	for (;;) {
		if (predicate()) return;
		if (Date.now() > deadline) assert.fail("condition not met within timeout");
		await new Promise((r) => globalThis.setTimeout(r, interval));
	}
}

function typeSearch(container, text) {
	const input = container.querySelector(".search-input");
	assert.ok(input, "search input should render when searchRequestTick opens search");
	input.focus();
	// Native setter + input event so Svelte's bind:value picks up the change.
	const proto = globalThis.window.HTMLInputElement?.prototype ?? Object.getPrototypeOf(input);
	const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
	assert.ok(setter, "native value setter is required for Svelte bind:value to observe the input");
	setter.call(input, text);
	input.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
}

suite("ChatPanel search navigation", () => {
	teardown(() => cleanup());

	test("single match highlights the phrase, marks the message current, and scrolls", async () => {
		const mounted = render(ChatPanel, {
			messages: MESSAGES,
			isStreaming: false,
			onSend: () => {},
		});
		const messagesEl = mounted.container.querySelector(".messages");
		assert.ok(messagesEl, ".messages container should render");
		// jsdom has no layout: stub a real box so scrollToMatch() takes the
		// scrollTop branch instead of the offsetTop fallback (both 0 in jsdom),
		// making the scroll observable.
		stubScroll(messagesEl);

		await openSearchBar(mounted);
		typeSearch(mounted.container, "needle");
		await flush();

		const count = mounted.container.querySelector(".search-count")?.textContent;
		assert.strictEqual(count, "1/1");

		const marks = mounted.container.querySelectorAll("mark.search-highlight");
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

		assert.ok(scrollWrites > 0, "first match should scroll into view");
	});

	test("next/prev move the current match between messages", async () => {
		const mounted = render(ChatPanel, {
			messages: MESSAGES,
			isStreaming: false,
			onSend: () => {},
		});
		const messagesEl = mounted.container.querySelector(".messages");
		stubScroll(messagesEl);

		await openSearchBar(mounted);
		typeSearch(mounted.container, "world");
		await flush();

		// Count must correspond to a visible target: two highlights, exactly
		// one of them current.
		assert.strictEqual(mounted.container.querySelectorAll("mark.search-highlight").length, 2);
		assert.strictEqual(
			mounted.container.querySelectorAll("mark.search-highlight-current").length,
			1,
		);
		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "1/2");
		assert.strictEqual(
			mounted.container
				.querySelector(".message-wrapper.search-current")
				?.getAttribute("data-msg-index"),
			"0",
		);

		// Select by aria-label, not DOM order, so a markup reorder fails with a
		// readable message instead of silently swapping prev/next.
		const prev = mounted.container.querySelector('button[aria-label="Previous match"]');
		const next = mounted.container.querySelector('button[aria-label="Next match"]');
		assert.ok(prev, "prev button should render");
		assert.ok(next, "next button should render");

		next.click();
		await waitFor(
			() =>
				mounted.container
					.querySelector(".message-wrapper.search-current")
					?.getAttribute("data-msg-index") === "2",
		);

		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "2/2");

		prev.click();
		await waitFor(
			() =>
				mounted.container
					.querySelector(".message-wrapper.search-current")
					?.getAttribute("data-msg-index") === "0",
		);

		assert.strictEqual(mounted.container.querySelector(".search-count")?.textContent, "1/2");
	});
});
