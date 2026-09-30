// Host-independent Svelte 5 webview component test (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Regression target: the "No packages installed" bug. The host broadcasts the
// package list as `{ type: "installed", data: { installed: [...] } }`, but the
// panel reads `data.installed` through parseHostMessage — which (before the fix
// allowed arrays through) collapsed the older bare-array payload to {}. The
// panel then rendered "No packages installed" even though packages WERE
// installed. Sender-identity guards broke the same list twice more (VS Code's
// real sender is neither the page window nor its parent), so the delivery
// helper below posts from a stand-in host page and a test pins that only a
// well-formed host envelope may change the list.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports.

const { render, cleanup } = await import("@testing-library/svelte");
const { default: PiPackagesPanel } =
	await import("../../webview/components/PiPackagesPanel.svelte");

// The panel fetches the npm registry on mount; the tests must not touch the
// network. Empty result set is fine — the Installed tab is what we assert on.
globalThis.fetch = async () => ({ json: async () => ({ objects: [] }) });

const PKG = {
	source: "npm:pi-lean-ctx",
	path: "/home/u/.pi/agent/npm/node_modules/pi-lean-ctx",
	description: "Lean context package",
	version: "1.2.3",
	types: ["skills"],
	skills: [{ name: "lean", description: "Lean skill" }],
	extensions: [],
	prompts: [],
};

/** Flush Svelte 5's batched updates (microtask + timer). */
const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

/** Deliver an `installed` message the way the extension host would. */
function pushInstalled(data, source = hostMessageSource) {
	globalThis.window.dispatchEvent(
		new domWindow.MessageEvent("message", {
			data: { type: "installed", data },
			source,
		}),
	);
}

// The panel only attaches its message listener after acquiring the VS Code
// API (as it does in the real webview), so provide a minimal stub before the
// first render. jsdom has no acquireVsCodeApi of its own.
let postedToHost = [];
domWindow.acquireVsCodeApi = () => ({
	postMessage: (msg) => {
		postedToHost.push(msg);
	},
});

suite("PiPackagesPanel installed-list contract", () => {
	teardown(() => cleanup());

	test("renders the wrapped { installed: [...] } payload the host now sends", async () => {
		const mounted = render(PiPackagesPanel, {});
		pushInstalled({ installed: [PKG] });
		await flush();

		const name = mounted.container.querySelector(".package-name");
		assert.ok(name, "an installed package card should render");
		assert.ok(
			name.textContent.includes("pi-lean-ctx"),
			`expected the package name, got: ${name.textContent}`,
		);
		assert.strictEqual(
			mounted.container.querySelector(".status")?.textContent,
			undefined,
			"the empty-state message must not show when packages exist",
		);
	});

	test("still renders a legacy bare-array payload instead of blanking the list", async () => {
		const mounted = render(PiPackagesPanel, {});
		pushInstalled([PKG]);
		await flush();

		const name = mounted.container.querySelector(".package-name");
		assert.ok(
			name?.textContent.includes("pi-lean-ctx"),
			"a bare-array payload must still render the package card",
		);
	});

	test("malformed payloads render the empty state without throwing", async () => {
		const mounted = render(PiPackagesPanel, {});
		pushInstalled({ installed: [null, 42, { noSource: true }, PKG] });
		await flush();

		// Entries without a string `source` are dropped; the valid one renders.
		const names = [...mounted.container.querySelectorAll(".package-name")];
		assert.strictEqual(names.length, 1, "only well-formed entries render");
		assert.ok(names[0].textContent.includes("pi-lean-ctx"));
	});

	test("an envelope-less message cannot replace the installed list", async () => {
		const mounted = render(PiPackagesPanel, {});
		pushInstalled({ installed: [PKG] });
		await flush();

		// No string `type` — not a host envelope, so the list must survive.
		globalThis.window.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: { installed: [] },
				source: hostMessageSource,
			}),
		);
		await flush();

		assert.ok(
			mounted.container.querySelector(".package-name")?.textContent.includes("pi-lean-ctx"),
			"only a valid host envelope may change the visible package list",
		);
	});
});
