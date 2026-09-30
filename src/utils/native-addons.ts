/**
 * Native addon compatibility checker.
 *
 * Detects ABI mismatches between compiled native modules (.node files)
 * and the current Electron/Node.js runtime. Provides auto-repair by
 * rebuilding better-sqlite3 for the detected Electron version.
 *
 * We check ALL installed copies of better-sqlite3, not just the first one,
 * because pi-code-intelligence loads from its own nested node_modules/
 * which may differ from the top-level copy.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";

/**
 * Known Node.js module version -> Node.js major mapping.
 * Updated for Node.js 18 through 27.
 * NOTE: Electron builds use non-standard ABI versions.
 * E.g., Electron 39.8.8 ships Node v22.22.1 with ABI 140 (not 127).
 */
const NODE_MODULE_VERSIONS: Record<number, string> = {
	108: "18.x",
	115: "20.x",
	127: "22.x",
	137: "24.x",
	// Electron ABIs are not Node ABIs — label them as such instead of guessing
	// a Node major that the binary was never built for.
	140: "Electron build (unmapped to a Node major)",
	141: "25.x",
	142: "27.x",
};

/**
 * Paths where better-sqlite3 might be installed in the PI agent's npm.
 * Ordered by priority: the nested copy inside pi-code-intelligence comes
 * first because that's the one actually loaded at runtime.
 */
function findBetterSqlite3Paths(): string[] {
	const candidates: string[] = [];
	const home = os.homedir();
	const piNpmDir = path.join(home, ".pi", "agent", "npm", "node_modules");

	if (!fs.existsSync(piNpmDir)) return candidates;

	// The one pi-code-intelligence actually loads — check first
	const ciNested = path.join(
		piNpmDir,
		"@catdaemon",
		"pi-code-intelligence",
		"node_modules",
		"better-sqlite3",
	);
	if (fs.existsSync(ciNested)) {
		candidates.push(ciNested);
	}

	// Top-level copy (may be a different version)
	const topLevel = path.join(piNpmDir, "better-sqlite3");
	if (fs.existsSync(topLevel)) {
		candidates.push(topLevel);
	}

	return candidates;
}

/** Single source of truth for the top-level better-sqlite3 directory. */
function getTopLevelBetterSqlite3Dir(): string {
	return path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "better-sqlite3");
}

/**
 * Get the current Electron/Node.js runtime ABI.
 */
function getRuntimeABI(): number {
	return Number(process.versions.modules) || 0;
}

/**
 * Get the Electron version from the runtime (undefined when running on system Node).
 */
function getElectronVersion(): string | undefined {
	return (process.versions as Record<string, string>).electron;
}

/** Per-copy ABI status. */
export interface CopyStatus {
	dir: string;
	nodeFile: string | null;
	moduleABI: number | null;
	compatible: boolean;
}

/**
 * Read the ABI version from a compiled better_sqlite3.node file.
 *
 * Single shared implementation — previously the scan in `checkBetterSqlite3`
 * and this helper duplicated the same regex, and only one of the two was kept
 * in sync when the pattern changed.
 */
function readAbiFromNodeFile(nodeFile: string): number | null {
	if (!fs.existsSync(nodeFile)) return null;
	try {
		const stat = fs.statSync(nodeFile);
		// Read a bounded prefix: a .node binary can be tens of MB and this runs
		// on the extension-host startup path; the ABI symbol sits near the start.
		const fd = fs.openSync(nodeFile, "r");
		try {
			const PROBE_BYTES = 256 * 1024;
			const length = Math.min(stat.size, PROBE_BYTES);
			const buffer = Buffer.alloc(length);
			fs.readSync(fd, buffer, 0, length, 0);
			const content = buffer.toString("latin1");
			// Word-boundary anchor so an incidental "node_register_module_v12"
			// substring inside symbol/strings can't produce a false version.
			const match = content.match(/\bnode_register_module_v(\d+)\b/);
			return match ? Number.parseInt(match[1], 10) : null;
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return null;
	}
}

/**
 * Check all installed better-sqlite3 copies for ABI compatibility.
 * Returns the FIRST incompatible copy found, or ok:true if all are compatible.
 */
export function checkBetterSqlite3(paths?: string[]): {
	ok: boolean;
	/** All copies checked. */
	copies: CopyStatus[];
	modulePath: string | null;
	moduleABI: number | null;
	runtimeABI: number;
	runtimeNode: string;
	electronVersion: string | undefined;
} {
	const runtimeABI = getRuntimeABI();
	const runtimeNode = process.version;
	const electronVersion = getElectronVersion();
	const searchPaths = paths ?? findBetterSqlite3Paths();
	const copies: CopyStatus[] = [];
	let firstMismatch: CopyStatus | null = null;

	for (const betterDir of searchPaths) {
		if (!fs.existsSync(betterDir)) continue;

		const nodeFile = path.join(betterDir, "build", "Release", "better_sqlite3.node");
		const abi = readAbiFromNodeFile(nodeFile);
		const compatible = abi !== null && abi === runtimeABI;
		const status: CopyStatus = {
			dir: betterDir,
			nodeFile: abi !== null ? nodeFile : null,
			moduleABI: abi,
			compatible,
		};
		copies.push(status);
		if (!compatible && !firstMismatch) {
			firstMismatch = status;
		}
	}

	return {
		ok: firstMismatch === null && copies.length > 0,
		copies,
		modulePath: firstMismatch?.nodeFile ?? null,
		moduleABI: firstMismatch?.moduleABI ?? null,
		runtimeABI,
		runtimeNode,
		electronVersion,
	};
}

/**
 * Run prebuild-install in a better-sqlite3 directory to download a
 * prebuilt binary for the given Electron target.
 *
 * Values are passed as an argv array (no shell), so filesystem-derived
 * paths and version strings can never be reinterpreted as shell syntax.
 *
 * Resolved through require.resolve so this also works on Windows, where
 * npm only creates `.cmd` shims under node_modules/.bin, and so a missing
 * devDependency tool is reported as such instead of as a build failure.
 */
function tryPrebuildInstall(targetDir: string, electronVersion: string): Promise<string | null> {
	const toolEntry = resolveToolEntry(targetDir, "prebuild-install");
	if (!toolEntry) return Promise.resolve(null); // tool not installed here
	return execFileAsync(
		process.execPath,
		[
			toolEntry,
			"--runtime",
			"electron",
			"--target",
			electronVersion,
			// Derive the architecture from the runtime: a hardcoded x64 downloads
			// the wrong binary on arm64 hosts.
			"--arch",
			process.arch,
		],
		{
			cwd: targetDir,
			timeout: 30_000,
			maxBuffer: 256 * 1024,
			windowsHide: true,
		},
	).then(
		(result) => result.stdout ?? "",
		() => null, // prebuild not available
	);
}

/**
 * Resolve a build tool's real JS entry point inside `targetDir`.
 * Returns null when the tool is not installed there (it is a devDependency
 * of better-sqlite3, so this is common and must not look like a failure).
 */
function resolveToolEntry(targetDir: string, toolName: string): string | null {
	try {
		// The package.json "bin" entry is the actual script node should run.
		const pkgJson = path.join(targetDir, "node_modules", toolName, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
		const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[toolName];
		if (!bin) return null;
		return path.join(targetDir, "node_modules", toolName, bin);
	} catch {
		return null;
	}
}

function execFileAsync(
	file: string,
	args: string[],
	options: { cwd: string; timeout?: number; maxBuffer?: number; windowsHide?: boolean },
): Promise<{ stdout?: string; stderr?: string }> {
	return new Promise((resolve, reject) => {
		execFile(file, args, options, (error, stdout, stderr) => {
			if (error) {
				// Preserve exit code/signal details from the execFile error.
				const err = error as Error & { code?: unknown; killed?: boolean; signal?: string };
				reject(
					Object.assign(new Error(err.message), {
						code: err.code,
						killed: err.killed,
						signal: err.signal,
					}),
				);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

/** argv for `node-gyp rebuild`, tagged with the Electron target when running inside Electron. */
function nodeGypArgs(electronVersion: string | undefined): string[] {
	const args: string[] = ["rebuild"];
	if (electronVersion) {
		args.push(`--target=${electronVersion}`);
		args.push(`--arch=${process.arch}`);
		args.push("--dist-url=https://electronjs.org/headers");
	}
	return args;
}

/** Outcome of one async rebuild attempt. */
interface RebuildOutcome {
	success: boolean;
	output: string;
	/** True when the tool was not installed at all (distinct from a build failure). */
	toolMissing: boolean;
}

/** Per-copy result action surfaced by rebuildBetterSqlite3(). */
export type RebuildAction = "already-ok" | "rebuilt" | "upgraded" | "failed";

/** Interpret one execFileAsync rejection for the node-gyp run. */
function nodeGypFailure(error: Error & { code?: unknown; signal?: string }): RebuildOutcome {
	const code = error.code;
	if (code === "ENOENT" || code === "EACCES") {
		return {
			success: false,
			output: `node-gyp is not available in this copy (${error.message})`,
			toolMissing: true,
		};
	}
	if (error.signal) {
		return {
			success: false,
			output: `node-gyp terminated by signal ${error.signal}`,
			toolMissing: false,
		};
	}
	if (typeof code === "number" && code !== 0) {
		return {
			success: false,
			output: `node-gyp exited with code ${code}: ${error.message.slice(0, 400)}`,
			toolMissing: false,
		};
	}
	return { success: false, output: error.message, toolMissing: false };
}

/**
 * Rebuild a single better-sqlite3 directory for the Electron ABI.
 * Tries prebuild-install first (fast download, only on an explicit,
 * user-requested rebuild), then node-gyp (compilation).
 * All child invocations use argv arrays (no shell) so environment-derived
 * values stay inert.
 *
 * `allowNetworkPrebuilds` must only be true when the user explicitly asked
 * for the repair: prebuild-install downloads a compiled native binary from
 * the network and unpacks it where the runtime will load it — that must not
 * happen unattended at activation time.
 */
async function rebuildOnePath(
	targetDir: string,
	allowNetworkPrebuilds: boolean,
): Promise<RebuildOutcome> {
	const electronVersion = getElectronVersion();

	// Strategy 1: prebuild-install (fast — downloads prebuilt binary)
	if (allowNetworkPrebuilds && electronVersion) {
		const prebuildResult = await tryPrebuildInstall(targetDir, electronVersion);
		// prebuild-install can exit 0 while downloading nothing (no prebuilt
		// binary for this Electron/arch combination); validate the binary
		// before declaring success so strategy 2 still runs.
		if (prebuildResult !== null && readABI(targetDir) === getRuntimeABI()) {
			return { success: true, output: prebuildResult, toolMissing: false };
		}
	}

	// Strategy 2: node-gyp rebuild (slow — compiles from source)
	try {
		const nodeGypEntry = resolveToolEntry(targetDir, "node-gyp");
		if (!nodeGypEntry) {
			return {
				success: false,
				output: "node-gyp is not installed in this better-sqlite3 copy",
				toolMissing: true,
			};
		}
		const result = await execFileAsync(
			process.execPath,
			[nodeGypEntry, ...nodeGypArgs(electronVersion)],
			{
				cwd: targetDir,
				timeout: 300_000, // 5 min — sqlite3.c is huge
				maxBuffer: 2 * 1024 * 1024,
				windowsHide: true,
			},
		);
		return { success: true, output: result.stdout?.toString() ?? "", toolMissing: false };
	} catch (error) {
		return nodeGypFailure(error as Error & { code?: unknown; signal?: string });
	}
}

/**
 * Rebuild all incompatible better-sqlite3 copies for the current runtime.
 *
 * For v11.x copies that can't compile against newer Electron versions,
 * we fall back to replacing them with the top-level v12.x copy (if available).
 */
export async function rebuildBetterSqlite3(
	options: { allowNetworkPrebuilds?: boolean } = {},
): Promise<{
	success: boolean;
	output: string;
	/** Per-copy rebuild results. */
	results: Array<{ dir: string; success: boolean; action: RebuildAction; output: string }>;
}> {
	const allowNetworkPrebuilds = options.allowNetworkPrebuilds ?? false;
	const status = checkBetterSqlite3();
	const results: Array<{ dir: string; success: boolean; action: RebuildAction; output: string }> =
		[];
	let allOk = true;
	const outputParts: string[] = [];

	for (const copy of status.copies) {
		if (copy.compatible) {
			results.push({
				dir: copy.dir,
				success: true,
				action: "already-ok",
				output: "already compatible",
			});
			continue;
		}

		// Try rebuilding
		const result = await rebuildOnePath(copy.dir, allowNetworkPrebuilds);
		if (result.success) {
			results.push({
				dir: copy.dir,
				success: true,
				action: "rebuilt",
				output: result.output,
			});
		} else {
			results.push({
				dir: copy.dir,
				success: false,
				action: "failed",
				output: result.output,
			});
		}

		if (result.success) {
			// Verify
			const verify = readABI(copy.dir);
			if (verify === status.runtimeABI) {
				outputParts.push(
					`${path.basename(path.dirname(copy.dir))}/${path.basename(copy.dir)}: rebuilt OK`,
				);
				continue;
			}
			// Keep the results entry consistent with reality: the copy is still
			// broken even though the compiler exited 0.
			results[results.length - 1] = {
				dir: copy.dir,
				success: false,
				action: "failed",
				output: "rebuild succeeded but ABI still mismatched",
			};
			outputParts.push(`${copy.dir}: rebuild succeeded but ABI still mismatched`);
			allOk = false;
		} else if (result.toolMissing) {
			// Tooling missing is a dead end for this copy: do NOT fall through to
			// the destructive v11->v12 swap because of a missing devDependency.
			outputParts.push(`${copy.dir}: rebuild failed (${result.output})`);
			allOk = false;
		} else {
			// v11.x can't compile for newer Electron — try upgrading to v12 via top-level copy
			const upgraded = tryUpgradeToV12(copy.dir);
			if (upgraded) {
				const verify = readABI(copy.dir);
				if (verify === status.runtimeABI) {
					results[results.length - 1] = {
						dir: copy.dir,
						success: true,
						action: "upgraded",
						output: "upgraded to v12.x",
					};
					outputParts.push(`${copy.dir}: upgraded to v12.x, ABI OK`);
					continue;
				}
			}
			outputParts.push(`${copy.dir}: rebuild failed (${result.output.slice(0, 200)})`);
			allOk = false;
		}
	}

	if (results.length === 0) {
		return {
			success: false,
			output: "No better-sqlite3 copies found",
			results,
		};
	}

	return { success: allOk, output: outputParts.join("\n"), results };
}

/** Read the ABI version from a compiled better_sqlite3.node file. */
function readABI(targetDir: string): number | null {
	return readAbiFromNodeFile(path.join(targetDir, "build", "Release", "better_sqlite3.node"));
}

/**
 * If the broken copy is v11.x, try to replace it with the top-level
 * v12.x copy which has broader Electron support.
 * Returns true if upgrade succeeded and ABI is now compatible.
 */
function tryUpgradeToV12(brokenDir: string): boolean {
	try {
		// Only attempt if the broken copy is v11
		const pkgJsonPath = path.join(brokenDir, "package.json");
		if (!fs.existsSync(pkgJsonPath)) return false;
		const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
		const major = parseInt(pkg.version?.split(".")[0] ?? "0", 10);
		if (major >= 12) return false; // already v12+, not a v11 issue

		// Find the top-level v12+ copy
		const topLevel = getTopLevelBetterSqlite3Dir();
		if (!fs.existsSync(topLevel)) return false;
		const topPkg = JSON.parse(fs.readFileSync(path.join(topLevel, "package.json"), "utf-8"));
		const topMajor = parseInt(topPkg.version?.split(".")[0] ?? "0", 10);
		if (topMajor < 12) return false;

		// Replace broken v11 with symlink to top-level v12 — move the broken copy
		// aside so it stays recoverable, and NEVER delete it: if it cannot be
		// moved aside, abort the upgrade instead of destroying the install.
		const backupDir = `${brokenDir}.bak-v11-${Date.now()}`;
		try {
			fs.renameSync(brokenDir, backupDir);
		} catch {
			return false;
		}
		try {
			fs.symlinkSync(topLevel, brokenDir, "dir");
			return true;
		} catch {
			// Symlink failed — restore the backup so nothing is lost.
			try {
				fs.renameSync(backupDir, brokenDir);
			} catch {
				/* best effort */
			}
			return false;
		}
	} catch {
		return false;
	}
}

/**
 * Check ABI and auto-rebuild if mismatched.
 * Returns true if all copies are OK or were successfully rebuilt.
 *
 * The automatic startup path never downloads prebuilt binaries; the explicit
 * "Rebuild Native Addons" command may opt into that via `allowNetworkPrebuilds`.
 */
export async function ensureBetterSqlite3Compatible(
	options: { allowNetworkPrebuilds?: boolean } = {},
): Promise<{
	ok: boolean;
	rebuilt: boolean;
	output: string;
}> {
	const status = checkBetterSqlite3();
	if (status.copies.length === 0) {
		// Nothing installed — not an ABI problem and nothing to rebuild.
		return { ok: true, rebuilt: false, output: "No better-sqlite3 copies found" };
	}
	if (status.ok) {
		return { ok: true, rebuilt: false, output: "ABI compatible" };
	}

	const rebuildResult = await rebuildBetterSqlite3(options);
	// Discriminated action field instead of parsing free-text output for
	// "already compatible" (a build log could contain that phrase).
	const anyRebuilt = rebuildResult.results.some(
		(r) => r.success && (r.action === "rebuilt" || r.action === "upgraded"),
	);
	return {
		ok: rebuildResult.success,
		rebuilt: anyRebuilt,
		output: rebuildResult.output,
	};
}

/**
 * Human-readable description of ABI status.
 */
export function describeABIStatus(runtimeABI: number, moduleABI: number | null): string {
	const runtimeName = NODE_MODULE_VERSIONS[runtimeABI] || `unknown (${runtimeABI})`;
	if (moduleABI === null) {
		return `Runtime Node.js ${runtimeName} (ABI ${runtimeABI}), no compiled module found`;
	}
	const moduleName = NODE_MODULE_VERSIONS[moduleABI] || `unknown (${moduleABI})`;
	return `Runtime Node.js ${runtimeName} (ABI ${runtimeABI}), module compiled for ${moduleName} (ABI ${moduleABI})`;
}
