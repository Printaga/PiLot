// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the commit-message model chooser in SettingsPanel.
// The empty string is load-bearing — it is what "use the standard PI model"
// persists to `pi-agent.git.commitMessageModel`, so it must survive the
// round-trip through the <select> rather than being treated as "nothing
// selected".

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
const { default: SettingsPanel } = await import("../../webview/components/SettingsPanel.svelte");

const MODELS = [
	{ id: "anthropic/claude-haiku-4-5", provider: "anthropic", name: "Claude Haiku 4.5" },
	{ id: "anthropic/claude-sonnet-4-5", provider: "anthropic", name: "Claude Sonnet 4.5" },
];

/** Mount the panel with the minimum required props plus per-test overrides. */
function mount(overrides = {}) {
	return render(SettingsPanel, {
		autoContext: false,
		appVersion: "0.0.0-test",
		thinkingLevel: "medium",
		onAutoContextChange: () => {},
		onThinkingLevelChange: () => {},
		commitMessageModels: MODELS,
		...overrides,
	});
}

/** Select a value the way a user would: set the value, dispatch `change`. */
function choose(select, value) {
	const proto = globalThis.window.HTMLSelectElement.prototype ?? Object.getPrototypeOf(select);
	const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
	if (setter) setter.call(select, value);
	else select.value = value;
	select.dispatchEvent(new globalThis.window.Event("change", { bubbles: true }));
}

suite("SettingsPanel commit-message model chooser", () => {
	teardown(() => cleanup());

	test("offers an explicit standard-model option alongside the reported models", () => {
		const mounted = mount();
		const select = mounted.container.querySelector(".model-select");
		assert.ok(select, "the chooser should render");

		const labels = [...select.querySelectorAll("option")].map((o) => o.textContent.trim());
		assert.ok(
			labels.includes("Use standard PI model"),
			`expected a standard-model option, got: ${labels.join(" | ")}`,
		);
		assert.ok(labels.includes("Claude Haiku 4.5"), "reported models should be selectable");
		assert.strictEqual(
			select.querySelector("option").value,
			"",
			"the standard option must store the empty string",
		);
	});

	test("selecting the standard option emits an empty model id", () => {
		const seen = [];
		const mounted = mount({
			commitMessageModel: "anthropic/claude-sonnet-4-5",
			onCommitMessageModelChange: (value) => seen.push(value),
		});
		const select = mounted.container.querySelector(".model-select");

		choose(select, "");

		assert.deepStrictEqual(seen, [""], "clearing the pin must emit an empty string");
	});

	test("selecting a specific model emits its provider/id", () => {
		const seen = [];
		const mounted = mount({
			onCommitMessageModelChange: (value) => seen.push(value),
		});
		const select = mounted.container.querySelector(".model-select");

		choose(select, "anthropic/claude-haiku-4-5");

		assert.deepStrictEqual(seen, ["anthropic/claude-haiku-4-5"]);
	});

	test("reflects a persisted model on load", () => {
		const mounted = mount({ commitMessageModel: "anthropic/claude-haiku-4-5" });
		const select = mounted.container.querySelector(".model-select");
		assert.strictEqual(select.value, "anthropic/claude-haiku-4-5");
	});

	test("reflects the standard model when nothing is pinned", () => {
		const mounted = mount({ commitMessageModel: "" });
		const select = mounted.container.querySelector(".model-select");
		assert.strictEqual(select.value, "");
	});

	test("keeps a pinned model that is absent from the reported list", () => {
		const mounted = mount({ commitMessageModel: "custom/local-model" });
		const select = mounted.container.querySelector(".model-select");

		assert.strictEqual(
			select.value,
			"custom/local-model",
			"an unlisted pinned model must still be reflected, not silently reset",
		);
	});
});
