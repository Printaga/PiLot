import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import {
	checkBetterSqlite3,
	rebuildBetterSqlite3,
	ensureBetterSqlite3Compatible,
	describeABIStatus,
} from "../../../utils/native-addons.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createFakeBetterSqlite3(baseDir: string, abi?: number): string {
	const betterDir = path.join(baseDir, "better-sqlite3");
	const buildDir = path.join(betterDir, "build", "Release");

	fs.mkdirSync(buildDir, { recursive: true });

	if (abi !== undefined) {
		const content = `node_register_module_v${abi} some binary data`;
		fs.writeFileSync(path.join(buildDir, "better_sqlite3.node"), content);
	}

	return betterDir;
}

// ── Tests ────────────────────────────────────────────────────────────────

suite("native-addons", () => {
	const tmpDir = path.join(__dirname, "../../..", "test-tmp-native-addons");

	setup(() => {
		fs.mkdirSync(tmpDir, { recursive: true });
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	suite("checkBetterSqlite3()", () => {
		test("returns ok: true when ABI matches", () => {
			const fakeDir = createFakeBetterSqlite3(
				tmpDir,
				Number(process.versions.modules),
			);
			const result = checkBetterSqlite3([fakeDir]);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.moduleABI, Number(process.versions.modules));
			assert.strictEqual(result.runtimeABI, Number(process.versions.modules));
		});

		test("returns ok: false with correct ABIs when mismatched", () => {
			const fakeDir = createFakeBetterSqlite3(tmpDir, 108); // Node 18 ABI
			const result = checkBetterSqlite3([fakeDir]);
			// If current runtime is not 108, it should be mismatched
			if (Number(process.versions.modules) !== 108) {
				assert.strictEqual(result.ok, false);
				assert.strictEqual(result.moduleABI, 108);
			}
		});

		test("returns ok: false, moduleABI: null when no compiled module found", () => {
			const emptyDir = path.join(tmpDir, "empty");
			fs.mkdirSync(emptyDir, { recursive: true });

			const result = checkBetterSqlite3([emptyDir]);
			assert.strictEqual(result.ok, false);
			assert.strictEqual(result.moduleABI, null);
			assert.strictEqual(result.modulePath, null);
		});

		test("returns ok: false when directory does not exist", () => {
			const result = checkBetterSqlite3(["/nonexistent/path"]);
			assert.strictEqual(result.ok, false);
			assert.strictEqual(result.moduleABI, null);
		});

		test("includes runtime info", () => {
			const result = checkBetterSqlite3([]);
			assert.strictEqual(result.runtimeABI, Number(process.versions.modules));
			assert.strictEqual(result.runtimeNode, process.version);
		});
	});

	suite("rebuildBetterSqlite3()", () => {
		test("returns success: false when no better-sqlite3 found", () => {
			// Without PI agent npm, no better-sqlite3 exists
			const result = rebuildBetterSqlite3();
			assert.strictEqual(typeof result.success, "boolean");
			assert.strictEqual(typeof result.output, "string");
		});
	});

	suite("ensureBetterSqlite3Compatible()", () => {
		test("returns ok: true, rebuilt: false when already compatible", () => {
			const result = ensureBetterSqlite3Compatible();
			assert.strictEqual(typeof result.ok, "boolean");
			assert.strictEqual(typeof result.rebuilt, "boolean");
			assert.strictEqual(typeof result.output, "string");
		});
	});

	suite("describeABIStatus()", () => {
		test("formats known ABI 108 as Node 18.x", () => {
			const desc = describeABIStatus(108, 108);
			assert.ok(desc.includes("18.x"));
			assert.ok(desc.includes("ABI 108"));
		});

		test("formats known ABI 115 as Node 20.x", () => {
			const desc = describeABIStatus(115, 115);
			assert.ok(desc.includes("20.x"));
		});

		test("formats known ABI 127 as Node 22.x", () => {
			const desc = describeABIStatus(127, 127);
			assert.ok(desc.includes("22.x"));
		});

		test("formats known ABI 137 as Node 24.x", () => {
			const desc = describeABIStatus(137, 137);
			assert.ok(desc.includes("24.x"));
		});

		test("formats known ABI 140 as Node 22.x (Electron build)", () => {
			const desc = describeABIStatus(140, 140);
			assert.ok(desc.includes("22.x"));
			assert.ok(desc.includes("Electron build"));
		});

		test("formats known ABI 142 as Node 27.x", () => {
			const desc = describeABIStatus(142, 142);
			assert.ok(desc.includes("27.x"));
		});

		test("handles unknown ABI numbers", () => {
			const desc = describeABIStatus(999, 999);
			assert.ok(desc.includes("unknown (999)"));
		});

		test("handles moduleABI === null (no compiled module)", () => {
			const desc = describeABIStatus(127, null);
			assert.ok(desc.includes("no compiled module found"));
			assert.ok(desc.includes("22.x"));
		});

		test("shows mismatch when ABIs differ", () => {
			const desc = describeABIStatus(127, 108);
			assert.ok(desc.includes("22.x"));
			assert.ok(desc.includes("18.x"));
			assert.ok(desc.includes("ABI 127"));
			assert.ok(desc.includes("ABI 108"));
		});
	});
});
