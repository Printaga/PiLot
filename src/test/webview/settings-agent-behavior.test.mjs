// Host-independent Svelte 5 webview component tests (plain Node + jsdom).
//
// Characterization target: the cache-warming and defaultTools-codemode
// controls in SettingsPanel. Both are host-driven: the panel requests the
// current values on mount, applies `...-changed` messages without writing
// anything back, and only emits a set-message on user interaction.

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

function send(type, data) {
	domWindow.dispatchEvent(new domWindow.MessageEvent("message", { data: { type, data } }));
}

function control(container, selector) {
	const element = container.querySelector(selector);
	assert.ok(element, `expected ${selector} to render`);
	return element;
}

suite("SettingsPanel cache warming and defaultTools codemode", () => {
	teardown(() => {
		cleanup();
		delete domWindow.vscode;
	});

	test("requests both host values on mount", async () => {
		const messages = installHost();
		mount();
		await tick();

		assert.ok(
			messages.some((message) => message.type === "getCacheWarming"),
			"mounting must ask the host for the cache-warming mode",
		);
		assert.ok(
			messages.some((message) => message.type === "getDefaultToolsCodemode"),
			"mounting must ask the host for the defaultTools codemode state",
		);
	});

	test("applies the host cache-warming mode and ignores unknown modes", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		send("cache-warming-changed", { mode: "idle" });
		await tick();
		assert.strictEqual(
			control(mounted.container, 'select[aria-label="Cache Warming"]').value,
			"idle",
		);

		send("cache-warming-changed", { mode: "turbo" });
		await tick();
		assert.strictEqual(
			control(mounted.container, 'select[aria-label="Cache Warming"]').value,
			"idle",
			"an unknown mode must leave the control untouched",
		);
		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setCacheWarming"),
			[],
			"reading host state must not emit a settings write",
		);
	});

	test("a user change to cache warming writes through to the host", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		const select = control(mounted.container, 'select[aria-label="Cache Warming"]');
		select.value = "off";
		select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
		await tick();

		assert.deepStrictEqual(messages.at(-1), {
			type: "setCacheWarming",
			data: { mode: "off" },
		});
	});

	test("applies the host defaultTools-codemode state", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		send("default-tools-codemode", { enabled: true, globalEnabled: true });
		await tick();

		assert.strictEqual(
			control(mounted.container, 'input[aria-label="Enable Codemode by default"]').checked,
			true,
		);
		assert.match(mounted.container.textContent, /\+codemode is in the global defaultTools/);
		assert.deepStrictEqual(
			messages.filter((message) => message.type === "setDefaultToolsCodemode"),
			[],
			"reading host state must not emit a settings write",
		);

		send("default-tools-codemode", { enabled: false, globalEnabled: false });
		await tick();
		assert.strictEqual(
			control(mounted.container, 'input[aria-label="Enable Codemode by default"]').checked,
			false,
		);
	});

	test("toggling the codemode default writes through to the host", async () => {
		const messages = installHost();
		const mounted = mount();
		await tick();

		send("default-tools-codemode", { enabled: false, globalEnabled: false });
		await tick();

		const toggle = control(mounted.container, 'input[aria-label="Enable Codemode by default"]');
		toggle.click();
		await tick();

		assert.deepStrictEqual(messages.at(-1), {
			type: "setDefaultToolsCodemode",
			data: { enabled: true },
		});
	});
});
