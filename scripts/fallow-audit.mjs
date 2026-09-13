#!/usr/bin/env node
/**
 * Fallow changed-code audit gate.
 *
 * Base ref resolution order:
 *   1. FALLOW_BASE_REF env var (set in CI or locally to override);
 *   2. git symbolic-ref refs/remotes/origin/HEAD (the repo's default branch);
 *   3. fallback: origin/main.
 *
 * Exit codes preserve Fallow's semantics:
 *   0 -> audit clean (gate passes);
 *   1 -> audit completed with findings (gate fails — a quality verdict);
 *   2 -> validation/runtime error (not a quality verdict; check the invocation).
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

function resolveBaseRef() {
	if (process.env.FALLOW_BASE_REF) return process.env.FALLOW_BASE_REF;
	const head = spawnSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
		encoding: "utf8",
	});
	if (head.status === 0 && head.stdout.trim()) return head.stdout.trim();
	return "origin/main";
}

const base = resolveBaseRef();
// The audit gate carries recorded baselines (fallow-baselines/, generated at
// the adopted main baseline) for dead-code/complexity/duplication, so the
// historical debt main already ships never gates new changes. CSS styling
// analytics is disabled for the gate only: it has no baseline mechanism, and
// after a full-tree Prettier normalization its base-snapshot attribution
// misclassifies main's inherited CSS findings as introduced. `pnpm run
// fallow:review` still reports styling health in full.
const args = [
	"exec",
	"fallow",
	"audit",
	"--base",
	base,
	"--format",
	"json",
	"--quiet",
	"--no-css",
	"--dead-code-baseline",
	"fallow-baselines/dead-code.json",
	"--health-baseline",
	"fallow-baselines/health.json",
	"--dupes-baseline",
	"fallow-baselines/dupes.json",
];
console.log(`fallow audit --base ${base}`);
const result = spawnSync("pnpm", args, { stdio: "inherit" });
const code = result.status ?? 2;
if (code === 1) {
	console.error(
		`\n✖ fallow audit gate FAILED (findings against ${base}). Fix the findings or agree on a recorded baseline before merging.`,
	);
	process.exit(1);
}
if (code !== 0) {
	console.error(
		`\n✖ fallow audit errored (exit ${code}) — not a quality verdict; check the Fallow invocation.`,
	);
	process.exit(code);
}
console.log("✔ fallow audit clean");
