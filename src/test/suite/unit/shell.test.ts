// ── Unit tests for shell utilities ──────────────────────────────────────────

import * as assert from "assert";
import {
	stripAnsi,
	shellQuote,
	getShellCommand,
	execFileWithStdin,
	shellInternals,
	type ShellChildProcess,
} from "../../../utils/shell.js";

interface FakeChild {
	child: ShellChildProcess;
	stdinWrites: (string | undefined)[];
	killCount: () => number;
	succeed: (stdout?: string, stderr?: string) => void;
	fail: (code: number, stderr?: string) => void;
}

/** Build a fake child plus a matching `shellInternals.execFile` stub. */
function stubExecFile(): FakeChild & { args: string[][]; commands: string[] } {
	const stdinWrites: (string | undefined)[] = [];
	const commands: string[] = [];
	const args: string[][] = [];
	const closeListeners: Array<(...eventArgs: unknown[]) => void> = [];
	let kills = 0;
	let callback: ((error: unknown, stdout: string, stderr: string) => void) | undefined;

	const child: ShellChildProcess = {
		stdin: { end: (data?: string) => stdinWrites.push(data) },
		kill: () => {
			kills += 1;
		},
		on: (event: string, listener: (...eventArgs: unknown[]) => void) => {
			if (event === "close") closeListeners.push(listener);
			return child;
		},
	};

	shellInternals.execFile = (
		command: string,
		commandArgs: string[],
		_options: { shell: boolean },
		cb: (error: unknown, stdout: string, stderr: string) => void,
	) => {
		commands.push(command);
		args.push(commandArgs);
		callback = cb;
		return child;
	};

	return {
		child,
		stdinWrites,
		commands,
		args,
		killCount: () => kills,
		succeed: (stdout = "", stderr = "") => {
			callback?.(null, stdout, stderr);
			for (const listener of closeListeners) listener();
		},
		fail: (code: number, stderr = "") => {
			callback?.({ code }, "", stderr);
			for (const listener of closeListeners) listener();
		},
	};
}

suite("Shell Utilities", () => {
	suite("stripAnsi", () => {
		test("returns plain text unchanged", () => {
			assert.strictEqual(stripAnsi("hello world"), "hello world");
		});

		test("removes ANSI color codes", () => {
			assert.strictEqual(stripAnsi("\x1b[31mred\x1b[0m"), "red");
		});

		test("removes ANSI cursor movement codes", () => {
			assert.strictEqual(stripAnsi("\x1b[2Jcleared"), "cleared");
		});

		test("handles empty string", () => {
			assert.strictEqual(stripAnsi(""), "");
		});

		test("handles text with no ANSI codes", () => {
			const longText = "The quick brown fox jumps over the lazy dog.";
			assert.strictEqual(stripAnsi(longText), longText);
		});
	});

	suite("shellQuote", () => {
		test("wraps simple string in single quotes", () => {
			assert.strictEqual(shellQuote("hello"), "'hello'");
		});

		test("escapes single quotes within the string", () => {
			const result = shellQuote("it's");
			assert.ok(result.includes("'\\''"), "should escape single quote");
		});

		test("handles empty string", () => {
			assert.strictEqual(shellQuote(""), "''");
		});

		test("handles strings with spaces", () => {
			const result = shellQuote("hello world");
			assert.strictEqual(result, "'hello world'");
		});
	});

	suite("getShellCommand", () => {
		test("returns null on Windows (simulated)", () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			try {
				const result = getShellCommand("/usr/bin/pi", ["list"]);
				assert.strictEqual(result, null);
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform });
			}
		});

		test("returns shell command object on non-Windows", () => {
			if (process.platform === "win32") {
				// Skip on actual Windows
				return;
			}
			const result = getShellCommand("/usr/bin/pi", ["list"]);
			assert.ok(result !== null, "should return a command object");
			assert.ok(
				result!.command.includes("bash") || result!.command.includes("sh"),
				"should use a shell",
			);
			assert.ok(result!.args.includes("-lc"), "should use login shell");
		});
	});

	suite("execFileWithStdin", () => {
		let originalExecFile: typeof shellInternals.execFile;

		setup(() => {
			originalExecFile = shellInternals.execFile;
		});

		teardown(() => {
			shellInternals.execFile = originalExecFile;
		});

		test("writes content to the child's stdin and resolves with its output", async () => {
			const fake = stubExecFile();
			const promise = execFileWithStdin("git", ["diff", "--staged"], "PAYLOAD");
			fake.succeed("COMMIT MESSAGE\n");
			const result = await promise;

			assert.deepStrictEqual(fake.stdinWrites, ["PAYLOAD"]);
			assert.strictEqual(result.code, 0);
			assert.strictEqual(result.stdout, "COMMIT MESSAGE\n");
		});

		test("delivers shell metacharacters unmodified instead of executing them", async () => {
			const fake = stubExecFile();
			const payload =
				"diff --git a/x b/x\n+KEY=$(touch /tmp/PWNED)\n+quote: it's here\n`whoami`\n";
			const promise = execFileWithStdin("cat", [], payload);
			fake.succeed(payload);
			await promise;

			assert.strictEqual(fake.stdinWrites[0], payload, "stdin must be byte-preserved");
			// The argv side must stay free of repository content.
			assert.deepStrictEqual(fake.args, [[]]);
			assert.deepStrictEqual(fake.commands, ["cat"]);
		});

		test("passes arguments as literals without shell rewriting", async () => {
			const fake = stubExecFile();
			const promise = execFileWithStdin("pi", ["-p", "--no-session", "prompt text"], "");
			fake.succeed();
			await promise;

			assert.deepStrictEqual(fake.args[0], ["-p", "--no-session", "prompt text"]);
		});

		test("resolves with a timeout result and kills a child that outlives the timeout", async () => {
			const fake = stubExecFile();
			const result = await execFileWithStdin("pi", ["-p"], "", 20);

			assert.strictEqual(fake.killCount(), 1, "the timed-out child must be killed");
			assert.strictEqual(result.code, 1);
			assert.ok(
				result.stderr.includes("timed out"),
				`expected a timeout-shaped error, got: ${result.stderr}`,
			);
		});

		test("reports a non-zero exit with its stderr", async () => {
			const fake = stubExecFile();
			const promise = execFileWithStdin("pi", ["-p"], "");
			fake.fail(1, "unknown model: nope/nope");
			const result = await promise;

			assert.strictEqual(result.code, 1);
			assert.strictEqual(result.stderr, "unknown model: nope/nope");
		});
	});
});
