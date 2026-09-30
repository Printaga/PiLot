// Focused tests for the shared host-message guard (src/webview/messages.ts).
//
// Regression target: the guard used to reject any event whose `source` was not
// the webview's own window. VS Code's host page forwards every host message
// into the content iframe with `contentWindow.postMessage(...)`, so real
// messages carry `source === window.parent` and were ALL dropped — the
// packages, sessions, and system-prompt panels kept rendering their empty
// states while the host was answering correctly. These tests pin the senders
// that must be accepted, the one that must be rejected, and the payload
// normalization every consumer relies on.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";
// Svelte loader hooks are registered by the runner before this spec imports;
// Node's native type stripping handles the .ts module itself.
const { parseHostMessage } = await import("../../webview/messages.ts");

/** Build a `message` event with an explicit sender, as real dispatchers do. */
function from(source, data) {
	return new domWindow.MessageEvent("message", { data, source });
}

const FOREIGN_FRAME = { name: "unrelated-frame" };

suite("parseHostMessage sender and payload guard", () => {
	test("accepts host messages forwarded by the parent frame", () => {
		// Real VS Code: the sender is the webview host page, NOT this window.
		const msg = parseHostMessage(
			from(hostMessageSource, { type: "installed", data: { installed: [] } }),
		);
		assert.ok(msg, "a parent-frame message must be accepted");
		assert.strictEqual(msg.type, "installed");
	});

	test("accepts same-window and in-process dispatches", () => {
		assert.ok(parseHostMessage(from(domWindow, { type: "ready", data: {} })));
		assert.ok(parseHostMessage(from(null, { type: "ready", data: {} })));
	});

	test("rejects messages from an unrelated frame", () => {
		assert.strictEqual(
			parseHostMessage(from(FOREIGN_FRAME, { type: "installed", data: { installed: [] } })),
			null,
			"a sibling/opener frame is not a trusted sender",
		);
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
