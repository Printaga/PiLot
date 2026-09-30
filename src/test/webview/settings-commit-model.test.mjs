// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Characterization target: the commit-message model chooser in SettingsPanel.
// The empty string is load-bearing — it is what "use the standard PI model"
// persists to `pi-agent.git.commitMessageModel`, so it must survive the
// round-trip through the <select> rather than being treated as "nothing
// selected".

import * as assert from "node:assert";
import { domWindow } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports.

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

/** The chooser <select>, asserted once so a renamed class fails readably. */
function selectOf(mounted) {
	const select = mounted.container.querySelector(".model-select");
	assert.ok(select, "the commit-message model chooser (.model-select) should render");
	return select;
}

/** Select a value the way a user would: set the value, dispatch `change`. */
function choose(select, value) {
	// SettingsPanel uses an explicit onchange + value attribute (not
	// bind:value), so a plain assignment is the whole contract.
	select.value = value;
	select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
}

suite("SettingsPanel commit-message model chooser", () => {
	teardown(() => cleanup());

	test("offers an explicit standard-model option alongside the reported models", () => {
		const mounted = mount();
		const select = selectOf(mounted);

		const labels = [...select.querySelectorAll("option")].map((o) => o.textContent.trim());
		assert.ok(
			labels.includes("Use standard PI model"),
			`expected a standard-model option, got: ${labels.join(" | ")}`,
		);
		assert.ok(labels.includes("Claude Haiku 4.5"), "reported models should be selectable");

		// Locate the standard option by VALUE (the load-bearing part), not by
		// document order; its label is a secondary expectation.
		const standard = [...select.querySelectorAll("option")].find((o) => o.value === "");
		assert.ok(standard, "the standard option must store the empty string");
		assert.strictEqual(standard.textContent.trim(), "Use standard PI model");
	});

	test("selecting the standard option emits an empty model id", () => {
		const seen = [];
		const mounted = mount({
			commitMessageModel: "anthropic/claude-sonnet-4-5",
			onCommitMessageModelChange: (value) => seen.push(value),
		});

		choose(selectOf(mounted), "");

		assert.deepStrictEqual(seen, [""], "clearing the pin must emit an empty string");
	});

	test("selecting a specific model emits its provider/id", () => {
		const seen = [];
		const mounted = mount({
			onCommitMessageModelChange: (value) => seen.push(value),
		});

		choose(selectOf(mounted), "anthropic/claude-haiku-4-5");

		assert.deepStrictEqual(seen, ["anthropic/claude-haiku-4-5"]);
	});

	test("reflects a persisted model on load without writing back to the host", () => {
		const seen = [];
		const mounted = mount({
			commitMessageModel: "anthropic/claude-haiku-4-5",
			onCommitMessageModelChange: (value) => seen.push(value),
		});
		const select = selectOf(mounted);
		assert.strictEqual(select.value, "anthropic/claude-haiku-4-5");
		// Mounting must not emit a model change (a refactor to bind:value/$effect
		// would start emitting a spurious settings write on load).
		assert.deepStrictEqual(seen, [], "mounting must not emit a model change");
	});

	test("re-syncs the select when the host updates the persisted model", async () => {
		const mounted = mount({ commitMessageModel: "" });
		const select = selectOf(mounted);
		assert.strictEqual(select.value, "");

		await mounted.rerender({ commitMessageModel: "anthropic/claude-sonnet-4-5" });
		assert.strictEqual(
			select.value,
			"anthropic/claude-sonnet-4-5",
			"the chooser must follow host-side setting updates",
		);
	});

	test("reflects the standard model when nothing is pinned", () => {
		const mounted = mount({ commitMessageModel: "" });
		const select = selectOf(mounted);
		assert.strictEqual(select.value, "");
	});

	test("keeps a pinned model that is absent from the reported list", () => {
		const mounted = mount({ commitMessageModel: "custom/local-model" });
		const select = selectOf(mounted);

		assert.strictEqual(
			select.value,
			"custom/local-model",
			"an unlisted pinned model must still be reflected, not silently reset",
		);
	});
});
