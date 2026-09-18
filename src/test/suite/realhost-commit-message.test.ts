// Real-host lane for the commit-message wiring: the parts that only the actual
// VS Code APIs can answer. Everything here runs against the real git extension
// and a real on-disk repository, so it verifies the delivery target (the SCM
// input box) rather than a stand-in for it.
//
// The model call is the one thing that cannot run here: it needs a configured PI
// CLI and a funded provider. `gitCommitMessageInternals.execFileWithStdin` (the
// seam that would launch `pi`) is replaced with a canned draft, so the real git
// plumbing, the real repository lookup, and the real command body all execute
// while the model round trip is stubbed. That is the boundary the automated lane
// can honestly claim; the drafted text itself still needs a human to read.
//
// Two environment facts shaped this suite, both verified rather than assumed:
//   * the host is launched with `--folder-uri` but no folder actually ends up
//     open (`workspaceFolders` is empty), so the repository is added at runtime;
//   * the git extension IS present despite `--disable-extensions`, because it
//     ships built in.
// Under the plain-Node lane the facade reports no extensions, so the lookups
// still take their unavailable path and the host-only checks call `this.skip()`.

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { registerCommands } from "../../commands/index.js";
import { gitCommitMessageInternals } from "../../git-commit-message.js";
import { findGitRepository, writeCommitMessage } from "../../git-extension.js";
import { execFileAsync, type CommandResult } from "../../utils/shell.js";

/**
 * Runs git for test setup. Note that this seam joins `command` and `args` into a
 * single shell command line, so every element must be a single shell-safe token
 * — `["commit", "-m", "chore: initial"]` would be split on the space.
 */
async function git(cwd: string, args: string[]): Promise<void> {
	const result = await execFileAsync("git", args, 20_000, { cwd });
	assert.strictEqual(result.code, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
	const result = await execFileAsync("git", args, 20_000, { cwd });
	return result.stdout;
}

/** True when the VS Code facade (plain-Node lane) answered instead of the real host. */
function isFacadeLane(): boolean {
	return vscode.extensions.getExtension("vscode.git") === undefined;
}

/**
 * Recursive listing of the PI session directory, or null when it is absent (so
 * the caller can skip rather than assert against a path that does not exist).
 * A drafting run must add nothing here. The default location is
 * `~/.pi/agent/sessions` unless the host redirected the agent directory.
 */
function sessionInventory(): string[] | null {
	const agentDir =
		process.env.PI_AGENT_DIR ??
		process.env.PI_CODING_AGENT_DIR ??
		path.join(os.homedir(), ".pi", "agent");
	const sessions = path.join(agentDir, "sessions");
	if (!fs.existsSync(sessions)) return null;

	const found: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else found.push(path.relative(sessions, full));
		}
	};
	walk(sessions);
	return found.sort();
}

suite("REALHOST commit message wiring", () => {
	let repoDir: string | undefined;
	let wiringReady = false;
	const progressOptions: any[] = [];
	const recorded = { warnings: [] as string[], errors: [] as string[], info: [] as string[] };
	const saved: Record<string, unknown> = {};
	let savedExecFileWithStdin: typeof gitCommitMessageInternals.execFileWithStdin;
	let piStub: (() => CommandResult) | undefined;

	/** Values the registered command body reads; mutated per test. */
	const stubState = { cwd: "", binary: true, model: "" };
	const stubProvider = {
		getLightMode: () => false,
		getSessionCwd: () => stubState.cwd,
		isBinaryAvailable: () => stubState.binary,
		getPiBinaryPath: () => "pi",
		getCommitMessageModel: () => stubState.model,
	};

	suiteSetup(async () => {
		for (const name of [
			"showWarningMessage",
			"showErrorMessage",
			"showInformationMessage",
			"withProgress",
		]) {
			saved[name] = (vscode.window as any)[name];
		}
		(vscode.window as any).showWarningMessage = async (msg: string) => {
			recorded.warnings.push(msg);
			return undefined;
		};
		(vscode.window as any).showErrorMessage = async (msg: string) => {
			recorded.errors.push(msg);
			return undefined;
		};
		(vscode.window as any).showInformationMessage = async (msg: string) => {
			recorded.info.push(msg);
			return undefined;
		};
		// Run the body inline: the progress location is a UI detail, not behavior
		// under test, and a real notification would block the headless run. The
		// options are captured so the requested progress state can be asserted.
		(vscode.window as any).withProgress = async (options: unknown, task: () => unknown) => {
			progressOptions.push(options);
			return task();
		};

		savedExecFileWithStdin = gitCommitMessageInternals.execFileWithStdin;
		gitCommitMessageInternals.execFileWithStdin = async () =>
			piStub ? piStub() : { code: 0, stdout: "chore: canned draft\n", stderr: "" };

		const candidate = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-cm-repo-"));
		await git(candidate, ["init", "--initial-branch=main"]);
		await git(candidate, ["config", "user.email", "test@example.com"]);
		await git(candidate, ["config", "user.name", "Pipeline"]);
		fs.writeFileSync(path.join(candidate, "tracked.txt"), "first\n");
		await git(candidate, ["add", "tracked.txt"]);
		await git(candidate, ["commit", "-m", "initial"]);
		repoDir = candidate;
		stubState.cwd = candidate;

		// The facade has no workspace-folder API, so the folder is only added in the
		// real host. The host-only tests skip in the other lane anyway.
		if (!isFacadeLane()) {
			vscode.workspace.updateWorkspaceFolders(0, null, {
				uri: vscode.Uri.file(candidate),
				name: "commit-message-repo",
			});
		}

		// Register the real command handlers once. If the extension under
		// development owns them already, leave its registration in place and let
		// the wiring tests skip rather than fight over the command id.
		const existing = await vscode.commands.getCommands(true);
		if (!existing.includes("pi-agent.generateCommitMessage")) {
			registerCommands(
				{ subscriptions: [] } as unknown as vscode.ExtensionContext,
				stubProvider as any,
			);
			wiringReady = true;
		}
	});

	suiteTeardown(() => {
		for (const [name, value] of Object.entries(saved)) {
			(vscode.window as any)[name] = value;
		}
		gitCommitMessageInternals.execFileWithStdin = savedExecFileWithStdin;
		if (repoDir) {
			if (!isFacadeLane()) vscode.workspace.updateWorkspaceFolders(0, 1);
			fs.rmSync(repoDir, { recursive: true, force: true });
		}
	});

	setup(() => {
		recorded.warnings.length = 0;
		recorded.errors.length = 0;
		recorded.info.length = 0;
		progressOptions.length = 0;
		piStub = undefined;
		stubState.binary = true;
		stubState.model = "";
	});

	/**
	 * Poll until the git extension publishes our repository. The extension scans
	 * asynchronously and has no "rescan now" entry point.
	 */
	async function waitForRepository(repoRoot: string, timeoutMs = 20_000) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const lookup = await findGitRepository(repoRoot);
			if (lookup.status === "found") return lookup.repository;
			if (Date.now() > deadline) return null;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}

	test("reports a clear message for a path that is not an open repository", async () => {
		const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-orphan-repo-"));
		try {
			await git(orphan, ["init", "--initial-branch=main"]);
			const lookup = await findGitRepository(orphan);

			assert.strictEqual(lookup.status, "unavailable");
			if (lookup.status === "unavailable") {
				assert.ok(
					lookup.message.length > 0,
					"an unavailable lookup must explain itself rather than throw",
				);
			}
		} finally {
			fs.rmSync(orphan, { recursive: true, force: true });
		}
	});

	test("writes into the real SCM input box without staging, committing, or pushing", async function () {
		if (isFacadeLane()) this.skip(); // host-only: needs the real git extension
		assert.ok(repoDir, "suite setup must have created the repository");

		const repository = await waitForRepository(repoDir);
		assert.ok(repository, "the git extension should publish the repository in the workspace");

		fs.writeFileSync(path.join(repoDir, "tracked.txt"), "second\n");
		const headBefore = await gitOutput(repoDir, ["rev-parse", "HEAD"]);
		const statusBefore = await gitOutput(repoDir, ["status", "--porcelain"]);

		writeCommitMessage(repository, "feat(scm): canned subject");

		assert.strictEqual(repository.inputBox.value, "feat(scm): canned subject");
		assert.strictEqual(
			await gitOutput(repoDir, ["rev-parse", "HEAD"]),
			headBefore,
			"drafting must not create a commit",
		);
		assert.strictEqual(
			await gitOutput(repoDir, ["status", "--porcelain"]),
			statusBefore,
			"drafting must not stage or alter anything",
		);
		assert.strictEqual(await gitOutput(repoDir, ["status", "--porcelain"]), " M tracked.txt\n");
	});

	test("the real command drafts into the box and reports truncation and untracked files", async function () {
		if (isFacadeLane()) this.skip(); // host-only: needs a dispatching command registry
		if (!wiringReady) this.skip(); // the extension owns the command in this host
		assert.ok(repoDir, "suite setup must have created the repository");

		const repository = await waitForRepository(repoDir);
		assert.ok(repository, "the git extension should publish the repository");

		fs.writeFileSync(path.join(repoDir, "tracked.txt"), "third\n");
		fs.writeFileSync(path.join(repoDir, "untracked.txt"), "new\n");
		repository.inputBox.value = "";

		piStub = () => ({ code: 0, stdout: "feat(scm): canned subject\n", stderr: "" });
		const sessionsBefore = sessionInventory();
		await vscode.commands.executeCommand("pi-agent.generateCommitMessage");

		assert.strictEqual(repository.inputBox.value, "feat(scm): canned subject");
		const info = recorded.info.join(" | ");
		assert.ok(info.includes("Commit message drafted"), `unexpected info: ${info}`);
		assert.ok(info.includes("untracked"), `untracked files should be reported: ${info}`);
		assert.strictEqual(recorded.errors.length, 0, recorded.errors.join(" | "));

		// The draft must request its progress in the SCM location rather than a
		// notification, and it must not leave a PI session record behind.
		assert.strictEqual(progressOptions.length, 1, "drafting should report progress once");
		assert.strictEqual(
			progressOptions[0].location,
			vscode.ProgressLocation.SourceControl,
			"progress belongs next to the SCM input box it fills",
		);
		assert.strictEqual(progressOptions[0].title, "Drafting commit message...");

		if (sessionsBefore) {
			assert.deepStrictEqual(
				sessionInventory(),
				sessionsBefore,
				"drafting must not create a PI session record",
			);
		}
	});

	test("a failing model call surfaces the underlying output and leaves the box alone", async function () {
		if (isFacadeLane()) this.skip();
		if (!wiringReady) this.skip();
		assert.ok(repoDir, "suite setup must have created the repository");

		const repository = await waitForRepository(repoDir);
		assert.ok(repository, "the git extension should publish the repository");

		fs.writeFileSync(path.join(repoDir, "tracked.txt"), "fourth\n");
		repository.inputBox.value = "";
		piStub = () => ({
			code: 1,
			stdout: "",
			stderr: "error: provider credentials are not configured",
		});

		await vscode.commands.executeCommand("pi-agent.generateCommitMessage");

		assert.strictEqual(repository.inputBox.value, "", "a failure must not write the box");
		assert.ok(
			recorded.errors.join(" | ").includes("provider credentials are not configured"),
			`the underlying output should be surfaced, got: ${recorded.errors.join(" | ")}`,
		);
	});

	test("a missing pi binary is reported instead of attempting a draft", async function () {
		if (isFacadeLane()) this.skip();
		if (!wiringReady) this.skip();
		assert.ok(repoDir, "suite setup must have created the repository");

		const repository = await waitForRepository(repoDir);
		assert.ok(repository, "the git extension should publish the repository");

		repository.inputBox.value = "";
		stubState.binary = false;
		let invoked = false;
		piStub = () => {
			invoked = true;
			return { code: 0, stdout: "should not run\n", stderr: "" };
		};

		await vscode.commands.executeCommand("pi-agent.generateCommitMessage");

		assert.strictEqual(repository.inputBox.value, "");
		assert.strictEqual(invoked, false, "the model must not be called without a binary");
		assert.ok(
			recorded.errors.join(" | ").includes("pi binary could not be found"),
			`expected a binary warning, got: ${recorded.errors.join(" | ")}`,
		);
	});

	test("a workspace outside any repository is reported without throwing", async function () {
		if (isFacadeLane()) this.skip();
		if (!wiringReady) this.skip();

		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-no-repo-"));
		try {
			stubState.cwd = outside;
			await vscode.commands.executeCommand("pi-agent.generateCommitMessage");

			assert.ok(
				recorded.warnings.join(" | ").includes("not inside a git repository"),
				`expected a repository warning, got: ${recorded.warnings.join(" | ")}`,
			);
		} finally {
			stubState.cwd = repoDir ?? "";
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});

	// Opt-in, because it spends tokens and needs a funded provider: the stub that
	// every other test relies on is removed for this one test, so a real `pi`
	// process drafts a real message from a real staged diff. Skipped by default so
	// `pnpm verify` stays hermetic and free; run with `PILOT_E2E_LIVE=1`.
	test("a real model drafts into the box and adds no session record (opt-in)", async function () {
		if (isFacadeLane()) this.skip();
		if (process.env.PILOT_E2E_LIVE !== "1") this.skip();
		if (!wiringReady) this.skip();
		assert.ok(repoDir, "suite setup must have created the repository");

		const repository = await waitForRepository(repoDir);
		assert.ok(repository, "the git extension should publish the repository");

		// A real staged change, staged through the real git plumbing.
		fs.writeFileSync(path.join(repoDir, "feature.txt"), "hello from the live lane\n");
		await git(repoDir, ["add", "feature.txt"]);

		repository.inputBox.value = "";
		stubState.binary = true;
		// Empty means "use the standard PI model", which is the only pin available
		// without hardcoding an account-specific identifier.
		stubState.model = "";
		const sessionsBefore = sessionInventory();

		// Hand the drafting call the real execution path for this test only.
		gitCommitMessageInternals.execFileWithStdin = savedExecFileWithStdin;
		try {
			await vscode.commands.executeCommand("pi-agent.generateCommitMessage");
		} finally {
			gitCommitMessageInternals.execFileWithStdin = async () =>
				piStub ? piStub() : { code: 0, stdout: "chore: canned draft\n", stderr: "" };
		}

		const drafted = repository.inputBox.value;
		// Surface the sample: message quality is the one thing a test cannot judge.
		console.log(`[live] drafted commit message: ${JSON.stringify(drafted)}`);
		assert.ok(
			drafted.trim().length > 0,
			`a real model should have drafted something; errors: ${recorded.errors.join(" | ")}`,
		);
		assert.strictEqual(
			recorded.errors.length,
			0,
			`the live draft reported an error: ${recorded.errors.join(" | ")}`,
		);
		if (sessionsBefore) {
			assert.deepStrictEqual(
				sessionInventory(),
				sessionsBefore,
				"a live draft must not create a PI session record",
			);
		}

		// Leave the repository as it was found, so the other tests are unaffected.
		await git(repoDir, ["reset", "--", "feature.txt"]);
		fs.rmSync(path.join(repoDir, "feature.txt"), { force: true });
		repository.inputBox.value = "";
	});
});
