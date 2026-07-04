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
import { execSync } from "node:child_process";

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
	140: "22.x (Electron build)",
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

		const nodeFile = path.join(
			betterDir,
			"build",
			"Release",
			"better_sqlite3.node",
		);
		if (fs.existsSync(nodeFile)) {
			const content = fs.readFileSync(nodeFile, "utf-8");
			const match = content.match(/node_register_module_v(\d+)/);
			const abi = match ? parseInt(match[1], 10) : null;
			const compatible = abi === runtimeABI;
			const status: CopyStatus = {
				dir: betterDir,
				nodeFile,
				moduleABI: abi,
				compatible,
			};
			copies.push(status);
			if (!compatible && !firstMismatch) {
				firstMismatch = status;
			}
		} else {
			copies.push({
				dir: betterDir,
				nodeFile: null,
				moduleABI: null,
				compatible: false,
			});
			if (!firstMismatch) {
				firstMismatch = {
					dir: betterDir,
					nodeFile: null,
					moduleABI: null,
					compatible: false,
				};
			}
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
 */
function tryPrebuildInstall(
	targetDir: string,
	electronVersion: string,
): string | null {
	try {
		const result = execSync(
			`npx --yes prebuild-install --runtime electron --target ${electronVersion} --arch x64`,
			{ cwd: targetDir, timeout: 30_000, maxBuffer: 256 * 1024 },
		);
		return result.toString();
	} catch {
		return null; // prebuild not available
	}
}

/**
 * Rebuild a single better-sqlite3 directory for the Electron ABI.
 * Tries prebuild-install first (fast download), then node-gyp (compilation).
 */
function rebuildOnePath(targetDir: string): {
	success: boolean;
	output: string;
} {
	const electronVersion = getElectronVersion();
	const isElectron = !!electronVersion;

	// Strategy 1: prebuild-install (fast — downloads prebuilt binary)
	if (isElectron && electronVersion) {
		const prebuildResult = tryPrebuildInstall(targetDir, electronVersion);
		if (prebuildResult !== null) {
			return { success: true, output: prebuildResult };
		}
	}

	// Strategy 2: node-gyp rebuild (slow — compiles from source)
	try {
		const args: string[] = ["rebuild"];
		if (isElectron && electronVersion) {
			args.push(`--target=${electronVersion}`);
			args.push("--arch=x64");
			args.push("--dist-url=https://electronjs.org/headers");
		}

		const result = execSync(`npx --yes node-gyp ${args.join(" ")}`, {
			cwd: targetDir,
			timeout: 300_000, // 5 min — sqlite3.c is huge
			maxBuffer: 2 * 1024 * 1024,
		});

		return { success: true, output: result.toString() };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, output: message };
	}
}

/**
 * Rebuild all incompatible better-sqlite3 copies for the current runtime.
 *
 * For v11.x copies that can't compile against newer Electron versions,
 * we fall back to replacing them with the top-level v12.x copy (if available).
 */
export function rebuildBetterSqlite3(): {
	success: boolean;
	output: string;
	/** Per-copy rebuild results. */
	results: Array<{ dir: string; success: boolean; output: string }>;
} {
	const status = checkBetterSqlite3();
	const results: Array<{ dir: string; success: boolean; output: string }> = [];
	let allOk = true;
	const outputParts: string[] = [];

	for (const copy of status.copies) {
		if (copy.compatible) {
			results.push({
				dir: copy.dir,
				success: true,
				output: "already compatible",
			});
			continue;
		}

		// Try rebuilding
		const result = rebuildOnePath(copy.dir);
		results.push({ dir: copy.dir, ...result });

		if (result.success) {
			// Verify
			const verify = readABI(copy.dir);
			if (verify === status.runtimeABI) {
				outputParts.push(
					`${path.basename(path.dirname(copy.dir))}/${path.basename(copy.dir)}: rebuilt OK`,
				);
				continue;
			}
			outputParts.push(
				`${copy.dir}: rebuild succeeded but ABI still mismatched`,
			);
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
						output: "upgraded to v12.x",
					};
					outputParts.push(`${copy.dir}: upgraded to v12.x, ABI OK`);
					continue;
				}
			}
			outputParts.push(
				`${copy.dir}: rebuild failed (${result.output.slice(0, 200)})`,
			);
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

/**
 * Read the ABI version from a compiled better_sqlite3.node file.
 */
function readABI(targetDir: string): number | null {
	const nodeFile = path.join(
		targetDir,
		"build",
		"Release",
		"better_sqlite3.node",
	);
	if (!fs.existsSync(nodeFile)) return null;
	const content = fs.readFileSync(nodeFile, "utf-8");
	const match = content.match(/node_register_module_v(\d+)/);
	return match ? parseInt(match[1], 10) : null;
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
		const home = os.homedir();
		const topLevel = path.join(
			home,
			".pi",
			"agent",
			"npm",
			"node_modules",
			"better-sqlite3",
		);
		if (!fs.existsSync(topLevel)) return false;
		const topPkg = JSON.parse(
			fs.readFileSync(path.join(topLevel, "package.json"), "utf-8"),
		);
		const topMajor = parseInt(topPkg.version?.split(".")[0] ?? "0", 10);
		if (topMajor < 12) return false;

		// Replace broken v11 with symlink to top-level v12
		fs.rmSync(brokenDir, { recursive: true, force: true });
		fs.symlinkSync(topLevel, brokenDir, "dir");
		return true;
	} catch {
		return false;
	}
}

/**
 * Check ABI and auto-rebuild if mismatched.
 * Returns true if all copies are OK or were successfully rebuilt.
 */
export function ensureBetterSqlite3Compatible(): {
	ok: boolean;
	rebuilt: boolean;
	output: string;
} {
	const status = checkBetterSqlite3();
	if (status.ok) {
		return { ok: true, rebuilt: false, output: "ABI compatible" };
	}

	const rebuildResult = rebuildBetterSqlite3();
	const anyRebuilt = rebuildResult.results.some(
		(r) => r.success && !r.output.includes("already compatible"),
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
export function describeABIStatus(
	runtimeABI: number,
	moduleABI: number | null,
): string {
	const runtimeName =
		NODE_MODULE_VERSIONS[runtimeABI] || `unknown (${runtimeABI})`;
	if (moduleABI === null) {
		return `Runtime Node.js ${runtimeName} (ABI ${runtimeABI}), no compiled module found`;
	}
	const moduleName =
		NODE_MODULE_VERSIONS[moduleABI] || `unknown (${moduleABI})`;
	return `Runtime Node.js ${runtimeName} (ABI ${runtimeABI}), module compiled for ${moduleName} (ABI ${moduleABI})`;
}
