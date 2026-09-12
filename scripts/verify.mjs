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
import process from "node:process";

const STAGES = {
	check: { cmd: "pnpm", args: ["run", "check"] },
	lint: { cmd: "pnpm", args: ["run", "lint"] },
	"format:check": { cmd: "pnpm", args: ["run", "format:check"] },
	"test:unit": { cmd: "pnpm", args: ["run", "test:unit"] },
	"test:webview": { cmd: "pnpm", args: ["run", "test:webview"] },
	"fallow:audit": { cmd: "node", args: ["scripts/fallow-audit.mjs"] },
	build: { cmd: "pnpm", args: ["run", "build"] },
	"test:e2e": { cmd: "pnpm", args: ["run", "test:e2e"] },
};

const LEVELS = {
	verify: ["check", "lint", "format:check", "test:unit", "test:webview", "fallow:audit"],
	"verify:full": [
		"check",
		"lint",
		"format:check",
		"test:unit",
		"test:webview",
		"fallow:audit",
		"build",
		"test:e2e",
	],
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
	const { cmd, args } = STAGES[stage];
	console.log(`--> [${stage}] ${cmd} ${args.join(" ")}`);
	const result = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	const code = result.status ?? 1;
	if (code !== 0) {
		console.error(`\n✖ verify (${level}) failed at stage "${stage}" (exit ${code}).`);
		process.exit(code);
	}
	console.log(`<-- [${stage}] ok\n`);
}

console.log(`✔ verify (${level}) passed: ${chain.length} stages.`);
