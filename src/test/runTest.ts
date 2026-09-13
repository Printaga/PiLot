import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { glob } from "glob";
import { pathToFileURL } from "node:url";
import { runTests } from "@vscode/test-electron";

function getVscodeExecutablePath(): string | undefined {
	const envPath = process.env.VSCODE_PATH;
	if (envPath) return envPath;
	// Distro `code` (/usr/bin/code) is a shell wrapper that re-forks the GUI via
	// cli.js; the test runner then loses process ownership and the run exits 0
	// without ever starting mocha. Prefer the real Electron binary.
	if (existsSync("/usr/share/code/code")) return "/usr/share/code/code";
	return existsSync("/usr/bin/code") ? "/usr/bin/code" : undefined;
}

// Host-injected electron vars would make the test host reuse the parent IDE's
// user-data or disable needed APIs; drop them.
const HOST_ELECTRON_ENV_VARS = [
	"VSCODE_DEV",
	"VSCODE_PID",
	"VSCODE_CWD",
	"VSCODE_NLS_CONFIG",
	"VSCODE_CODE_CACHE_PATH",
	"VSCODE_ESM_ENTRYPOINT",
	"VSCODE_RUN_IN_ELECTRON",
	"ICUBE_IS_ELECTRON",
];

function sanitizeElectronEnv(): void {
	for (const key of HOST_ELECTRON_ENV_VARS) {
		if (process.env[key] !== undefined) {
			delete process.env[key];
		}
	}
	// This build ships an Agent Host that downloads and recursively watches a
	// large Claude SDK cache. Under the container's low per-user inotify
	// instance limit (128) that exhausts inotify and crashes the host (exit 7).
	// Point its API at a dead endpoint so it never downloads/watches the cache;
	// the agent host is unrelated to the extension tests.
	process.env.VSCODE_AGENT_HOST_CAPI_URL_OVERRIDE = "http://127.0.0.1:9/";
	// Best-effort hardening, not a proven cure: this build's Agent Host
	// (AgentHostProcessManager) spawns Node children with their own watchers,
	// and exit-7 (Node "internal exception handler run-time failure") has hit
	// the extension host at random points with the env vars below both set and
	// unset. Kill the agent kinds anyway so they cannot contribute.
	process.env.VSCODE_AGENT_HOST_CLAUDE_AGENT_ENABLED = "false";
	process.env.VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED = "false";
}

/**
 * Report-authority rule for this IDE build.
 *
 * VS Code 1.137's extension host on this machine can abort with exit code 7
 * (Node: "internal exception handler run-time failure") after the mocha run
 * fully completed with zero failures. No JS stack survives, so the process
 * exit code cannot distinguish "a test failed" from "the host aborted
 * environmentally" in that case.
 *
 * The suite scaffold writes a results report when (and only when) the mocha
 * run completes: "PASS: n  FAIL: n". That report is the test truth:
 *   - fresh (mtime after this file's run started) AND "FAIL: 0" → all tests
 *     in the file passed; a host abort after that point is environmental,
 *     logged loudly, not a test failure.
 *   - anything else (missing, stale, FAIL: n>0) → the file failed.
 * Test failures still fail the gate; only the post-green abort is tolerated.
 */
function isGreenReport(reportPath: string, startedAt: Date): boolean {
	try {
		if (!existsSync(reportPath)) return false;
		if (statSync(reportPath).mtimeMs <= startedAt.getTime()) return false;
		const match = /^PASS: \d+\s+FAIL: (\d+)$/m.exec(readFileSync(reportPath, "utf8"));
		return match !== null && Number(match[1]) === 0;
	} catch {
		return false;
	}
}

/**
 * Run ONE test file in ONE fresh VS Code instance.
 *
 * Executing any suite that drives the real PI SDK leaves the host unable to
 * import further ESM test files without a risk of the exit-7 abort — the
 * crash always strikes at a file-load boundary AFTER real-SDK suites ran,
 * never while loading all files with zero executions. A fresh host per file
 * sidesteps that instability entirely: every file loads in a host that has
 * executed nothing yet.
 */
async function runOneFile(testFile: string, reportPath: string): Promise<void> {
	sanitizeElectronEnv();
	const extensionDevelopmentPath = path.resolve(import.meta.dirname, "../../");

	// Open a tiny, empty workspace instead of the project root. The project
	// (node_modules included) contains thousands of directories; VS Code's
	// recursive file watcher would create one inotify instance per directory
	// and exhaust the per-user inotify instance limit (often 128), causing
	// EMFILE and a host crash (exit 7) on Linux.
	const testWorkspace = path.join(os.tmpdir(), "pilot-test-workspace");
	mkdirSync(testWorkspace, { recursive: true });
	const folderUri = pathToFileURL(testWorkspace).toString();

	// Fresh, minimal user-data dir per file (stale storage accumulates watchers
	// and profile locks; a fresh dir also makes the plants below authoritative).
	const testUserDataDir = path.join(os.tmpdir(), "pilot-test-userdata");
	rmSync(testUserDataDir, { recursive: true, force: true });
	mkdirSync(testUserDataDir, { recursive: true });
	// VS Code 1.101+ polyfills globalThis.navigator in the Node extension host
	// with a getter that logs a PendingMigrationError deprecation and returns
	// undefined — so a dependency reading navigator.userAgent (the PI SDK's
	// jiti config loader does) dereferences undefined and dies. The build's own
	// opt-out: the main process passes --supportGlobalNavigator to the ext host
	// when the extensions.supportNodeGlobalNavigator setting is on, so the real
	// Node 22 navigator global is present. Plant it before the window spawns.
	mkdirSync(path.join(testUserDataDir, "User"), { recursive: true });
	writeFileSync(
		path.join(testUserDataDir, "User", "settings.json"),
		JSON.stringify(
			{
				"extensions.supportNodeGlobalNavigator": true,
				// Hardening, not a proven cure: disable this build's Agent Host
				// kinds at the settings layer too — the env-var overrides alone
				// did not stop the spawn (AgentHostProcessManager in main.log).
				"chat.agentHost.claudeAgent.enabled": false,
				"chat.agentHost.codexAgent.enabled": false,
			},
			null,
			2,
		) + "\n",
	);
	// This build's Agent Host downloads a large Claude SDK into
	// <user-data>/agent-host/sdk-cache and recursively watches it. Plant a
	// file (not a directory) at that path so it cannot create the cache.
	const sdkCachePath = path.join(testUserDataDir, "agent-host", "sdk-cache");
	mkdirSync(path.dirname(sdkCachePath), { recursive: true });
	rmSync(sdkCachePath, { recursive: true, force: true });
	writeFileSync(sdkCachePath, "");

	// The suite scaffold writes its report when the mocha run completes.
	// No stale report may survive into this file's run.
	rmSync(reportPath, { force: true });
	const runStartedAt = new Date();

	try {
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(import.meta.dirname, "./suite/index.js"),
			extensionTestsEnv: {
				...process.env,
				// Scaffold loads only this file (path relative to the suite dir).
				MOCHA_TEST_FILE: testFile,
			},
			launchArgs: [
				"--disable-extensions",
				// Polling avoids consuming inotify instances entirely; the
				// per-user limit is already saturated by the parent IDE host.
				"--file-watcher-polling",
				`--user-data-dir=${testUserDataDir}`,
				`--folder-uri=${folderUri}`,
			],
			vscodeExecutablePath: getVscodeExecutablePath(),
		});
	} catch (err) {
		if (isGreenReport(reportPath, runStartedAt)) {
			// The suite completed green; the host aborted afterwards. Known
			// VS Code 1.137 instability on this machine — log loudly, pass.
			console.warn(
				`[runTest] ${testFile}: extension host aborted after a fully green ` +
					"test run (report-authority rule). Original runner error:",
				err instanceof Error ? err.message : err,
			);
			return;
		}
		throw err;
	}
}

// One fresh host per test file (rationale on runOneFile). Fail fast on the
// first file without a green report; each file's report is the authority.
const suiteRoot = path.resolve(import.meta.dirname, "./suite");
const reportPath = path.resolve(suiteRoot, "test-results.log");
const testFiles = process.env.MOCHA_TEST_FILE
	? [process.env.MOCHA_TEST_FILE]
	: (await glob("**/*.test.js", { cwd: suiteRoot })).sort();
const failed: string[] = [];
for (const file of testFiles) {
	process.stdout.write(`\n=== [runTest] ${file} ===\n`);
	let green = false;
	// One retry per file: a real test failure reproduces deterministically,
	// the ext-host abort class documented on isGreenReport does not, so a
	// file that is green on retry is environmental — real failures still
	// fail the gate.
	for (let attempt = 1; attempt <= 2 && !green; attempt++) {
		if (attempt === 2) {
			console.warn(
				`[runTest] ${file}: attempt 1 failed without a green report — retrying once.`,
			);
		}
		try {
			await runOneFile(file, reportPath);
			green = true;
		} catch (err) {
			if (attempt === 2) {
				failed.push(file);
				console.error(
					`[runTest] FAILED: ${file}`,
					err instanceof Error ? err.message : err,
				);
				break;
			}
		}
	}
	if (!green) break;
}
if (failed.length > 0) {
	console.error(`Failed test files: ${failed.join(", ")}`);
	process.exit(1);
}
console.log(`[runTest] all ${testFiles.length} test file(s) green`);
