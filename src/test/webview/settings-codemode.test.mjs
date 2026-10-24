// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
//
// Characterization target: the MCP & Codemode section in SettingsPanel. The
// panel owns no codemode state — it reads the host's current values and sends
// patches that the extension host writes to settings.json / mcp.json. These
// tests pin that message contract, including the floor applied to the budget.

import * as assert from "node:assert";
import { domWindow } from "./test-dom-setup.mjs";

const { render, cleanup } = await import("@testing-library/svelte");
const { tick } = await import("svelte");
const { default: SettingsPanel } = await import("../../webview/components/SettingsPanel.svelte");

function installHost() {
	const messages = [];
	domWindow.vscode = { postMessage: (message) => messages.push(message) };
	return messages;
}

function mount() {
	return render(SettingsPanel, {
		autoContext: false,
		appVersion: "0.0.0-test",
		thinkingLevel: "medium",
		onAutoContextChange: () => {},
		onThinkingLevelChange: () => {},
	});
}

function sendCodemodeSettings(data) {
	domWindow.dispatchEvent(
		new domWindow.MessageEvent("message", { data: { type: "codemode-settings", data } }),
	);
}

function sources(overrides = {}) {
	return {
		mode: "default",
		inlineBudget: "default",
		autoEnableCodemode: "default",
		...overrides,
	};
}

function badgeLabels(container) {
	return [...container.querySelectorAll(".source-badge")].map((badge) =>
		badge.textContent.trim(),
	);
}

function control(container, selector) {
	const element = container.querySelector(selector);
	assert.ok(element, `expected ${selector} to render`);
	return element;
}

function lastPatch(messages) {
	const patches = messages.filter((message) => message.type === "setCodemodeSettings");
	assert.ok(patches.length > 0, "expected a setCodemodeSettings message");
	return patches.at(-1).data;
}

suite("SettingsPanel MCP & Codemode", () => {
	teardown(() => {
		cleanup();
		delete domWindow.vscode;
	});

	test("requests the current codemode settings on mount", async () => {
		const messages = installHost();
		mount();
		await tick();

		assert.ok(
			messages.some((message) => message.type === "getCodemodeSettings"),
			"mounting must ask the host for the persisted settings",
		);
	});

	test("refreshes effective values when the panel regains focus", async () => {
		const messages = installHost();
		mount();
		await tick();

		domWindow.dispatchEvent(new domWindow.Event("focus"));

		assert.strictEqual(
			messages.filter((message) => message.type === "getCodemodeSettings").length,
			2,
			"focus must re-request project-aware values",
		);
	});

	test("reflects host values without writing them back", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		sendCodemodeSettings({
			mode: "only",
			inlineBudget: 1200,
			autoEnableCodemode: false,
			sources: sources({
				mode: "project",
				inlineBudget: "global",
				autoEnableCodemode: "project",
			}),
			projectFile: "/workspace/.pi/settings.json",
			projectStatus: "applied",
		});
		await tick();

		assert.strictEqual(
			control(mounted.container, 'select[aria-label="Codemode mode"]').value,
			"only",
		);
		assert.strictEqual(
			control(mounted.container, 'input[aria-label="Inline tool budget"]').value,
			"1200",
		);
		assert.strictEqual(
			control(mounted.container, 'input[aria-label="Auto-enable Codemode"]').checked,
			false,
		);
		assert.deepStrictEqual(
			badgeLabels(mounted.container),
			["Project", "Project", "Global"],
			"each control must show the config layer that supplied its value",
		);
		assert.match(
			mounted.container.textContent,
			/Values marked Project come from \.pi\/settings\.json/,
		);
		assert.match(mounted.container.textContent, /Auto-enable is overridden by \.pi\/mcp\.json/);
		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setCodemodeSettings"),
			[],
			"reading host state must not emit a settings write",
		);
	});

	test("marks values as defaults and explains an untrusted project file", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		sendCodemodeSettings({
			mode: "on",
			inlineBudget: 3000,
			autoEnableCodemode: true,
			sources: sources(),
			projectFile: "/workspace/.pi/settings.json",
			projectStatus: "ignored",
		});
		await tick();

		assert.deepStrictEqual(badgeLabels(mounted.container), ["Default", "Default", "Default"]);
		assert.match(mounted.container.textContent, /ignored because this project is not trusted/);
		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setCodemodeSettings"),
			[],
		);
	});

	test("surfaces a malformed project settings file without hiding global values", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		sendCodemodeSettings({
			mode: "only",
			inlineBudget: 900,
			autoEnableCodemode: true,
			sources: sources({ mode: "global", inlineBudget: "global" }),
			projectFile: "/workspace/.pi/settings.json",
			projectStatus: "invalid",
			projectError: "/workspace/.pi/settings.json: Unexpected token",
		});
		await tick();

		assert.strictEqual(
			control(mounted.container, 'select[aria-label="Codemode mode"]').value,
			"only",
		);
		assert.match(
			mounted.container.textContent,
			/Could not read \.pi\/settings\.json: \/workspace\/\.pi\/settings\.json: Unexpected token/,
		);
		assert.match(mounted.container.textContent, /Global values are shown/);
		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setCodemodeSettings"),
			[],
		);
	});

	test("selecting a codemode mode sends only the mode patch", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		const select = control(mounted.container, 'select[aria-label="Codemode mode"]');
		select.value = "only";
		select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		assert.deepStrictEqual(lastPatch(messages), { mode: "only" });
	});

	test("editing the inline budget floors the number", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		const input = control(mounted.container, 'input[aria-label="Inline tool budget"]');
		input.value = "1499.8";
		input.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		assert.deepStrictEqual(lastPatch(messages), { inlineBudget: 1499 });
	});

	test("ignores a negative inline budget instead of writing it", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		const input = control(mounted.container, 'input[aria-label="Inline tool budget"]');
		input.value = "-1";
		input.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setCodemodeSettings"),
			[],
		);
	});

	test("requests cache warming and default-tools codemode state on mount", async () => {
		const messages = installHost();
		mount();
		await tick();

		assert.ok(
			messages.some((message) => message.type === "getCacheWarming"),
			"mounting must ask the host for the cache warming mode",
		);
		assert.ok(
			messages.some((message) => message.type === "getDefaultToolsCodemode"),
			"mounting must ask the host for the defaultTools codemode state",
		);
	});

	test("changing cache warming sends the selected mode", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		domWindow.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: { type: "cache-warming-changed", data: { mode: "streaming" } },
			}),
		);
		await tick();

		const select = control(mounted.container, 'select[aria-label="Cache Warming"]');
		assert.strictEqual(select.value, "streaming");
		select.value = "off";
		select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		const posted = messages.filter((message) => message.type === "setCacheWarming");
		assert.deepStrictEqual(posted.at(-1).data, { mode: "off" });
	});

	test("toggling defaultTools codemode sends the inverted value", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		domWindow.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: {
					type: "default-tools-codemode",
					data: { enabled: false, globalEnabled: false },
				},
			}),
		);
		await tick();

		const toggle = control(mounted.container, 'input[aria-label="Enable Codemode by default"]');
		assert.strictEqual(toggle.checked, false);
		toggle.checked = true;
		toggle.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		const posted = messages.filter((message) => message.type === "setDefaultToolsCodemode");
		assert.deepStrictEqual(posted.at(-1).data, { enabled: true });
	});

	test("toggling auto-enable sends the inverted value", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		const toggle = control(mounted.container, 'input[aria-label="Auto-enable Codemode"]');
		assert.strictEqual(toggle.checked, true);
		toggle.checked = false;
		toggle.dispatchEvent(new domWindow.Event("change", { bubbles: true }));

		assert.deepStrictEqual(lastPatch(messages), { autoEnableCodemode: false });
	});
});
