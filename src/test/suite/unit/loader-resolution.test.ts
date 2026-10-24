// Regression proof for PI SDK discovery when more than one install exists.
//
// Package managers never replace an old PI install, they add a new one beside
// it: `mise upgrade` leaves `.../npm-earendil-works-pi-coding-agent/{0.87.1,1.4.0}`
// (plus `0`/`1`/`latest` symlink aliases), and pnpm's global store keeps one
// tree per Node version. Directory iteration order is arbitrary, so a loader
// that takes the first install it finds can load a stale SDK while
// `pi --version` reports the new one — the reported failure was exactly
// "Found PI 0.87.1 ... Run pi update" on a machine that already had 1.4.0.
//
// The loader cannot be imported in-process: src/loader.cjs ends in
// `module.exports = load()`, which resolves immediately and then requires the
// extension bundle. So each case copies the two real loader files (the same
// files dist/ ships) next to a stub bundle into a scratch directory and runs
// them in a child Node process with a fake HOME. The driver reports
// `Module._resolveFilename.__pillotSdkRoot`, the directory the loader actually
// hooked, so the assertion is about the chosen SDK and not about log wording.
//
// Explicit locations (`pi-agent.binaryPath`, `PI_HOME`) are asserted through
// the activation message instead: an intentionally old override fails the
// version gate before the SDK root is hooked, and the message naming that path
// is what proves the override outranked the newer install.

import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const sourceLoader = fileURLToPath(new URL("../../../../src/loader.cjs", import.meta.url));
const sourceLoaderVersion = fileURLToPath(
	new URL("../../../../src/loader-version.cjs", import.meta.url),
);

const STUB_EXTENSION = "module.exports = { activate() {}, deactivate() {} };\n";

// The sandbox is applied *inside* the child, after Node has started: the host
// that launches it still needs the real HOME (mise shims resolve their own
// installs through it) and the real PATH. Only the loader must see the fake
// home and an empty PATH, or a developer's actual global PI install could leak
// into the "nothing installed" case through the `which pi`/`npm root -g` probes.
const DRIVER = [
	'const sandbox = JSON.parse(process.env.PILOT_TEST_ENV || "{}");',
	'for (const key of ["HOME", "USERPROFILE", "PATH", "PI_HOME", "PI_AGENT_DIR"]) delete process.env[key];',
	"Object.assign(process.env, sandbox);",
	'const Module = require("module");',
	'require("./loader.cjs");',
	"const root = Module._resolveFilename && Module._resolveFilename.__pillotSdkRoot;",
	"const install = globalThis.__pillotSdkNodeModules || null;",
	'process.stdout.write("RESULT:" + JSON.stringify({ sdkRoot: root || null, sdkInstall: install }) + "\\n");',
].join("\n");

type LoaderRun = { sdkRoot: string | null; sdkInstall: string | null; output: string };

const scratchDirs: string[] = [];

function scratchDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

let cachedNode: string | undefined;

/**
 * An absolute Node executable, or a clear failure.
 *
 * `process.execPath` is Node in the plain-Node lane but the Electron editor
 * inside the VS Code host, and a standalone pnpm binary sets
 * `npm_node_execpath` to *itself* (spawning it with a script path makes pnpm
 * look for a project). Only a file whose own name is `node` can be the runtime
 * — that also keeps a `pnpm`/`code`/`Electron` path from being probed at all —
 * and a `--version` probe confirms the file actually starts. The probe runs in
 * the parent's environment, where a mise/volta/asdf `node` shim still resolves.
 */
function nodeExecutable(): string {
	if (cachedNode) return cachedNode;
	const fromPath = (process.env.PATH || "")
		.split(path.delimiter)
		.filter((dir) => dir.length > 0)
		.map((dir) => path.join(dir, process.platform === "win32" ? "node.exe" : "node"));
	for (const candidate of [process.execPath, process.env.npm_node_execpath, ...fromPath]) {
		if (!candidate || !path.isAbsolute(candidate)) continue;
		if (!/^node(\.exe)?$/i.test(path.basename(candidate))) continue;
		const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10_000 });
		if (!probe.error && probe.status === 0 && /^v\d+\./m.test(probe.stdout ?? "")) {
			cachedNode = candidate;
			return candidate;
		}
	}
	throw new Error(
		"no Node executable found for the loader harness; expected `node --version` to work",
	);
}

/** Normalize for assertions: /tmp and /var are symlinks on macOS. */
function real(dir: string | null): string | null {
	if (!dir) return null;
	try {
		return fs.realpathSync(dir);
	} catch {
		return dir;
	}
}

/** Minimal PI install: discovery only needs the SDK package manifest on disk. */
function fakePiInstall(nodeModules: string, version: string): string {
	const sdk = path.join(nodeModules, "@earendil-works", "pi-coding-agent");
	fs.mkdirSync(sdk, { recursive: true });
	fs.writeFileSync(
		path.join(sdk, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }),
	);
	return nodeModules;
}

/** One mise install directory, laid out the way `mise use` writes it. */
function miseInstall(home: string, version: string): string {
	return fakePiInstall(
		path.join(
			home,
			".local",
			"share",
			"mise",
			"installs",
			"npm-earendil-works-pi-coding-agent",
			version,
			"node_modules",
		),
		version,
	);
}

function runLoader(
	home: string,
	options: { vscodeBinaryPath?: string; env?: Record<string, string> } = {},
): LoaderRun {
	const harness = scratchDir("pilot-loader-");
	fs.copyFileSync(sourceLoader, path.join(harness, "loader.cjs"));
	fs.copyFileSync(sourceLoaderVersion, path.join(harness, "loader-version.cjs"));
	fs.writeFileSync(path.join(harness, "extension.cjs"), STUB_EXTENSION);
	fs.writeFileSync(path.join(harness, "run.cjs"), DRIVER);

	if (options.vscodeBinaryPath) {
		// `require("vscode")` resolves from the harness, so the real setting can
		// never leak into the case (and a real host has no such file at all).
		const fakeVscode = path.join(harness, "node_modules", "vscode");
		fs.mkdirSync(fakeVscode, { recursive: true });
		fs.writeFileSync(
			path.join(fakeVscode, "index.js"),
			"module.exports = { workspace: { getConfiguration: () => ({ get: () => " +
				JSON.stringify(options.vscodeBinaryPath) +
				" }) } };\n",
		);
	}

	// An empty bin directory keeps `which pi`, `npm root -g` and `pnpm root -g`
	// from reaching a real install the way they would on a developer machine.
	const emptyBin = path.join(harness, "empty-bin");
	fs.mkdirSync(emptyBin);
	const sandbox: Record<string, string> = { HOME: home, PATH: emptyBin, ...options.env };

	const result = spawnSync(nodeExecutable(), [path.join(harness, "run.cjs")], {
		cwd: harness,
		encoding: "utf8",
		timeout: 20_000,
		env: { ...process.env, PILOT_TEST_ENV: JSON.stringify(sandbox) },
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	assert.ifError(result.error);
	assert.strictEqual(result.status, 0, `the loader driver failed:\n${output}`);

	const report = /^RESULT:(.*)$/m.exec(output);
	assert.ok(report, `the driver produced no result line:\n${output}`);
	const parsed = JSON.parse(report[1]) as {
		sdkRoot: string | null;
		sdkInstall: string | null;
	};
	return { sdkRoot: parsed.sdkRoot, sdkInstall: parsed.sdkInstall, output };
}

suite("loader PI SDK resolution", () => {
	suiteTeardown(() => {
		for (const dir of scratchDirs) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// Best effort: a leftover temp dir must not fail the run.
			}
		}
	});

	test("a stale install earlier in the search order cannot shadow the newer one", () => {
		// Deterministic form of the reported bug: `~/.pi` is probed before mise,
		// so first-hit-wins always loaded 0.87.1 here even though 1.4.0 was the
		// newest install on the machine.
		const home = scratchDir("pilot-home-");
		const stale = fakePiInstall(
			path.join(home, ".pi", "agent", "npm", "node_modules"),
			"0.87.1",
		);
		const current = miseInstall(home, "1.4.0");

		const run = runLoader(home);

		assert.strictEqual(real(run.sdkRoot), real(current), run.output);
		assert.notStrictEqual(real(run.sdkRoot), real(stale));
	});

	test("the mise version scan keeps every version and selects the newest", () => {
		const home = scratchDir("pilot-home-");
		// Oldest first, the history `mise upgrade` leaves on disk.
		miseInstall(home, "0.84.2");
		miseInstall(home, "0.87.1");
		const current = miseInstall(home, "1.4.0");

		const run = runLoader(home);

		assert.strictEqual(real(run.sdkRoot), real(current), run.output);
		assert.match(run.output, /Using global PI SDK from:/);
		// The install the SDK came from is published for the CLI lookup, so the
		// spawned `pi` can belong to the same installation rather than a different
		// one found by probing well-known paths.
		assert.strictEqual(real(run.sdkInstall), real(current), run.output);
	});

	test("pi-agent.binaryPath pointing at an older install still wins", () => {
		const home = scratchDir("pilot-home-");
		const explicit = miseInstall(home, "0.87.1");
		miseInstall(home, "1.4.0");
		const shim = path.join(scratchDir("pilot-bin-"), "pi");
		fs.writeFileSync(
			shim,
			"# aube-bin-shim v2 target=" +
				path.join(
					explicit,
					"@earendil-works",
					"pi-coding-agent",
					"dist",
					"bundle",
					"cli.js",
				) +
				"\n",
		);

		const run = runLoader(home, { vscodeBinaryPath: shim });

		assert.ok(run.output.includes("Using global PI SDK from: " + real(explicit)), run.output);
		assert.ok(
			run.output.includes("Unsupported PI SDK version 0.87.1 at " + real(explicit)),
			run.output,
		);
	});

	test("PI_HOME pointing at an older install still wins", () => {
		const home = scratchDir("pilot-home-");
		miseInstall(home, "1.4.0");
		const piHome = scratchDir("pilot-pi-home-");
		const explicit = fakePiInstall(path.join(piHome, "node_modules"), "0.87.1");

		const run = runLoader(home, { env: { PI_HOME: piHome } });

		assert.ok(run.output.includes("Using global PI SDK from: " + real(explicit)), run.output);
		assert.ok(
			run.output.includes("Unsupported PI SDK version 0.87.1 at " + real(explicit)),
			run.output,
		);
	});

	test("a single old install still reports the update instead of passing silently", () => {
		// The negative half of the fix: choosing the newest must never turn a
		// genuinely outdated machine into a false pass.
		const home = scratchDir("pilot-home-");
		miseInstall(home, "0.87.1");

		const run = runLoader(home);

		assert.strictEqual(run.sdkRoot, null, run.output);
		assert.match(run.output, /Unsupported PI SDK version 0\.87\.1/);
		assert.match(run.output, /need 1\.4\.0\+/);
	});

	test("an empty home reports no install rather than inventing one", () => {
		const run = runLoader(scratchDir("pilot-home-"));

		assert.strictEqual(run.sdkRoot, null, run.output);
		assert.match(run.output, /PI SDK not found/);
		assert.doesNotMatch(run.output, /Using global PI SDK from/);
	});
});
