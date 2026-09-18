// ── Commit-message drafting ─────────────────────────────────────────────────
//
// Gathers staged repository content, hands it to the PI CLI in print mode, and
// returns the drafted message. Nothing here writes to git: no add, commit,
// amend, push, or staging is performed, so the working tree and history are
// untouched.
//
// Safety invariant: the seam runs with `shell: true`, and Node concatenates argv
// into the shell command line without escaping it. So every argument that is not a
// bare flag is rendered with `quoteShellArg()` first, which makes it one literal
// argument. Repository-derived bytes never need that treatment because they travel
// to the child on stdin instead, where no shell parses them. `--model` is the one
// argument that carries a setting, and settings can be supplied by a repository's
// `.vscode/settings.json`, so it is refused outright when it cannot be quoted for
// the current platform.

import * as fsSync from "node:fs";
import * as path from "node:path";
import {
	execFileAsync,
	execFileWithStdin,
	quoteShellArg,
	type CommandResult,
	type ShellExecOptions,
} from "./utils/shell.js";

/** Character budget for the patch body. The `--stat` summary is never truncated. */
export const MAX_DIFF_CHARS = 40_000;

/** Timeout for the read-only git plumbing commands. */
const GIT_TIMEOUT_MS = 15_000;

/** Timeout for the model call; a draft can take considerably longer than git. */
const DRAFT_TIMEOUT_MS = 60_000;

/**
 * Fixed instruction passed as the CLI prompt. Contains no repository content by
 * design, so it can never be reinterpreted by the shell.
 */
export const COMMIT_MESSAGE_PROMPT = [
	"Write one git commit message for the changes described below.",
	"Use Conventional Commits style (type: summary), imperative mood, and keep the",
	"subject line under 72 characters. Add a short body only when it helps.",
	"Reply with the commit message only: no explanation, no code fences, no quotes.",
	"The patch may be truncated; the complete --stat summary above it is authoritative.",
].join(" ");

/** Fixed literal argument set for `pi` print mode. */
export const PI_PRINT_ARGS = ["-p", "--no-session", "-nc", "-nt"] as const;

/** Longest acceptable `provider/id` value; far above any real identifier. */
const MAX_MODEL_ID_LENGTH = 200;

/**
 * Whether `value` can be handed to the drafting process as a `--model` argument.
 *
 * The empty string is valid and means "use the standard PI model". Anything else
 * must be quotable for the current platform: the seam concatenates argv into a
 * `shell: true` command line, so a value that cannot be made literal there could
 * be reinterpreted as shell syntax. The shape of a model identifier is left to the
 * CLI, which reports an unknown model rather than falling back silently.
 */
export function canPassModelArg(value: string, platform: string = process.platform): boolean {
	if (value === "") return true;
	if (value.length > MAX_MODEL_ID_LENGTH) return false;
	return quoteShellArg(value, platform) !== null;
}

/** Matches the timeout-shaped stderr produced by the shell helpers. */
const TIMEOUT_STDERR = /^Command timed out after \d+ms:/;

export type CommitMessageOutcome =
	| {
			status: "message";
			message: string;
			untrackedCount: number;
			truncated: boolean;
	  }
	| { status: "nothing-to-commit"; untrackedCount: number }
	| { status: "timeout"; message: string }
	| { status: "error"; message: string };

export interface DraftCommitMessageInput {
	/** Session working directory; the repository is resolved by walking upwards. */
	cwd: string;
	/** Resolved PI binary. */
	binaryPath: string;
	/** `provider/id` override, or an empty string for the standard PI model. */
	model: string;
}

/**
 * Mutable holder for process execution and filesystem probes. ESM module
 * namespaces are frozen, so tests stub these instead of patching the module.
 * The wrappers delegate to the public helpers on each call, so stubbing either
 * layer stays live.
 */
export const gitCommitMessageInternals = {
	execFileAsync: (
		command: string,
		args: string[],
		timeoutMs?: number,
		options?: ShellExecOptions,
	): Promise<CommandResult> => execFileAsync(command, args, timeoutMs, options),
	execFileWithStdin: (
		command: string,
		args: string[],
		stdin: string,
		timeoutMs?: number,
		options?: ShellExecOptions,
	): Promise<CommandResult> => execFileWithStdin(command, args, stdin, timeoutMs, options),
	existsSync: (target: string): boolean => fsSync.existsSync(target),
};

/**
 * Walk upwards from `cwd` until a `.git` entry (directory or `gitdir:` file) is
 * found, mirroring `BinaryService.resolveGitBranch()`'s detection semantics.
 */
export function findRepositoryRoot(cwd: string): string | null {
	try {
		let dir = path.resolve(cwd);
		while (true) {
			if (gitCommitMessageInternals.existsSync(path.join(dir, ".git"))) {
				return dir;
			}
			const parent = path.dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	} catch {
		return null;
	}
}

/** Count `??` entries in `git status --porcelain` output. */
export function countUntracked(statusOutput: string): number {
	return statusOutput.split("\n").filter((line) => line.startsWith("??")).length;
}

/** Truncate a patch to `budget` characters, reporting whether it was cut. */
export function truncatePatch(
	patch: string,
	budget = MAX_DIFF_CHARS,
): { patch: string; truncated: boolean } {
	if (patch.length <= budget) return { patch, truncated: false };
	return { patch: patch.slice(0, budget), truncated: true };
}

/**
 * Normalize raw model stdout into commit-message text: strip surrounding
 * whitespace and unwrap a fence that encloses the entire reply.
 */
export function normalizeCommitMessage(raw: string): string {
	let text = raw.trim();
	const fenced = /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text);
	if (fenced) text = fenced[1].trim();
	return text;
}

/** Assemble the stdin payload: full stat summary, then the (possibly cut) patch. */
export function buildDiffInput(
	stat: string,
	patch: string,
	truncated: boolean,
	untrackedCount: number,
): string {
	const parts = [stat.trim(), "", "--- patch ---", patch];
	if (truncated) {
		parts.push("", `--- patch truncated at ${MAX_DIFF_CHARS} characters ---`);
	}
	if (untrackedCount > 0) {
		parts.push("", `note: ${untrackedCount} untracked file(s) are not included in the patch`);
	}
	return parts.join("\n");
}

function runGit(cwd: string, args: string[]): Promise<CommandResult> {
	return gitCommitMessageInternals.execFileAsync("git", args, GIT_TIMEOUT_MS, {
		cwd,
	});
}

/**
 * Draft a commit message for the repository containing `cwd`.
 *
 * Never stages, commits, or otherwise mutates the repository, and makes no model
 * request when there is nothing to describe.
 */
/**
 * Fetches the patch the message should describe.
 *
 * The staged patch is preferred; the worktree diff is the fallback, so an
 * unstaged-but-dirty tree still produces a draft. Untracked content alone cannot
 * be described without staging it, which this feature deliberately never does.
 */
async function collectDiff(
	root: string,
): Promise<
	| { status: "ok"; stat: string; patch: string }
	| { status: "nothing-to-commit" }
	| { status: "error"; message: string }
> {
	let stat = await runGit(root, ["diff", "--staged", "--stat"]);
	let patch = await runGit(root, ["diff", "--staged"]);
	if (patch.stdout.trim() === "") {
		stat = await runGit(root, ["diff", "HEAD", "--stat"]);
		patch = await runGit(root, ["diff", "HEAD"]);
	}
	if (patch.code !== 0) {
		return { status: "error", message: patch.stderr.trim() || "git diff failed." };
	}
	if (patch.stdout.trim() === "") {
		return { status: "nothing-to-commit" };
	}
	return { status: "ok", stat: stat.stdout, patch: patch.stdout };
}

export async function draftCommitMessage(
	input: DraftCommitMessageInput,
): Promise<CommitMessageOutcome> {
	const root = findRepositoryRoot(input.cwd);
	if (!root) {
		return {
			status: "error",
			message: "No git repository found for the current workspace.",
		};
	}

	const status = await runGit(root, ["status", "--porcelain"]);
	if (status.code !== 0) {
		return {
			status: "error",
			message: status.stderr.trim() || "git status failed.",
		};
	}
	if (status.stdout.trim() === "") {
		return { status: "nothing-to-commit", untrackedCount: 0 };
	}

	const untrackedCount = countUntracked(status.stdout);

	const diff = await collectDiff(root);
	if (diff.status === "error") {
		return { status: "error", message: diff.message };
	}
	if (diff.status === "nothing-to-commit") {
		return { status: "nothing-to-commit", untrackedCount };
	}

	const { patch: sendablePatch, truncated } = truncatePatch(diff.patch);
	const stdin = buildDiffInput(diff.stat, sendablePatch, truncated, untrackedCount);

	// The model override is the only argument that carries a setting. The setting
	// can be supplied by a repository's `.vscode/settings.json`, so it is refused
	// when it cannot be made a literal argument for this platform. Model ids that
	// contain spaces are legitimate (the CLI reports them), which is why the check
	// is quotability rather than a character allowlist.
	let modelArgs: string[] = [];
	if (input.model) {
		const quotedModel = quoteShellArg(input.model);
		if (quotedModel === null || !canPassModelArg(input.model)) {
			return {
				status: "error",
				message:
					`The configured commit-message model ${JSON.stringify(input.model)} cannot be passed ` +
					"safely on this platform, so it was not used. Fix `pi-agent.git.commitMessageModel` in Settings.",
			};
		}
		modelArgs = ["--model", quotedModel];
	}

	// The prompt is a fixed literal but contains spaces and parentheses, so it is
	// quoted too: unquoted, the shell word-splits it and `(` is a syntax error.
	const args = [
		...PI_PRINT_ARGS,
		...modelArgs,
		quoteShellArg(COMMIT_MESSAGE_PROMPT) ?? COMMIT_MESSAGE_PROMPT,
	];
	const result = await gitCommitMessageInternals.execFileWithStdin(
		input.binaryPath,
		args,
		stdin,
		DRAFT_TIMEOUT_MS,
		{ cwd: root },
	);

	if (TIMEOUT_STDERR.test(result.stderr)) {
		return { status: "timeout", message: result.stderr.trim() };
	}
	if (result.code !== 0) {
		return {
			status: "error",
			message:
				result.stderr.trim() ||
				result.stdout.trim() ||
				`The model call exited with code ${result.code}.`,
		};
	}

	const message = normalizeCommitMessage(result.stdout);
	if (!message) {
		return {
			status: "error",
			message: "The model returned an empty commit message.",
		};
	}

	return { status: "message", message, untrackedCount, truncated };
}
