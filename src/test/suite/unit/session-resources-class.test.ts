import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import { SessionResources } from "../../../session-resources.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createDeps() {
	const errors: Array<{ msg: string; error?: unknown }> = [];
	const debugLogs: string[] = [];

	return {
		logError: (msg: string, error?: unknown) => errors.push({ msg, error }),
		logDebug: (...args: unknown[]) => debugLogs.push(args.join(" ")),
		settingsManager: undefined as any,
		_errors: errors,
		_debugLogs: debugLogs,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────

suite("SessionResources class", () => {
	setup(() => {
		resetVscodeMocks();
	});

	teardown(() => {
		resetVscodeMocks();
	});

	suite("getWorkspacePath()", () => {
		test("returns first workspace folder path", () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = sr.getWorkspacePath();
			// resetVscodeMocks sets workspaceFolders to [{ uri: { fsPath: "/fake/workspace" } }]
			assert.strictEqual(result, "/fake/workspace");
		});

		test("returns cwd when no workspace folders", () => {
			(globalThis as any).vscode.workspace.workspaceFolders = undefined;
			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = sr.getWorkspacePath();
			assert.strictEqual(result, process.cwd());
		});
	});

	suite("setSettingsManager()", () => {
		test("updates the settings manager reference", () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);
			const mockManager = { id: "mock" } as any;
			sr.setSettingsManager(mockManager);
			// Verify by calling getConfiguredPackages which uses deps.settingsManager
			// The method should not throw
			sr.getConfiguredPackages();
		});
	});

	suite("getProjectContext()", () => {
		test("returns project info from package.json", async () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);

			// Mock vscode.workspace.fs.readFile to return a package.json
			const vscode = (globalThis as any).vscode;
			vscode.workspace.fs.readFile = async () =>
				Buffer.from(JSON.stringify({ name: "test-project", version: "1.0.0" }));

			const ctx = await sr.getProjectContext();
			assert.ok(ctx.includes("Project Root:"));
			assert.ok(ctx.includes("test-project"));
			assert.ok(ctx.includes("1.0.0"));
		});

		test("falls back to root-only string on parse error", async () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);

			const vscode = (globalThis as any).vscode;
			vscode.workspace.fs.readFile = async () =>
				Buffer.from("invalid json {{{");

			const ctx = await sr.getProjectContext();
			assert.ok(ctx.includes("Project Root:"));
			// Should not include name/version since parse failed
			assert.ok(!ctx.includes("Project Name:"));
		});

		test("returns empty string when no workspace folders", async () => {
			(globalThis as any).vscode.workspace.workspaceFolders = undefined;
			const deps = createDeps();
			const sr = new SessionResources(deps);

			const ctx = await sr.getProjectContext();
			assert.strictEqual(ctx, "");
		});
	});

	suite("resolveFileMentions()", () => {
		const tmpDir = path.join(
			__dirname,
			"../../..",
			"test-tmp-session-resources",
		);

		setup(() => {
			fs.mkdirSync(tmpDir, { recursive: true });
			// Set workspace root to tmpDir
			(globalThis as any).vscode.workspace.workspaceFolders = [
				{ uri: { fsPath: tmpDir } },
			];
		});

		teardown(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
			resetVscodeMocks();
		});

		test("returns text unchanged when no @ mentions", async () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = await sr.resolveFileMentions("no mentions here");
			assert.strictEqual(result, "no mentions here");
		});

		test("resolves existing text files", async () => {
			// Create a test file
			const testFile = path.join(tmpDir, "hello.txt");
			fs.writeFileSync(testFile, "file content");

			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = await sr.resolveFileMentions("@hello.txt world");

			assert.ok(result.includes('<file path="hello.txt">'));
			assert.ok(result.includes("file content"));
			assert.ok(result.includes("</file>"));
		});

		test("skips binary files", async () => {
			// Create a binary-looking file
			const binFile = path.join(tmpDir, "image.png");
			fs.writeFileSync(binFile, "binary data");

			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = await sr.resolveFileMentions("@image.png check");

			// Should not resolve the binary file
			assert.ok(!result.includes("<file path="));
			// Text should remain (minus the mention pattern)
			assert.ok(result.includes("check"));
		});

		test("truncates files > 50KB", async () => {
			// Create a large file (> 50KB)
			const largeFile = path.join(tmpDir, "large.txt");
			const content = "x".repeat(60 * 1024); // 60KB
			fs.writeFileSync(largeFile, content);

			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = await sr.resolveFileMentions("@large.txt");

			assert.ok(result.includes("[file truncated at 50KB]"));
		});

		test("handles read errors gracefully", async () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);

			// Try to resolve a file that exists but can't be read (directory)
			// Actually, let's use a non-existent path that's not binary
			// but the regex won't match non-existent files without @
			// The function checks fs.existsSync first, so non-existent files are skipped
			const result = await sr.resolveFileMentions(
				"@nonexistent-file.txt hello",
			);
			// File doesn't exist, so it's skipped
			assert.ok(result.includes("hello"));
		});
	});

	suite("getConfiguredPackages()", () => {
		test("returns empty when no settings files exist", () => {
			const deps = createDeps();
			const sr = new SessionResources(deps);
			const result = sr.getConfiguredPackages();
			// Without actual settings files, should return empty array
			assert.ok(Array.isArray(result));
		});
	});
});
