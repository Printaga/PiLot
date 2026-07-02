// ── Unit tests for binary-service ──────────────────────────────────────────

import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
	BinaryService,
	binaryServiceInternals,
} from "../../../binary-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeps(_opts?: {
	logDebugCalls?: any[][];
	logErrorCalls?: any[][];
}) {
	const logDebugCalls: any[][] = [];
	const logErrorCalls: any[][] = [];

	const deps = {
		logDebug: (...details: any[]) => logDebugCalls.push(details),
		logError: (...details: any[]) => logErrorCalls.push(details),
	};

	return { deps, logDebugCalls, logErrorCalls, BinaryService };
}

function resetVscodeBinaryMocks() {
	const vscode = (globalThis as any).vscode;
	if (vscode) {
		(vscode.window.showErrorMessage as any) = undefined;
		(vscode.workspace.getConfiguration as any) = undefined;
	}
}

function makeBinaryService(opts?: {
	resolvedPath?: string | null;
	pathResolved?: boolean;
	cachedVersion?: string | null;
}) {
	const { deps, logDebugCalls, logErrorCalls } = createDeps();
	const service = new BinaryService(deps);

	if (opts?.resolvedPath !== undefined) {
		(service as any).resolvedBinaryPath = opts.resolvedPath;
	}
	if (opts?.pathResolved !== undefined) {
		(service as any).pathResolved = opts.pathResolved;
	}
	if (opts?.cachedVersion !== undefined) {
		(service as any).cachedVersion = opts.cachedVersion;
	}

	return { service, deps, logDebugCalls, logErrorCalls };
}

function makeVSCodeConfigWithBinary(binaryPath: string) {
	const vscode = (globalThis as any).vscode;
	if (!vscode) throw new Error("vscode not available");
	(vscode.workspace.getConfiguration as any) = (_section?: string) =>
		({
			get: (_key: string, defaultValue?: any) => {
				if (_key === "binaryPath") return binaryPath;
				return defaultValue;
			},
			update: async () => {},
		}) as any;
}

async function importShell() {
	return await import("../../../utils/shell.js");
}

function setupResolver(
	binaryPath: string,
	_tmpDir?: string,
) {
	makeVSCodeConfigWithBinary(binaryPath);
}

// ---------------------------------------------------------------------------
// resolveAtStartup
// ---------------------------------------------------------------------------

suite("BinaryService: resolveAtStartup", () => {
	setup(() => {
		resetVscodeBinaryMocks();
	});

	test("resolves and stores absolute binary path on first call", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-resolve-1st-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh\necho ok");
		fs.chmodSync(fakeBin, 0o755);

		const { service, logDebugCalls } = makeBinaryService({});

		try {
			setupResolver(fakeBin);
			const origResolve = binaryServiceInternals.resolvePiBinary;
			binaryServiceInternals.resolvePiBinary = () => fakeBin;

			service.resolveAtStartup();

			assert.strictEqual(
				service.getResolvedPath(),
				fakeBin,
				"expected resolvedBinaryPath to be set",
			);
			assert.ok(
				logDebugCalls.some((args) =>
					args[0]?.includes?.("Resolved pi binary"),
				),
				"expected logDebug to have been called",
			);
			binaryServiceInternals.resolvePiBinary = origResolve;
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("second call skips work and does not call findPiBinary again", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-resolve-cache-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh\necho ok");
		fs.chmodSync(fakeBin, 0o755);

		const { service, logDebugCalls } = makeBinaryService({});

		try {
			makeVSCodeConfigWithBinary(fakeBin);
			const origResolve = binaryServiceInternals.resolvePiBinary;
			let callCount = 0;
			binaryServiceInternals.resolvePiBinary = () => {
				callCount++;
				return fakeBin;
			};

			service.resolveAtStartup();
			const dbgCountAfterFirst = logDebugCalls.length;
			service.resolveAtStartup();
			const dbgCountAfterSecond = logDebugCalls.length;

			assert.strictEqual(
				callCount,
				1,
				"findPiBinary should be called only once",
			);
			assert.strictEqual(
				dbgCountAfterFirst,
				dbgCountAfterSecond,
				"logDebug should not be called on a second resolveAtStartup",
			);
			binaryServiceInternals.resolvePiBinary = origResolve;
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("shows error message via vscode.window.showErrorMessage when binary is not found", async () => {
		const { service, logErrorCalls } = makeBinaryService({});
		const vscode = (globalThis as any).vscode;
		const origShow = (vscode.window.showErrorMessage as any);
		const messages: string[] = [];
		(vscode.window.showErrorMessage as any) = (_msg: string) => {
			messages.push(_msg);
			return _msg;
		};

		const origResolve = binaryServiceInternals.resolvePiBinary;
		binaryServiceInternals.resolvePiBinary = () => null;

		try {
			service.resolveAtStartup();

			assert.ok(
				logErrorCalls.some((args) =>
					(args[0] as string).includes?.("Could not locate 'pi' binary"),
				),
				"expected logError to contain 'Could not locate pi binary'",
			);
			assert.ok(
				messages.length > 0,
				"expected showErrorMessage to have been invoked",
			);
		} finally {
			binaryServiceInternals.resolvePiBinary = origResolve;
			(vscode.window.showErrorMessage as any) = origShow;
		}
	});
});

// ---------------------------------------------------------------------------
// prependToPath
// ---------------------------------------------------------------------------

suite("BinaryService: prependToPath", () => {
	test("no-op when resolvedBinaryPath is null", async () => {
		const { service } = makeBinaryService({ resolvedPath: null });
		const origPath = process.env.PATH;
		service.prependToPath();
		assert.strictEqual(process.env.PATH, origPath);
	});

	test("no-op when resolvedBinaryPath is not absolute", async () => {
		const { service } = makeBinaryService({ resolvedPath: "pi" });
		const origPath = process.env.PATH;
		service.prependToPath();
		assert.strictEqual(process.env.PATH, origPath);
	});

	test("no-op when PATH environment variable is undefined", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-nopath-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh");
		fs.chmodSync(fakeBin, 0o755);

		const { service } = makeBinaryService({ resolvedPath: fakeBin });
		const origPath = process.env.PATH;
		delete process.env.PATH;
		try {
			service.prependToPath();
			assert.strictEqual(process.env.PATH, undefined);
		} finally {
			if (origPath !== undefined) {
				process.env.PATH = origPath;
			}
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("prepends binary directory to PATH when absolute path exists", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-prepend-ok-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh");
		fs.chmodSync(fakeBin, 0o755);

		const { service } = makeBinaryService({ resolvedPath: fakeBin });

		process.env.PATH = "/usr/bin:/bin";
		try {
			service.prependToPath();
			const sep = process.platform === "win32" ? ";" : ":";
			assert.ok(
				process.env.PATH.startsWith(tmpDir + sep),
				`expected PATH to start with ${tmpDir}${sep}, got: ${process.env.PATH}`,
			);
			assert.ok(
				process.env.PATH.endsWith("/usr/bin:/bin"),
				"expected original PATH to be at the end",
			);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// restorePath
// ---------------------------------------------------------------------------

suite("BinaryService: restorePath", () => {
	test("no-op when originalPath is undefined", async () => {
		const { service } = makeBinaryService({ resolvedPath: "/some/path" });
		process.env.PATH = "modified";
		service.restorePath(undefined);
		assert.strictEqual(process.env.PATH, "modified");
	});

	test("restores PATH to originalPath value", async () => {
		const { service } = makeBinaryService({ resolvedPath: "/some/path" });
		const original = "/usr/bin:/bin";
		process.env.PATH = "modified";
		service.restorePath(original);
		assert.strictEqual(process.env.PATH, original);
	});
});

// ---------------------------------------------------------------------------
// getCliVersion
// ---------------------------------------------------------------------------

suite("BinaryService: getCliVersion", () => {
	test("returns cached version without calling execFileAsync on repeat calls", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-cache-hit-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh\necho v");
		fs.chmodSync(fakeBin, 0o755);

		try {
			const { service } = makeBinaryService({ cachedVersion: "0.50.0" });
			const result = await service.getCliVersion();
			assert.strictEqual(result, "0.50.0");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("resolves and caches version on first call from file", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-cache-miss-"));
		const fakeBin = path.join(tmpDir, "pi");
		fs.writeFileSync(fakeBin, "#!/bin/sh\necho ok");
		fs.chmodSync(fakeBin, 0o755);

		try {
			const { service } = makeBinaryService({ cachedVersion: null });
			const shell = await importShell();
			const origExecFileAsync = (shell as any).execFileAsync;
			let called = false;
			(shell as any).execFileAsync = async () => {
				called = true;
				return { code: 0, stdout: "1.2.3-cached\n", stderr: "" };
			};

			const origFind = binaryServiceInternals.findPiBinary;
			binaryServiceInternals.findPiBinary = () => fakeBin;

			try {
				const v1 = await service.getCliVersion();
				assert.strictEqual(v1, "1.2.3-cached");
				assert.ok(called, "expected execFileAsync to have been invoked");

				// Reset spy — second call must not invoke execFileAsync
				called = false;
				(shell as any).execFileAsync = async () => {
					throw new Error("should not reach here");
				};

				const v2 = await service.getCliVersion();
				assert.strictEqual(v2, "1.2.3-cached");
			} finally {
				(shell as any).execFileAsync = origExecFileAsync;
				binaryServiceInternals.findPiBinary = origFind;
				(service as any).cachedVersion = null;
			}
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns null and does not cache on command failure", async () => {
		const { service } = makeBinaryService({ cachedVersion: null });
		const shell = await importShell();
		const origExecFileAsync = (shell as any).execFileAsync;
		(shell as any).execFileAsync = async () => {
			return { code: 1, stdout: "some error", stderr: "some error" };
		};

		const origFind = binaryServiceInternals.findPiBinary;
		binaryServiceInternals.findPiBinary = () => "definitely-not-found-pi";

		try {
			const result = await service.getCliVersion();
			assert.strictEqual(result, null);
			assert.strictEqual(
				(service as any).cachedVersion,
				null,
				"version should not be cached on failure",
			);
		} finally {
			(shell as any).execFileAsync = origExecFileAsync;
			binaryServiceInternals.findPiBinary = origFind;
			(service as any).cachedVersion = null;
		}
	});

	test("returns null when command exits 0 but output is empty", async () => {
		const { service } = makeBinaryService({ cachedVersion: null });
		const shell = await importShell();
		const origExecFileAsync = (shell as any).execFileAsync;
		(shell as any).execFileAsync = async () => ({
			code: 0,
			stdout: "",
			stderr: "",
		});

		const origFind = binaryServiceInternals.findPiBinary;
		binaryServiceInternals.findPiBinary = () => "pi";

		try {
			const result = await service.getCliVersion();
			assert.strictEqual(result, null);
		} finally {
			(shell as any).execFileAsync = origExecFileAsync;
			binaryServiceInternals.findPiBinary = origFind;
			(service as any).cachedVersion = null;
		}
	});
});

// ---------------------------------------------------------------------------
// isBinaryAvailable
// ---------------------------------------------------------------------------

suite("BinaryService: isBinaryAvailable", () => {
	test("returns true when resolvedBinaryPath is a non-null string", async () => {
		const { service } = makeBinaryService({ resolvedPath: "/usr/local/bin/pi" });
		assert.strictEqual(service.isBinaryAvailable(), true);
	});

	test("returns false when resolvedBinaryPath is null", async () => {
		const { service } = makeBinaryService({ resolvedPath: null });
		assert.strictEqual(service.isBinaryAvailable(), false);
	});

	test("returns true when resolvedBinaryPath is a relative string", async () => {
		const { service } = makeBinaryService({ resolvedPath: "pi" });
		assert.strictEqual(service.isBinaryAvailable(), true);
	});
});

// ---------------------------------------------------------------------------
// resolveGitBranch
// ---------------------------------------------------------------------------

suite("BinaryService: resolveGitBranch", () => {
	test("returns branch ref when .git is a directory with normal HEAD", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-dir-"));
		const gitDir = path.join(tmpDir, ".git");
		fs.mkdirSync(gitDir);
		fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, "refs/heads/main");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns 'detached' when .git is a directory with detached HEAD", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-det-dir-"));
		const gitDir = path.join(tmpDir, ".git");
		fs.mkdirSync(gitDir);
		fs.writeFileSync(path.join(gitDir, "HEAD"), "abc123sha\n");

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, "detached");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns null when .git is a directory with no HEAD file", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-nohead-"));
		fs.mkdirSync(path.join(tmpDir, ".git"));
		// No HEAD file created

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns branch ref when .git is a file (submodule) with gitdir", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-sub-"));
		const actualGitDir = path.join(tmpDir, "actual-git");
		fs.mkdirSync(actualGitDir);
		fs.writeFileSync(
			path.join(actualGitDir, "HEAD"),
			"ref: refs/heads/feature\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, ".git"),
			"gitdir: actual-git\n",
		);

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, "refs/heads/feature");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns 'detached' for submodule .git file pointing to detached HEAD", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-sub-det-"));
		const actualGitDir = path.join(tmpDir, "actual-git-submod");
		fs.mkdirSync(actualGitDir);
		fs.writeFileSync(path.join(actualGitDir, "HEAD"), "deadbeef\n");
		fs.writeFileSync(
			path.join(tmpDir, ".git"),
			"gitdir: actual-git-submod\n",
		);

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, "detached");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns null for submodule .git file with missing HEAD file", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-sub-nohead-"));
		fs.writeFileSync(path.join(tmpDir, ".git"), "gitdir: does-not-exist\n");
		// actual git dir not created

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns null when .git is a file with invalid gitdir content (no parse error, just no match)", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-sub-invalid-"));
		fs.writeFileSync(path.join(tmpDir, ".git"), "not a gitdir line\n");

		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns null when no .git exists anywhere up the tree", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-git-none-"));
		const { service } = makeBinaryService({});
		try {
			const branch = service.resolveGitBranch(tmpDir);
			assert.strictEqual(branch, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("stops at filesystem root and returns null when no .git is found", async () => {
		const { service } = makeBinaryService({});
		const branch = service.resolveGitBranch("/tmp-pilot-no-git-root");
		assert.strictEqual(branch, null);
	});
});

// ---------------------------------------------------------------------------
// getResolvedPath / resolveBinary / getBinaryPath
// ---------------------------------------------------------------------------

suite("BinaryService: getResolvedPath / resolveBinary / getBinaryPath", () => {
	test("getResolvedPath returns null on freshly constructed service", async () => {
		const { service } = makeBinaryService({});
		assert.strictEqual(service.getResolvedPath(), null);
	});

	test("getResolvedPath returns stored path after resolution", async () => {
		const { service } = makeBinaryService({ resolvedPath: "/fake/pi" });
		assert.strictEqual(service.getResolvedPath(), "/fake/pi");
	});
});
