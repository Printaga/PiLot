#!/usr/bin/env node
/**
 * Verification orchestrator (see AGENTS.md "Verification policy").
 *
 * Levels:
 *   node scripts/verify.mjs             -> fast checks (default; exposed as `pnpm verify`)
 *   node scripts/verify.mjs verify:full -> fast checks + build + E2E (`pnpm verify:full`)
 *
 * Contract:
 *   - fails fast on the first failing stage;
 *   - reports the failing stage clearly;
 *   - preserves real exit codes and never converts failure into success;
 *   - safe to run repeatedly and in CI; no prompts, no global binaries.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import process from "node:process";

// Prefer the package manager that launched us (npm_execpath is set by
// pnpm/npm) so a global `pnpm` binary is not required, and always spawn node
// via process.execPath so PATH cannot select a different runtime.
// npm_execpath is a JS entrypoint for npm/yarn/corepack-installed pnpm, but
// the standalone pnpm build (@pnpm/exe) is a native binary — spawning node on
// an ELF file fails with a SyntaxError, so executables run directly.
const npmExecpath = process.env.npm_execpath;
const runScript = (script) => {
	if (!npmExecpath) return { cmd: "pnpm", args: ["run", script] };
	const isJsEntrypoint = /\.(?:c|m)?js$/i.test(npmExecpath);
	return isJsEntrypoint
		? { cmd: process.execPath, args: [npmExecpath, "run", script] }
		: { cmd: npmExecpath, args: ["run", script] };
};

const STAGES = {
	check: runScript("check"),
	lint: runScript("lint"),
	"format:check": runScript("format:check"),
	"test:unit": runScript("test:unit"),
	"test:webview": runScript("test:webview"),
	"fallow:audit": { cmd: process.execPath, args: ["scripts/fallow-audit.mjs"] },
	build: runScript("build"),
	"test:e2e": runScript("test:e2e"),
};

// verify:full derives from the fast chain so the two lists cannot drift.
const FAST_STAGES = ["check", "lint", "format:check", "test:unit", "test:webview", "fallow:audit"];

const LEVELS = {
	verify: FAST_STAGES,
	// Build runs BEFORE the test stages: the REALHOST webview CSP suite boots
	// the shipped webview (dist/webview/index.html) and test:e2e needs the
	// extension bundle, so the artifacts must exist before the suites load.
	"verify:full": [...FAST_STAGES.slice(0, 3), "build", ...FAST_STAGES.slice(3), "test:e2e"],
};

const level = process.argv[2] ?? "verify";
const chain = LEVELS[level];
if (!chain) {
	console.error(
		`Unknown verification level: ${level}. Use one of: ${Object.keys(LEVELS).join(", ")}.`,
	);
	process.exit(2);
}

console.log(`== verify (${level}): ${chain.join(" -> ")}\n`);
for (const stage of chain) {
	const stageDef = STAGES[stage];
	// A stage referenced by a level but missing from STAGES (typo, or a stage
	// removed from STAGES but left in a level) must fail clearly, not throw.
	if (!stageDef) {
		console.error(`\n✖ verify (${level}) has no definition for stage "${stage}".`);
		process.exit(2);
	}
	const { cmd, args } = stageDef;
	console.log(`--> [${stage}] ${cmd} ${args.join(" ")}`);
	const result = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	// Distinguish the three failure shapes a spawn can produce; collapsing them
	// into one code masks e.g. a SIGKILL'd stage as an ordinary nonzero exit.
	if (result.error) {
		console.error(
			`\n✖ verify (${level}) failed at stage "${stage}": could not run ${cmd} (${result.error.message}).`,
		);
		process.exit(3);
	}
	if (result.signal) {
		// Shell convention 128+signum keeps the signal visible and distinct
		// from a usage error.
		const signum = os.constants.signals[result.signal] ?? 0;
		console.error(
			`\n✖ verify (${level}) stage "${stage}" was terminated by signal ${result.signal}.`,
		);
		process.exit(signum > 0 ? 128 + signum : 2);
	}
	const code = result.status;
	if (code !== 0) {
		console.error(`\n✖ verify (${level}) failed at stage "${stage}" (exit ${code ?? "none"}).`);
		// Exit codes are truncated to 8 bits by the OS; a stage exiting with a
		// multiple of 256 must not be reported as success.
		process.exit(typeof code === "number" && code > 0 && code < 256 ? code : 1);
	}
	console.log(`<-- [${stage}] ok\n`);
}

console.log(`✔ verify (${level}) passed: ${chain.length} stages.`);
