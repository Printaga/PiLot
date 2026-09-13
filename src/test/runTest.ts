import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "node:url";
import { runTests } from "@vscode/test-electron";

function getVscodeExecutablePath(): string | undefined {
	const envPath = process.env.VSCODE_PATH;
	if (envPath && typeof envPath === "string") {
		return envPath;
	}

	const platform = process.platform;

	if (platform === "win32") {
		const winPaths = [
			"C:\\Program Files\\Microsoft VS Code\\Code.exe",
			"C:\\Program Files\\Visual Studio Code\\Code.exe",
			"C:\\Users\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
			path.join(process.env.LOCALAPPDATA || "", "Programs\\Microsoft VS Code\\Code.exe"),
		];
		for (const exePath of winPaths) {
			if (existsSync(exePath)) {
				return exePath;
			}
		}
	} else if (platform === "darwin") {
		const macPaths = [
			"/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
			"/Applications/VS Code.app/Contents/MacOS/Electron",
		];
		for (const exePath of macPaths) {
			if (existsSync(exePath)) {
				return exePath;
			}
		}
	} else {
		const linuxPaths = ["/usr/bin/code", "/usr/local/bin/code", "/snap/bin/code"];
		for (const exePath of linuxPaths) {
			if (!existsSync(exePath)) continue;
			// Distro `code` is a shell wrapper (…/bin/code) that re-forks the GUI via
			// cli.js; the test runner then loses process ownership and the run exits 0
			// without ever starting mocha (observed flake). Prefer the real Electron
			// binary in the resolved install dir when it exists.
			const wrapper = realpathSync(exePath);
			const electronBinary = path.join(path.dirname(path.dirname(wrapper)), "code");
			return existsSync(electronBinary) ? electronBinary : exePath;
		}
	}

	return undefined;
}

// IDE hosts built on Electron (Cursor, Trae, Windsurf, ...) export
// ELECTRON_RUN_AS_NODE and friends. If those leak into the spawned VS Code
// test instance, Electron boots as plain Node and every CLI flag is rejected
// ("bad option: --disable-extensions") or fails silently. Strip them so the
// test runner works from any parent process.
const HOST_ELECTRON_ENV_VARS = [
	"ELECTRON_RUN_AS_NODE",
	"ELECTRON_FORCE_IS_PACKAGED",
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
	process.env.VSCODE_AGENT_HOST_CLAUDE_AGENT_ENABLED = "false";
}

async function main() {
	sanitizeElectronEnv();
	try {
		const extensionDevelopmentPath = path.resolve(import.meta.dirname, "../../");
		const extensionTestsPath = path.resolve(import.meta.dirname, "./suite/index.js");

		// Open a tiny, empty workspace instead of the project root. The project
		// (node_modules included) contains thousands of directories; VS Code's
		// recursive file watcher would create one inotify instance per directory
		// and exhaust the per-user inotify instance limit (often 128), causing
		// EMFILE and a host crash (exit 7) on Linux.
		const testWorkspace = path.join(os.tmpdir(), "pilot-test-workspace");
		mkdirSync(testWorkspace, { recursive: true });
		const folderUri = pathToFileURL(testWorkspace).toString();

		// Use a fresh, minimal user-data dir. VS Code's recursive file watcher
		// creates one inotify instance per watched directory; a reused/accumulated
		// user-data (globalStorage, workspaceStorage, history, …) plus the
		// extensions dir can exceed the per-user inotify instance limit (often
		// 128), causing EMFILE and a host crash (exit 7) on Linux.
		const testUserDataDir = path.join(os.tmpdir(), "pilot-test-userdata");
		mkdirSync(testUserDataDir, { recursive: true });
		// This build's Agent Host downloads a large Claude SDK into
		// <user-data>/agent-host/sdk-cache and recursively watches it, exhausting
		// the container's per-user inotify instance limit (128) and crashing the
		// host (exit 7). Plant a file (not a directory) at that path so the host
		// cannot create the cache directory and therefore watches almost nothing.
		const sdkCachePath = path.join(testUserDataDir, "agent-host", "sdk-cache");
		mkdirSync(path.dirname(sdkCachePath), { recursive: true });
		// Remove any pre-existing cache directory, then plant a file at that
		// path so the Agent Host cannot create the cache directory and therefore
		// watches almost nothing (avoiding the inotify instance limit crash).
		rmSync(sdkCachePath, { recursive: true, force: true });
		writeFileSync(sdkCachePath, "");

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			// Fresh, minimal user-data dir + empty workspace keep VS Code's
			// recursive file watcher under the per-user inotify instance limit
			// (often 128); otherwise EMFILE crashes the host (exit 7) on Linux.
			launchArgs: [
				"--disable-extensions",
				// Use polling instead of inotify for VS Code's file watcher. The
				// per-user inotify instance limit (128) is already saturated by the
				// parent IDE host that launched this run, so any extra inotify watch
				// fails with EMFILE and crashes the host (exit 7). Polling avoids
				// consuming inotify instances entirely.
				"--file-watcher-polling",
				`--user-data-dir=${testUserDataDir}`,
				`--folder-uri=${folderUri}`,
			],
			vscodeExecutablePath: getVscodeExecutablePath(),
		});
	} catch (err) {
		console.error("Failed to run tests:", err);
		process.exit(1);
	}
}

main();
