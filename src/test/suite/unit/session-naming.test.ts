import * as assert from "assert";
import {
	extractTextFromMessage,
	generateSessionName,
} from "../../../pi-agent-provider.js";

suite("Session naming helpers", () => {
	test("extractTextFromMessage joins text blocks", () => {
		const text = extractTextFromMessage({
			role: "assistant",
			content: [
				{ type: "text", text: "Debug " },
				{ type: "image" },
				{ type: "text", text: "session titles" },
			],
		});

		assert.strictEqual(text, "Debug  session titles");
	});

	test("generateSessionName prefers the assistant summary", () => {
		const name = generateSessionName(
			"Can you fix the login redirect bug?",
			"I'll fix the login redirect bug.",
		);

		assert.strictEqual(name, "Fix the login redirect bug");
	});

	test("generateSessionName strips markdown and helper prefixes", () => {
		const name = generateSessionName(
			"Help me debug session naming.",
			"# Plan\n\nHere's how to debug session naming in the provider.",
		);

		assert.strictEqual(name, "How to debug session naming in the provider");
	});

	test("generateSessionName falls back to the user message", () => {
		const name = generateSessionName("debug session naming bug", "");

		assert.strictEqual(name, "Debug session naming bug");
	});
});
