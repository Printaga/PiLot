import * as assert from "assert";
import {
	MINIMUM_NODE_VERSION,
	isNodeVersionSupported,
	nodeVersionErrorMessage,
} from "../../../runtime-guard.js";

suite("runtime-guard", () => {
	test("accepts the exact minimum and newer versions", () => {
		assert.strictEqual(isNodeVersionSupported(MINIMUM_NODE_VERSION), true);
		assert.strictEqual(isNodeVersionSupported("22.19.1"), true);
		assert.strictEqual(isNodeVersionSupported("22.20.0"), true);
		assert.strictEqual(isNodeVersionSupported("23.0.0"), true);
		assert.strictEqual(isNodeVersionSupported("24.21.0"), true);
		assert.strictEqual(isNodeVersionSupported("v24.21.0"), true);
	});

	test("rejects versions below the floor", () => {
		assert.strictEqual(isNodeVersionSupported("18.15.0"), false);
		assert.strictEqual(isNodeVersionSupported("22.18.0"), false);
		assert.strictEqual(isNodeVersionSupported("22.18.99"), false);
		assert.strictEqual(isNodeVersionSupported("21.99.99"), false);
	});

	test("rejects unparseable versions", () => {
		assert.strictEqual(isNodeVersionSupported(""), false);
		assert.strictEqual(isNodeVersionSupported("not-a-version"), false);
		assert.strictEqual(isNodeVersionSupported("22"), false);
	});

	test("error message names both versions", () => {
		const message = nodeVersionErrorMessage("18.15.0");
		assert.ok(message.includes("18.15.0"));
		assert.ok(message.includes(MINIMUM_NODE_VERSION));
		assert.ok(message.includes("1.105"));
	});
});
