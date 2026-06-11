// ── Unit tests for pi-binary Windows path resolution ──────────────────────

import * as assert from "assert";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
	resolvePiBinaryFromSetting,
	findPiBinary,
	parseInstalledPackages,
} from "../../../pi-binary.js";

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

	test("returns trimmed absolute path when it exists", () => {
		const tmpDir = os.tmpdir();
		const fakeBin = path.join(tmpDir, `pi-test-${Date.now()}`);
		fs.writeFileSync(fakeBin, "#!/bin/sh\necho test");
		try {
			const result = resolvePiBinaryFromSetting(fakeBin);
			assert.strictEqual(result, fakeBin);
		} finally {
			fs.unlinkSync(fakeBin);
		}
	});

	test("returns null for non-existent absolute path on non-Windows", () => {
		if (process.platform === "win32") return;
		const result = resolvePiBinaryFromSetting("/nonexistent/path/to/pi");
		assert.strictEqual(result, null);
	});

	test("returns bare name (no path separators) as-is", () => {
		const result = resolvePiBinaryFromSetting("pi-custom");
		assert.strictEqual(result, "pi-custom");
	});
});

suite("pi-binary: Windows .exe/.cmd suffix fallback", () => {
	test("returns path with .exe suffix when base path does not exist but .exe does (Windows)", () => {
		if (process.platform !== "win32") return;

		const tmpDir = os.tmpdir();
		const baseName = `pi-win-test-${Date.now()}`;
		const exePath = path.join(tmpDir, baseName + ".exe");
		fs.writeFileSync(exePath, "");
		try {
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, exePath);
		} finally {
			fs.unlinkSync(exePath);
		}
	});

	test("returns path with .cmd suffix when base and .exe don't exist but .cmd does (Windows)", () => {
		if (process.platform !== "win32") return;

		const tmpDir = os.tmpdir();
		const baseName = `pi-win-cmd-${Date.now()}`;
		const cmdPath = path.join(tmpDir, baseName + ".cmd");
		fs.writeFileSync(cmdPath, "");
		try {
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, cmdPath);
		} finally {
			fs.unlinkSync(cmdPath);
		}
	});

	test("prefers .exe over .cmd on Windows", () => {
		if (process.platform !== "win32") return;

		const tmpDir = os.tmpdir();
		const baseName = `pi-win-pref-${Date.now()}`;
		const exePath = path.join(tmpDir, baseName + ".exe");
		const cmdPath = path.join(tmpDir, baseName + ".cmd");
		fs.writeFileSync(exePath, "");
		fs.writeFileSync(cmdPath, "");
		try {
			const result = resolvePiBinaryFromSetting(path.join(tmpDir, baseName));
			assert.strictEqual(result, exePath);
		} finally {
			fs.unlinkSync(exePath);
			fs.unlinkSync(cmdPath);
		}
	});
});

suite("pi-binary: findPiBinary candidate paths", () => {
	test("returns a string (at minimum the fallback 'pi')", () => {
		const result = findPiBinary();
		assert.strictEqual(typeof result, "string");
		assert.ok(result.length > 0);
	});
});

suite("pi-binary: parseInstalledPackages", () => {
	test("parses empty output", () => {
		const result = parseInstalledPackages("");
		assert.deepStrictEqual(result, []);
	});

	test("parses 'No packages installed.'", () => {
		const result = parseInstalledPackages("No packages installed.");
		assert.deepStrictEqual(result, []);
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
	});
});
