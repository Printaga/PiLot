/**
 * Native addon compatibility checker.
 *
 * Detects ABI mismatches between compiled native modules (.node files)
 * and the current Electron/Node.js runtime. Provides auto-repair by
 * rebuilding better-sqlite3 for the detected Electron version.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

/**
 * Known Node.js module version -> Node.js major mapping.
 * Updated for Node.js 18 through 27.
 */
const NODE_MODULE_VERSIONS: Record<number, string> = {
	108: "18.x",
	115: "20.x",
	127: "22.x",
	137: "24.x",
	140: "26.x",
	142: "27.x",
};

/**
 * Paths where better-sqlite3 might be installed in the PI agent's npm.
 */
function findBetterSqlite3Paths(): string[] {
	const candidates: string[] = [];
	const home = os.homedir();

	// PI agent global npm
	const piNpmDir = path.join(home, ".pi", "agent", "npm", "node_modules");
	if (fs.existsSync(piNpmDir)) {
		candidates.push(path.join(piNpmDir, "better-sqlite3"));
	}

	// Nested inside pi-code-intelligence
	const ciDir = path.join(
		piNpmDir,
		"@catdaemon",
		"pi-code-intelligence",
		"node_modules",
		"better-sqlite3",
	);
	if (fs.existsSync(ciDir)) {
		candidates.push(ciDir);
	}

	return candidates;
}

/**
 * Get the current Electron/Node.js runtime ABI.
 * Inside VS Code extension host (Electron), this gives the Electron Node.js ABI.
 * On system Node.js, gives the system Node.js ABI.
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

/**
 * Check if a better-sqlite3 installation has a compiled module for the current ABI.
 */
export function checkBetterSqlite3(paths?: string[]): {
	ok: boolean;
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

	for (const betterDir of searchPaths) {
		if (!fs.existsSync(betterDir)) continue;

		const buildDir = path.join(betterDir, "build", "Release");
		const nodeFile = path.join(buildDir, "better_sqlite3.node");

		if (fs.existsSync(nodeFile)) {
			const content = fs.readFileSync(nodeFile, "utf-8");
			const match = content.match(/node_register_module_v(\d+)/);
			if (match) {
				const abi = parseInt(match[1], 10);
				return {
					ok: abi === runtimeABI,
					modulePath: nodeFile,
					moduleABI: abi,
					runtimeABI,
					runtimeNode,
					electronVersion,
				};
			}
		}
	}

	return {
		ok: false,
		modulePath: null,
		moduleABI: null,
		runtimeABI,
		runtimeNode,
		electronVersion,
	};
}

/**
 * Rebuild better-sqlite3 for the current Electron/Node.js ABI.
 *
 * Uses `node-gyp rebuild` with the correct Electron target when running
 * inside an Electron process, or with the system Node.js otherwise.
 */
export function rebuildBetterSqlite3(): { success: boolean; output: string } {
	const paths = findBetterSqlite3Paths();
	const targetDir = paths[0];
	if (!targetDir || !fs.existsSync(targetDir)) {
		return {
			success: false,
			output: "better-sqlite3 not found in PI agent npm",
		};
	}

	const electronVersion = getElectronVersion();
	const isElectron = !!electronVersion;

	try {
		const args: string[] = ["rebuild"];
		if (isElectron && electronVersion) {
			args.push(`--target=${electronVersion}`);
			args.push("--arch=x64");
			args.push("--dist-url=https://electronjs.org/headers");
		}

		const result = execSync(`npx --yes node-gyp ${args.join(" ")}`, {
			cwd: targetDir,
			timeout: 120_000,
			maxBuffer: 1024 * 1024,
		});

		return { success: true, output: result.toString() };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, output: message };
	}
}

/**
 * Check ABI and auto-rebuild if mismatched.
 * Returns true if OK or successfully rebuilt.
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
	if (rebuildResult.success) {
		// Verify the rebuild fixed it
		const verify = checkBetterSqlite3();
		if (verify.ok) {
			return { ok: true, rebuilt: true, output: rebuildResult.output };
		}
	}
	return { ok: false, rebuilt: false, output: rebuildResult.output };
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
