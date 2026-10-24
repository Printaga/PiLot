import * as assert from "node:assert";
import { createRequire } from "node:module";

// The loader copies this dependency-free CJS module into dist next to
// loader.cjs; the test reads the source copy so both stay in sync.
const requireSource = createRequire(import.meta.url);
const { MIN_PI_SDK_VERSION, isVersionAtLeast, pickNewestVersion } = requireSource(
	"../../../../src/loader-version.cjs",
) as {
	MIN_PI_SDK_VERSION: string;
	isVersionAtLeast: (actual: unknown, minimum: unknown) => boolean;
	pickNewestVersion: <T extends { version: unknown }>(candidates: T[]) => T | null;
};

suite("loader-version", () => {
	test("floor is PI 1.4.0", () => {
		assert.strictEqual(MIN_PI_SDK_VERSION, "1.4.0");
	});

	test("accepts the floor and newer versions", () => {
		for (const version of ["1.4.0", "1.4.1", "1.5.0", "2.0.0", "v1.4.0", " 1.4.0 "]) {
			assert.strictEqual(isVersionAtLeast(version, MIN_PI_SDK_VERSION), true, version);
		}
	});

	test("rejects older versions", () => {
		for (const version of ["1.3.9", "1.4", "1.0.0", "0.84.2", "0.99.0"]) {
			assert.strictEqual(isVersionAtLeast(version, MIN_PI_SDK_VERSION), false, version);
		}
	});

	test("rejects missing or malformed versions", () => {
		for (const version of [null, undefined, "", "latest", "1.x.0", {}]) {
			assert.strictEqual(
				isVersionAtLeast(version, MIN_PI_SDK_VERSION),
				false,
				String(version),
			);
		}
	});

	test("rejects a malformed minimum instead of accepting everything", () => {
		assert.strictEqual(isVersionAtLeast("1.4.0", "not-a-version"), false);
	});

	test("ranks versions by numeric segment, not lexically", () => {
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/1.9.0", version: "1.9.0" },
				{ path: "/1.10.0", version: "1.10.0" },
			])?.path,
			"/1.10.0",
		);
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/v1.4.0", version: "v1.4.0" },
				{ path: "/1.3.9", version: "1.3.9" },
			])?.path,
			"/v1.4.0",
		);
	});

	test("picks the newest installed SDK over an older sibling", () => {
		// The reported regression: mise keeps both versions on disk and the scan
		// happened to hit 0.87.1 first, so activation demanded an update the user
		// had already installed.
		const picked = pickNewestVersion([
			{ path: "/old", version: "0.87.1" },
			{ path: "/new", version: "1.4.0" },
		]);
		assert.strictEqual(picked?.path, "/new");
	});

	test("keeps discovery order for equal versions and empty input", () => {
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/first", version: "1.4.0" },
				{ path: "/second", version: "1.4.0" },
			])?.path,
			"/first",
		);
		assert.strictEqual(pickNewestVersion([]), null);
	});

	test("treats an unreadable version as a fallback, never as a winner", () => {
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/unknown", version: null },
				{ path: "/known", version: "1.4.0" },
			])?.path,
			"/known",
		);
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/known", version: "1.4.0" },
				{ path: "/unknown", version: null },
			])?.path,
			"/known",
		);
		// A non-empty placeholder is unreadable for ranking too: "latest" must
		// not outrank a real 1.4.0 just because it is a truthy string.
		for (const placeholder of ["latest", "beta", "1.4"]) {
			assert.strictEqual(
				pickNewestVersion([
					{ path: "/placeholder", version: placeholder },
					{ path: "/known", version: "1.4.0" },
				])?.path,
				"/known",
				placeholder,
			);
		}
		// All unreadable: the first discovered install is still returned so the
		// version gate can report what it found.
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/a", version: null },
				{ path: "/b", version: null },
			])?.path,
			"/a",
		);
		assert.strictEqual(
			pickNewestVersion([
				{ path: "/a", version: "latest" },
				{ path: "/b", version: "beta" },
			])?.path,
			"/a",
		);
	});
});
