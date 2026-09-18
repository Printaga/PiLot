// Regression proof for the argv side of the commit-message draft call.
//
// `execFileWithStdin` runs children with `shell: true` (so a PI CLI installed as
// a shim still resolves). That option makes Node join the command and its
// arguments into a single shell command line without escaping them, so **every
// argv element is shell-interpreted**: `$(…)`, backticks, `;`, and `|` become live
// syntax, and a value containing spaces is word-split. Passing repository content
// on stdin is therefore necessary but not sufficient.
//
// The draft call passes two values that are not bare flags:
// `pi-agent.git.commitMessageModel` (which becomes `--model <value>`) and the
// instruction prompt, which contains spaces and parentheses. Workspace settings
// are repository-controlled (`.vscode/settings.json` travels with a clone), so an
// unquoted value is a remote-code-execution path that a hostile repository could
// trigger by getting the user to click the SCM button.
//
// The defense is `quoteShellArg()`: single quotes make every byte literal on a
// POSIX shell. These tests exercise the real implementation against real child
// processes, with no stubbing, so they fail loudly if quoting is ever dropped.

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { COMMIT_MESSAGE_PROMPT, canPassModelArg } from "../../../git-commit-message.js";
import { execFileWithStdin, quoteShellArg } from "../../../utils/shell.js";

function scratchDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pilot-argv-proof-"));
}

/** A real child that echoes the arguments it actually received. */
function echoArgvScript(dir: string): string {
	const script = path.join(dir, "argv-probe.cjs");
	fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
	return script;
}

suite("commit-message argv injection guard", () => {
	test("the underlying seam does shell-interpret argv (documents why quoting is required)", async () => {
		// Characterization, not a desired behavior: this asserts that the seam
		// really does interpret argv, which is the premise the quoting defends
		// against. If this ever stops being true the quoting is redundant rather
		// than wrong — but it must not be removed on the strength of it.
		const dir = scratchDir();
		const marker = path.join(dir, "SEAM_INTERPRETED_ARGS");
		const script = echoArgvScript(dir);

		const result = await execFileWithStdin(
			process.execPath,
			[script, "$(touch " + marker + ")"],
			"",
		);

		assert.ok(
			fs.existsSync(marker),
			"premise check: the seam is expected to shell-interpret argv, but it did not",
		);
		// The substitution ran, so the literal argument the caller passed never
		// reached the child: the shell consumed it and passed nothing at all.
		assert.deepStrictEqual(JSON.parse(result.stdout), []);
	});

	test("an unquoted value containing spaces is word-split (documents the real-model-id failure)", async () => {
		// Characterization: this is the bug that made an allowlist the wrong fix.
		// Model ids reported by the CLI contain spaces, and under `shell: true` an
		// unquoted one arrives as several arguments.
		const dir = scratchDir();
		const script = echoArgvScript(dir);
		const modelId = "Bitfrost/Kilo Code/aion-labs/aion-2.0";

		const result = await execFileWithStdin(process.execPath, [script, modelId], "");

		assert.notDeepStrictEqual(
			JSON.parse(result.stdout),
			[modelId],
			"premise check: an unquoted spaced value is expected to be word-split",
		);
	});

	test("a quoted hostile value reaches the child literally and executes nothing", async () => {
		const dir = scratchDir();
		const marker = path.join(dir, "QUOTED_VALUE_EXECUTED");
		const script = echoArgvScript(dir);
		const hostile = "x; touch " + marker;

		const quoted = quoteShellArg(hostile);
		assert.ok(quoted, "a POSIX shell can always quote a value");

		const result = await execFileWithStdin(process.execPath, [script, quoted], "");

		assert.ok(!fs.existsSync(marker), "a quoted value must not be executed as shell syntax");
		assert.deepStrictEqual(
			JSON.parse(result.stdout),
			[hostile],
			"the value must arrive as one argument, byte for byte",
		);
	});

	test("a quoted model id containing spaces arrives as exactly one argument", async () => {
		const dir = scratchDir();
		const script = echoArgvScript(dir);
		const modelId = "Bitfrost/Kilo Code/aion-labs/aion-2.0";

		const result = await execFileWithStdin(
			process.execPath,
			[script, quoteShellArg(modelId) as string],
			"",
		);

		assert.deepStrictEqual(
			JSON.parse(result.stdout),
			[modelId],
			"the spaced model id must survive as a single argument",
		);
	});

	test("the fixed prompt is quoted, so parentheses in it cannot break the command line", () => {
		// Unquoted, `(type: summary)` is a shell syntax error: the drafting call
		// died before the CLI started. The prompt therefore has to be quoted too,
		// not just the settings-derived value.
		assert.ok(COMMIT_MESSAGE_PROMPT.includes("("), "premise: the prompt contains parentheses");

		const quoted = quoteShellArg(COMMIT_MESSAGE_PROMPT);
		assert.ok(quoted);
		assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
		assert.ok(quoted.includes("(type: summary)"), "the quoted prompt carries the text intact");
	});

	test("quoteShellArg marks cmd.exe-special values as unpresentable on Windows", () => {
		// cmd.exe has no single-quote quoting, so values it would act on are
		// refused rather than escaped.
		for (const value of ['x"y', "x%PATH%y", "x^y", "x!y", "x\ny"]) {
			assert.strictEqual(
				quoteShellArg(value, "win32"),
				null,
				`cmd.exe cannot carry: ${JSON.stringify(value)}`,
			);
		}
		// A spaced value is fine on Windows once wrapped in double quotes.
		assert.strictEqual(quoteShellArg("Kilo Code/x", "win32"), '"Kilo Code/x"');
	});

	test("quoteShellArg always succeeds on a POSIX shell, whatever the value", () => {
		for (const value of [
			"anthropic/claude-sonnet-4-5",
			"Bitfrost/Kilo Code/aion-labs/aion-2.0",
			"x; touch /tmp/INJECTED",
			"anthropic/$(touch /tmp/INJECTED)",
			"anthropic/`touch /tmp/INJECTED`",
			'a "quoted" value',
			"a'tricky'value",
			"x\ty",
			"",
		]) {
			assert.notStrictEqual(
				quoteShellArg(value, "linux"),
				null,
				`a POSIX shell can carry: ${JSON.stringify(value)}`,
			);
		}
	});

	test("canPassModelArg accepts the empty default and real model ids, including spaced ones", () => {
		for (const value of [
			"",
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-haiku-4-5",
			"openai/gpt-5.1-codex",
			"google/gemini-2.5-pro",
			"google/gemini-2.5-flash+thinking",
			"local:llama-3.1-8b-instruct",
			"openrouter/meta-llama/llama-3.3-70b-instruct",
			"azure/gpt-4o@2024-08-06",
			"bedrock/anthropic.claude-v2:1",
			"x/y_z.0-9",
			// Reported by `pi --list-models` in this environment; an allowlist that
			// rejected these emptied the chooser and made pinning impossible.
			"Bitfrost/Kilo Code/aion-labs/aion-2.0",
			"Bitfrost/Kilo Code/~anthropic/claude-sonnet-latest",
		]) {
			assert.strictEqual(
				canPassModelArg(value, "linux"),
				true,
				`must accept a passable model id: ${JSON.stringify(value)}`,
			);
		}
	});

	test("canPassModelArg refuses oversized values and Windows-unquotable ones", () => {
		assert.strictEqual(canPassModelArg("a".repeat(201), "linux"), false);
		assert.strictEqual(canPassModelArg("a".repeat(200), "linux"), true);

		for (const value of ['x"y', "x%y", "x^y", "x!y"]) {
			assert.strictEqual(
				canPassModelArg(value, "win32"),
				false,
				`cmd.exe cannot carry: ${JSON.stringify(value)}`,
			);
			// The same value is safe where a real quoting mechanism exists.
			assert.strictEqual(canPassModelArg(value, "linux"), true);
		}
	});
});
