// Host-independent Svelte 5 webview component test (plain Node + jsdom).
// Mounted via the repository's own Svelte compiler; see scripts/webview-test-loader.mjs.
//
// Regression target: the Sessions (history) list. The host broadcasts
// `{ type: "sessions-list", data: { sessions: [...] } }` in reply to the
// panel's `listSessions` request; the panel reads it through parseHostMessage,
// which an earlier sender guard made reject every real host message — the
// panel sat on "Loading sessions..." forever. These tests pin the wrapped
// shape, the legacy bare-array tolerance, hostile-entry filtering, and the
// envelope requirement, delivering messages from a stand-in host page.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports.

const { render, cleanup } = await import("@testing-library/svelte");
const { default: SessionTree } = await import("../../webview/components/SessionTree.svelte");

const NOW = 1_700_000_000_000;
const SESSIONS = [
	{ id: "s1", label: "First session", timestamp: NOW, messageCount: 3 },
	{ id: "s2", label: "Second session", timestamp: NOW - 3_600_000, messageCount: 12 },
];

/** Flush Svelte 5's batched updates (microtask + timer). */
const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

/** Deliver a `sessions-list` message the way the extension host does. */
function pushSessionsList(data, source = hostMessageSource) {
	globalThis.window.dispatchEvent(
		new domWindow.MessageEvent("message", {
			data: { type: "sessions-list", data },
			source,
		}),
	);
}

function labels(mounted) {
	return [...mounted.container.querySelectorAll(".session-row .label")].map((l) => l.textContent);
}

suite("SessionTree sessions-list contract", () => {
	teardown(() => cleanup());

	test("renders the wrapped { sessions: [...] } payload the host sends", async () => {
		const mounted = render(SessionTree, {});
		pushSessionsList({ sessions: SESSIONS });
		await flush();

		assert.deepStrictEqual(labels(mounted), ["First session", "Second session"]);
		assert.strictEqual(
			mounted.container.querySelector(".empty"),
			null,
			"the loading/empty state must clear once the list arrives",
		);
	});

	test("still renders a legacy bare-array payload instead of blanking the list", async () => {
		const mounted = render(SessionTree, {});
		pushSessionsList(SESSIONS);
		await flush();

		assert.deepStrictEqual(labels(mounted), ["First session", "Second session"]);
	});

	test("drops malformed entries instead of failing to render", async () => {
		const mounted = render(SessionTree, {});
		pushSessionsList({ sessions: [null, 42, { noId: true }, SESSIONS[0]] });
		await flush();

		assert.deepStrictEqual(labels(mounted), ["First session"]);
	});

	test("an envelope-less message cannot replace the list", async () => {
		const mounted = render(SessionTree, {});
		pushSessionsList({ sessions: SESSIONS });
		await flush();

		// No string `type` — not a host envelope, so the history must survive.
		globalThis.window.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: { sessions: [] },
				source: hostMessageSource,
			}),
		);
		await flush();

		assert.deepStrictEqual(
			labels(mounted),
			["First session", "Second session"],
			"only a valid host envelope may change the visible history",
		);
	});
});
