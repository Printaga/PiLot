import { accessSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const blockPrefixes = [
	"VSCODE_",
	"ELECTRON_",
	"KILO",
	"ICUBE_",
	"OPENCODE",
	"FALLOW_",
	"RG_PATH",
	"VISUAL",
	"EDITOR",
];
for (const k of Object.keys(process.env)) {
	if (blockPrefixes.some((p) => k.startsWith(p))) {
		delete process.env[k];
	}
}
process.env.DISPLAY = process.env.DISPLAY || ":0";

// VSCODE_PATH must come from the environment (CI) or be discovered the same way
// runTest.ts does it. The previous hardcoded /home/lenovo/... path only worked
// on one machine and silently pointed CI at a missing binary.
/** Per-platform install locations of the desktop VS Code Electron binary. */
const PLATFORM_VSCODE_PATHS = {
	darwin: ["/Applications/Visual Studio Code.app/Contents/MacOS/Electron"],
	win32: [
		"Programs/Microsoft VS Code/Code.exe", // under LOCALAPPDATA
		"Microsoft VS Code/Code.exe", // under ProgramFiles
	],
	linux: ["/usr/share/code/code", "/usr/bin/code", "/snap/bin/code"],
};

function platformVscodeCandidates() {
	if (process.platform === "win32") {
		const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles].filter(Boolean);
		return PLATFORM_VSCODE_PATHS.win32.flatMap((rel) => roots.map((root) => join(root, rel)));
	}
	return PLATFORM_VSCODE_PATHS[process.platform] ?? [];
}

/** First installed candidate, or undefined. */
function findInstalledVscode() {
	for (const candidate of platformVscodeCandidates()) {
		if (!candidate) continue;
		try {
			accessSync(candidate);
			return candidate;
		} catch {
			/* not present */
		}
	}
	return undefined;
}

/** Newest @vscode/test-electron download-cache install, or undefined. */
function findCachedVscode() {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return undefined;
	try {
		const cacheRoot = join(home, ".vscode-test");
		const dirPrefix = `vscode-${process.platform}-${process.arch}`;
		return newestCacheEntry(cacheRoot, dirPrefix);
	} catch {
		return undefined; // no cache
	}
}

/** `bin/code` inside the newest cache dir matching prefix, or undefined. */
function newestCacheEntry(cacheRoot, dirPrefix) {
	const matches = readdirSync(cacheRoot)
		.filter((e) => e.startsWith(dirPrefix))
		.sort();
	if (matches.length === 0) return undefined;
	return join(cacheRoot, matches[matches.length - 1], "bin", "code");
}

function discoverVscodePath() {
	return process.env.VSCODE_PATH || findInstalledVscode() || findCachedVscode();
}

const vscodePath = discoverVscodePath();
if (!vscodePath) {
	console.error(
		"run-clean: no VS Code executable found. Set VSCODE_PATH (e.g. output of `node scripts/dl-vscode.mjs`) or install VS Code.",
	);
	process.exit(1);
}
process.env.VSCODE_PATH = vscodePath;

const child = spawn("node", ["./dist-tsc/test/runTest.js"], {
	stdio: "inherit",
	env: process.env,
});
child.on("error", (err) => {
	console.error("run-clean: failed to spawn node:", err);
	process.exit(1);
});
child.on("exit", (code, signal) => {
	// Preserve both exit code and signal semantics; never map a signal to 0.
	if (signal) {
		console.error(`run-clean: test runner terminated by signal ${signal}`);
		process.exit(1);
	}
	process.exit(code ?? 1);
});
