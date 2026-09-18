// ── Unit tests for pi-binary ────────────────────────────────────────────────

import * as assert from "assert";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
	resolvePiBinaryFromSetting,
	findPiBinary,
	resolvePiBinary,
	isSafeBinaryPath,
	piBinaryInternals,
	parseInstalledPackages,
	readPackageManifest,
	readPackageSourcesFromSettingsFile,
} from "../../../pi-binary.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import * as vscodeModule from "vscode";

function withTmpDir(prefix: string, fn: (tmpDir: string) => void) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	try {
		fn(tmpDir);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// resolvePiBinaryFromSetting
// ---------------------------------------------------------------------------

suite("pi-binary: resolvePiBinaryFromSetting", () => {
	test("returns null for empty string", () => {
		assert.strictEqual(resolvePiBinaryFromSetting(""), null);
	});

	test("returns null for literal 'pi'", () => {
		assert.strictEqual(resolvePiBinaryFromSetting("pi"), null);
	});

	test("returns null for whitespace-only string", () => {
		assert.strictEqual(resolvePiBinaryFromSetting("   "), null);
	});

	test("returns trimmed absolute path when the file exists", () => {
		withTmpDir("pilot-rpfs-exists-", (tmpDir) => {
			const fakeBin = path.join(tmpDir, "pi");
			fs.writeFileSync(fakeBin, "#!/bin/sh\necho test");
			fs.chmodSync(fakeBin, 0o755);

			const result = resolvePiBinaryFromSetting(fakeBin);
			assert.strictEqual(result, fakeBin);
		});
	});

	test("returns null for absolute path that does not exist on non-Windows", () => {
		if (process.platform === "win32") return;
		const result = resolvePiBinaryFromSetting("/nonexistent/path/to/pi");
		assert.strictEqual(result, null);
	});

	test("returns plain name (no path separators) as-is", () => {
		const result = resolvePiBinaryFromSetting("pi-custom");
		assert.strictEqual(result, "pi-custom");
	});

	test("returns null for absolute path with no execute permission on non-Windows", () => {
		if (process.platform === "win32") return;
		const result = resolvePiBinaryFromSetting("/root/definitely-not-readable-pi");
		assert.strictEqual(result, null);
	});

	test("refuses a bare name carrying shell syntax instead of resolving it", () => {
		// A workspace-supplied setting reaches a `shell: true` child as the program
		// name, so accepting this would run the substitution rather than a binary.
		for (const hostile of [
			"pi; touch /tmp/pwned",
			"pi && touch /tmp/pwned",
			"pi || touch /tmp/pwned",
			"pi | touch /tmp/pwned",
			"$(touch /tmp/pwned)",
			"`touch /tmp/pwned`",
			"(touch /tmp/pwned)",
			"{ touch /tmp/pwned; }",
			"pi > /tmp/pwned",
			"pi < /dev/null",
			"pi\ntouch /tmp/pwned",
		]) {
			assert.strictEqual(resolvePiBinaryFromSetting(hostile), null, `accepted: ${hostile}`);
		}
	});

	test("refuses a hostile value before it is checked against the filesystem", () => {
		let accessCalls = 0;
		const original = piBinaryInternals.accessSync;
		piBinaryInternals.accessSync = () => {
			accessCalls += 1;
		};
		try {
			assert.strictEqual(resolvePiBinaryFromSetting("/usr/bin/pi; touch /tmp/pwned"), null);
			assert.strictEqual(
				accessCalls,
				0,
				"a refused value must not reach the filesystem check",
			);
		} finally {
			piBinaryInternals.accessSync = original;
		}
	});

	test("refuses a joined path that inherits shell syntax from the workspace folder", () => {
		// The workspace folder name is repository-controlled too, so the resolved
		// path is checked and not only the configured setting.
		const originalAccess = piBinaryInternals.accessSync;
		const originalFolders = Object.getOwnPropertyDescriptor(
			vscodeModule.workspace,
			"workspaceFolders",
		);
		piBinaryInternals.accessSync = () => {};
		Object.defineProperty(vscodeModule.workspace, "workspaceFolders", {
			configurable: true,
			value: [{ uri: { fsPath: "/home/user/repo; touch /tmp/pwned" } }],
		});
		try {
			assert.strictEqual(resolvePiBinaryFromSetting("./bin/pi"), null);
		} finally {
			piBinaryInternals.accessSync = originalAccess;
			if (originalFolders) {
				Object.defineProperty(vscodeModule.workspace, "workspaceFolders", originalFolders);
			}
		}
	});

	test("accepts a plain name and an absolute path", () => {
		assert.strictEqual(isSafeBinaryPath("pi"), true);
		assert.strictEqual(isSafeBinaryPath("pi-custom"), true);
		assert.strictEqual(isSafeBinaryPath("/usr/local/bin/pi"), true);
	});

	test("keeps accepting paths that real install locations use", () => {
		// Refusing these would break a setup that works today, which is why the check
		// refuses execution characters rather than allowlisting a path alphabet.
		assert.strictEqual(isSafeBinaryPath("/opt/My Programs/pi"), true);
		assert.strictEqual(isSafeBinaryPath("C:\\Program Files (x86)\\Pi\\pi.exe"), true);
		assert.strictEqual(isSafeBinaryPath("~/bin/pi"), true);
	});

	test("refuses cmd.exe-special characters on Windows only", () => {
		// `%` expands a variable, `^` escapes the next character, `!` expands under
		// delayed expansion, and `"` would close cmd's wrapping quote. None of these
		// are live on a POSIX shell, where such a path is still accepted. Values are
		// built from those characters alone, so the two branches are compared on the
		// same input.
		for (const value of ["C:\\pi%USERPROFILE%", "C:\\pi^caret", "C:\\pi!bang"]) {
			assert.strictEqual(isSafeBinaryPath(value, "win32"), false, `windows: ${value}`);
			assert.strictEqual(isSafeBinaryPath(value, "linux"), true, `posix: ${value}`);
		}
		// A `"` is refused on Windows, where it closes cmd's wrapping quote and
		// exposes whatever followed it. On POSIX it cannot execute anything, because
		// the substitution characters it would need are refused ahead of it — it can
		// only break tokenization, which is a failure and not an execution.
		assert.strictEqual(isSafeBinaryPath('C:\\pi"quote', "win32"), false);
		assert.strictEqual(isSafeBinaryPath('C:\\pi"quote', "linux"), true);
		// A normal Windows path, spaces and parentheses included, stays usable.
		assert.strictEqual(isSafeBinaryPath("C:\\Program Files (x86)\\Pi\\pi.exe", "win32"), true);
	});

	test("refuses an empty or oversized value", () => {
		assert.strictEqual(isSafeBinaryPath(""), false);
		assert.strictEqual(isSafeBinaryPath("a".repeat(4097)), false);
	});
});

suite("pi-binary: Windows .exe/.cmd suffix fallback", () => {
	test("returns .exe suffix when base path does not exist but .exe does (Windows)", () => {
		if (process.platform !== "win32") return;

		withTmpDir("pilot-win-exe-", (tmpDir) => {
			const baseName = `pi-win-test-${Date.now()}`;
			const exePath = path.join(tmpDir, baseName + ".exe");
			fs.writeFileSync(exePath, "");
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, exePath);
		});
	});

	test("returns .cmd suffix when base and .exe don't exist but .cmd does (Windows)", () => {
		if (process.platform !== "win32") return;

		withTmpDir("pilot-win-cmd-", (tmpDir) => {
			const baseName = `pi-win-cmd-${Date.now()}`;
			const cmdPath = path.join(tmpDir, baseName + ".cmd");
			fs.writeFileSync(cmdPath, "");
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, cmdPath);
		});
	});

	test("prefers .exe over .cmd when both exist on Windows", () => {
		if (process.platform !== "win32") return;

		withTmpDir("pilot-win-pref-", (tmpDir) => {
			const baseName = `pi-win-pref-${Date.now()}`;
			const exePath = path.join(tmpDir, baseName + ".exe");
			const cmdPath = path.join(tmpDir, baseName + ".cmd");
			fs.writeFileSync(exePath, "");
			fs.writeFileSync(cmdPath, "");
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, exePath);
		});
	});
});

// ---------------------------------------------------------------------------
// findPiBinary
// ---------------------------------------------------------------------------

suite("pi-binary: findPiBinary", () => {
	test("returns a non-empty string", () => {
		const result = findPiBinary();
		assert.strictEqual(typeof result, "string");
		assert.ok(result.length > 0, "expected non-empty string");
	});
});

// ---------------------------------------------------------------------------
// resolvePiBinary
// ---------------------------------------------------------------------------

suite("pi-binary: resolvePiBinary", () => {
	test("returns absolute path when findPiBinary resolves an existing absolute path", async () => {
		withTmpDir("pilot-resolve-ok-", (tmpDir) => {
			const fakeBin = path.join(tmpDir, "pi");
			fs.writeFileSync(fakeBin, "#!/bin/sh\necho ok");
			fs.chmodSync(fakeBin, 0o755);

			const origConfig = vscodeModule.workspace.getConfiguration as any;
			(vscodeModule.workspace.getConfiguration as any) = (_section?: string) =>
				({
					get: (_key: string, defaultValue?: any) => {
						if (_key === "binaryPath") return fakeBin;
						return defaultValue;
					},
					update: async () => {},
				}) as any;

			try {
				const result = resolvePiBinary();
				assert.strictEqual(result, fakeBin);
			} finally {
				(vscodeModule.workspace.getConfiguration as any) = origConfig;
			}
		});
	});

	test("returns null when no pi binary is found and spawnSync fails", async () => {
		const origConfig = vscodeModule.workspace.getConfiguration as any;
		const shellModule = await import("../../../utils/shell.js");
		const origExecFileAsync = shellModule.shellInternals.execFileAsync;
		const origSpawnSync = piBinaryInternals.spawnSync;
		const origAccessSync = piBinaryInternals.accessSync;
		// Simulate a machine where none of the well-known candidate paths exist.
		piBinaryInternals.accessSync = () => {
			throw new Error("ENOENT");
		};

		(vscodeModule.workspace.getConfiguration as any) = (_section?: string) =>
			({
				get: (_key: string, defaultValue?: any): any => defaultValue,
				update: async () => {},
			}) as any;

		// Mock spawnSync so `command -v "pi"` returns empty (status = 1)
		(piBinaryInternals as any).spawnSync = (_cmd: string, _args: string[], opts?: any) => ({
			status: 1,
			stdout: Buffer.from(""),
			stderr: Buffer.from(""),
			...opts,
		});

		try {
			const result = resolvePiBinary();
			assert.strictEqual(result, null);
		} finally {
			(vscodeModule.workspace.getConfiguration as any) = origConfig;
			(piBinaryInternals as any).spawnSync = origSpawnSync;
			piBinaryInternals.accessSync = origAccessSync;
			shellModule.shellInternals.execFileAsync = origExecFileAsync;
		}
	});

	test("returns null when spawnSync throws an exception", async () => {
		const origConfig = vscodeModule.workspace.getConfiguration as any;
		const origSpawnSync = piBinaryInternals.spawnSync;
		const origAccessSync2 = piBinaryInternals.accessSync;
		piBinaryInternals.accessSync = () => {
			throw new Error("ENOENT");
		};
		(piBinaryInternals as any).spawnSync = (_cmd: string, _args: string[], _opts?: any) => {
			throw new Error("spawnSync crashed");
		};

		(vscodeModule.workspace.getConfiguration as any) = (_section?: string) =>
			({
				get: (_key: string, defaultValue?: any): any => defaultValue,
				update: async () => {},
			}) as any;

		try {
			const result = resolvePiBinary();
			assert.strictEqual(result, null);
		} finally {
			(vscodeModule.workspace.getConfiguration as any) = origConfig;
			(piBinaryInternals as any).spawnSync = origSpawnSync;
			piBinaryInternals.accessSync = origAccessSync2;
		}
	});
});

// ---------------------------------------------------------------------------
// parseInstalledPackages
// ---------------------------------------------------------------------------

suite("pi-binary: parseInstalledPackages", () => {
	test("returns empty array for empty output", () => {
		assert.deepStrictEqual(parseInstalledPackages(""), []);
	});

	test("returns empty array for 'No packages installed.'", () => {
		assert.deepStrictEqual(parseInstalledPackages("No packages installed."), []);
	});

	test("parses valid output with source and path", () => {
		const output = `Packages:
  my-source
    /path/to/package`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "my-source");
		assert.strictEqual(result[0].path, "/path/to/package");
	});

	test("parses source with no packages (empty path)", () => {
		const output = `Packages:
  empty-source`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "empty-source");
		assert.strictEqual(result[0].path, "");
	});

	test("strips '(filtered)' suffix from source name", () => {
		const output = `Packages:
  filtered-source (filtered)
    /some/path`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "filtered-source");
		assert.strictEqual(result[0].path, "/some/path");
	});

	test("parses multiple packages under the same source", () => {
		const output = `Packages:
  source-a
    /path/a1
    /path/a2`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].source, "source-a");
		assert.strictEqual(result[0].path, "/path/a1");
		assert.strictEqual(result[1].source, "source-a");
		assert.strictEqual(result[1].path, "/path/a2");
	});

	test("parses packages across multiple sources", () => {
		const output = `Packages:
  source-a
    /path/a
  source-b
    /path/b`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 2);
		assert.deepStrictEqual(result[0], { source: "source-a", path: "/path/a" });
		assert.deepStrictEqual(result[1], { source: "source-b", path: "/path/b" });
	});

	test("handles trailing empty lines without error", () => {
		const output = `Packages:
  src-a
    /path/a

`;
		const result = parseInstalledPackages(output);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "src-a");
	});

	test("ignores lines matching 'packages:' trailer", () => {
		const output = `Packages:

  pkgs:`;
		const result = parseInstalledPackages(output);
		assert.deepStrictEqual(result, []);
	});
});

// ---------------------------------------------------------------------------
// readPackageManifest
// ---------------------------------------------------------------------------

suite("pi-binary: readPackageManifest", () => {
	test("returns empty description/version for empty path", () => {
		const result = readPackageManifest("");
		assert.deepStrictEqual(result, { description: "", version: "" });
	});

	test("returns empty description/version for missing package.json", () => {
		withTmpDir("pilot-manifest-miss-", (tmpDir) => {
			const result = readPackageManifest(tmpDir);
			assert.deepStrictEqual(result, { description: "", version: "" });
		});
	});

	test("returns empty description/version for corrupted JSON in package.json", () => {
		withTmpDir("pilot-manifest-brk-", (tmpDir) => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "not-valid-json{");
			const result = readPackageManifest(tmpDir);
			assert.deepStrictEqual(result, { description: "", version: "" });
		});
	});

	test("returns description and version from a valid manifest", () => {
		withTmpDir("pilot-manifest-ok-", (tmpDir) => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({
					name: "test-pkg",
					version: "2.0.1",
					description: "A test package",
				}),
			);
			const result = readPackageManifest(tmpDir);
			assert.strictEqual(result.description, "A test package");
			assert.strictEqual(result.version, "2.0.1");
		});
	});

	test("returns empty strings when description/version fields are absent", () => {
		withTmpDir("pilot-manifest-min-", (tmpDir) => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "no-desc-vers" }),
			);
			const result = readPackageManifest(tmpDir);
			assert.strictEqual(result.description, "");
			assert.strictEqual(result.version, "");
		});
	});

	test("returns empty strings when description/version are non-string types", () => {
		withTmpDir("pilot-manifest-badtype-", (tmpDir) => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "x", description: 123, version: true }),
			);
			const result = readPackageManifest(tmpDir);
			assert.strictEqual(result.description, "");
			assert.strictEqual(result.version, "");
		});
	});
});

// ---------------------------------------------------------------------------
// readPackageSourcesFromSettingsFile
// ---------------------------------------------------------------------------

suite("pi-binary: readPackageSourcesFromSettingsFile", () => {
	test("returns empty array for missing file", () => {
		const result = readPackageSourcesFromSettingsFile(
			"/totally/nonexistent/path/settings.json",
		);
		assert.deepStrictEqual(result, []);
	});

	test("returns empty array for invalid JSON content", () => {
		withTmpDir("pilot-settings-bad-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(filePath, "not-valid-json{{{");
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, []);
		});
	});

	test("returns empty array when packages field is missing", () => {
		withTmpDir("pilot-settings-nopkg-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(filePath, JSON.stringify({ otherField: true }));
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, []);
		});
	});

	test("returns empty array when packages field is not an array", () => {
		withTmpDir("pilot-settings-notarray-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(filePath, JSON.stringify({ packages: "string-not-array" }));
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, []);
		});
	});

	test("returns source strings from a valid packages array of plain strings", () => {
		withTmpDir("pilot-settings-str-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(
				filePath,
				JSON.stringify({
					packages: ["skill-a", "skill-b", "prompt-c"],
				}),
			);
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, ["skill-a", "skill-b", "prompt-c"]);
		});
	});

	test("returns source strings from a valid packages array of source objects", () => {
		withTmpDir("pilot-settings-obj-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(
				filePath,
				JSON.stringify({
					packages: [{ source: "skill-a" }, { source: "skill-b" }],
				}),
			);
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, ["skill-a", "skill-b"]);
		});
	});

	test("ignores objects missing the source field", () => {
		withTmpDir("pilot-settings-nosrc-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(
				filePath,
				JSON.stringify({
					packages: [{ source: "skill-a" }, {}],
				}),
			);
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, ["skill-a"]);
		});
	});

	test("filters out empty-string sources from mixed array", () => {
		withTmpDir("pilot-settings-empty-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(
				filePath,
				JSON.stringify({
					packages: ["skill-a", "", "  ", "skill-b"],
				}),
			);
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, ["skill-a", "skill-b"]);
		});
	});

	test("calls logDebug with error context when JSON is invalid", () => {
		withTmpDir("pilot-settings-log-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(filePath, "not-valid-json");
			const debugLogs: any[][] = [];
			readPackageSourcesFromSettingsFile(filePath, (...args: any[]) => debugLogs.push(args));
			assert.strictEqual(debugLogs.length, 1);
			assert.ok(
				debugLogs[0][0].includes("Failed to read package sources"),
				`expected debug log message to contain error context, got: ${debugLogs[0][0]}`,
			);
		});
	});

	test("does not throw when logDebug is undefined and JSON is invalid", () => {
		withTmpDir("pilot-settings-nolog-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(filePath, "not-valid-json");
			assert.doesNotThrow(() => {
				readPackageSourcesFromSettingsFile(filePath, undefined);
			});
		});
	});

	test("returns empty array when packages array contains only empty-string or null entries", () => {
		withTmpDir("pilot-settings-all-empty-", (tmpDir) => {
			const filePath = path.join(tmpDir, "settings.json");
			fs.writeFileSync(
				filePath,
				JSON.stringify({
					packages: ["", "   ", null],
				}),
			);
			const result = readPackageSourcesFromSettingsFile(filePath);
			assert.deepStrictEqual(result, []);
		});
	});
});
