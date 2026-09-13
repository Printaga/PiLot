import * as assert from "assert";
import {
	displaySessionLabel,
	extractTextFromMessage,
	generateSessionName,
	isAutoContextDerivedName,
	stripAutoContextPreamble,
} from "../../../session-manager.js";

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

	test("generateSessionName strips the auto-context preamble", () => {
		const polluted =
			"Project Root: /home/lenovo/Development/PiLot\n" +
			"Project Name: pilots-studio\n" +
			"Project Version: 2.5.0\n\n" +
			"When starting a new chat, name the session properly";
		const name = generateSessionName(polluted, "");

		assert.strictEqual(name, "When starting a new chat, name the session properly");
	});

	test("stripAutoContextPreamble leaves plain messages untouched", () => {
		assert.strictEqual(stripAutoContextPreamble("fix the login bug"), "fix the login bug");
	});

	test("isAutoContextDerivedName detects preamble junk", () => {
		assert.strictEqual(isAutoContextDerivedName("Project Root: /home/lenovo"), true);
		assert.strictEqual(isAutoContextDerivedName("Fix the login bug"), false);
		assert.strictEqual(isAutoContextDerivedName(undefined), false);
	});

	test("displaySessionLabel falls back when name is preamble junk", () => {
		assert.strictEqual(
			displaySessionLabel(
				"Project Root: /home/lenovo/Development/PiLot",
				"Project Root: /home/lenovo/Development/PiLot\nProject Name: x\n\nfix login",
			),
			"fix login",
		);
		assert.strictEqual(displaySessionLabel("Real name", "whatever"), "Real name");
	});
});
