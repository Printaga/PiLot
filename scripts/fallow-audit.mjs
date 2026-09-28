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

/** Abort with the audit's "invocation error" exit code and a reason. */
function invocationError(reason) {
	console.error(`fallow-audit: ${reason}`);
	process.exit(2);
}

/** True when the probe never ran to completion (spawn failure or signal). */
function hasSpawnAnomaly(head) {
	return Boolean(head.error || head.signal);
}

/** Human-readable reason for a spawn anomaly (only valid after the check). */
function anomalyReason(head) {
	if (head.error) return `git probe failed: ${head.error.message}`;
	return `git probe terminated by signal ${head.signal}`;
}

/**
 * Read the probe result; null means "no answer" (non-zero status), while any
 * spawn failure or signal termination aborts with the invocation-error exit
 * code instead of silently degrading to the origin/main fallback.
 */
function probeAnswer(head) {
	if (hasSpawnAnomaly(head)) invocationError(anomalyReason(head));
	if (head.status === 0 && head.stdout.trim()) return head.stdout.trim();
	return null;
}

/** Probe the repo's default branch via git; null when unresolvable. */
function probeGitDefaultBranch() {
	const head = spawnSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
		encoding: "utf8",
	});
	// A signal-terminated or spawn-failed probe is not "no result": don't
	// silently fall through to origin/main with a generic code.
	return probeAnswer(head);
}

function envBaseRef() {
	return process.env.FALLOW_BASE_REF || null;
}

function resolveBaseRef() {
	return envBaseRef() ?? probeGitDefaultBranch() ?? "origin/main";
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
if (result.error) {
	console.error(`\n✖ fallow audit could not run pnpm: ${result.error.message}`);
	process.exit(2);
}
if (result.signal) {
	console.error(
		`\n✖ fallow audit terminated by signal ${result.signal} — not a quality verdict.`,
	);
	process.exit(2);
}
const code = result.status;
if (code === null) {
	console.error("\n✖ fallow audit exited without a status — check the Fallow invocation.");
	process.exit(2);
}
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
