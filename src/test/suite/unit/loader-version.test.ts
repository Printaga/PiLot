import * as assert from "node:assert";
import { createRequire } from "node:module";

// The loader copies this dependency-free CJS module into dist next to
// loader.cjs; the test reads the source copy so both stay in sync.
const requireSource = createRequire(import.meta.url);
const { MIN_PI_SDK_VERSION, isVersionAtLeast } = requireSource(
	"../../../../src/loader-version.cjs",
) as {
	MIN_PI_SDK_VERSION: string;
	isVersionAtLeast: (actual: unknown, minimum: unknown) => boolean;
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
});
