// Focused tests for the shared host-message guard (src/webview/messages.ts).
//
// Regression target: the guard used to reject events by sender identity — first
// everything but the webview's own window, then everything but
// `window`/`window.parent`/null. Both allowlists dropped EVERY real host message
// (VS Code's sender is none of those; see the real-host probe in
// src/test/suite/realhost-webview-csp.test.ts), so the packages, sessions, and
// system-prompt panels rendered their empty states while the host was answering
// correctly. There must be no sender check — only envelope and payload
// validation — and these tests pin exactly that.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports;
// Node's native type stripping handles the .ts module itself.
const { parseHostMessage } = await import("../../webview/messages.ts");

/** Build a `message` event with an explicit sender, as real dispatchers do. */
function from(source, data) {
	return new domWindow.MessageEvent("message", { data, source });
}

suite("parseHostMessage envelope and payload guard", () => {
	test("accepts host messages regardless of the sending frame", () => {
		// Real VS Code posts from a window that is neither this one nor its
		// parent, so a sender allowlist blanks the UI. Only the envelope counts.
		for (const source of [hostMessageSource, domWindow, null, { name: "unrelated-frame" }]) {
			const msg = parseHostMessage(
				from(source, { type: "installed", data: { installed: [] } }),
			);
			assert.ok(msg, `a well-formed envelope must be accepted (sender: ${source})`);
			assert.strictEqual(msg.type, "installed");
		}
	});

	test("passes array payloads through instead of collapsing them", () => {
		const msg = parseHostMessage(
			from(hostMessageSource, { type: "sessions-list", data: [{ id: "s1" }] }),
		);
		assert.ok(Array.isArray(msg?.data), "bare-array payloads must survive the guard");
	});

	test("normalizes primitive payloads to an empty record", () => {
		assert.deepStrictEqual(
			parseHostMessage(from(hostMessageSource, { type: "output", data: "chatter" }))?.data,
			{},
		);
	});

	test("rejects malformed envelopes", () => {
		assert.strictEqual(parseHostMessage(from(hostMessageSource, "junk")), null);
		assert.strictEqual(parseHostMessage(from(hostMessageSource, { data: {} })), null);
		assert.strictEqual(parseHostMessage(from(hostMessageSource, null)), null);
	});
});
