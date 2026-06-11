// ── Pi binary resolution and package output parsing ─────────────────────────

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { stripAnsi } from "./utils/shell.js";

export type InstalledPackage = { source: string; path: string };

/** Enriched package info sent to the webview. */
export type EnrichedPackage = InstalledPackage & {
	description: string;
	version: string;
	types: string[];
	skills: Array<{ name: string; description: string }>;
	extensions: Array<{ path: string; sourceName: string | null }>;
	prompts: Array<{ name: string; description: string }>;
};
type PackageSettingEntry = string | { source?: string };

// ── Binary resolution ───────────────────────────────────────────────────

/** Check if the user-configured pi binary path is valid. Returns null to fall through to default resolution. */
export function resolvePiBinaryFromSetting(rawPath: string): string | null {
	const trimmed = rawPath.trim();
	if (!trimmed || trimmed === "pi") {
		return null; // Use default resolution
	}

	if (path.isAbsolute(trimmed)) {
		try {
			fs.accessSync(
				trimmed,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return trimmed;
		} catch {
			// On Windows, try common executable suffixes when the bare path doesn't exist
			if (process.platform === "win32") {
				for (const ext of [".exe", ".cmd"]) {
					try {
						fs.accessSync(trimmed + ext, fs.constants.F_OK);
						return trimmed + ext;
					} catch {
						/* suffix not found, try next */
					}
				}
			}
			return null;
		}
	}

	const hasPathSep =
		trimmed.includes("/") ||
		(process.platform === "win32" && trimmed.includes("\\"));
	if (hasPathSep) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const basePath = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const resolvedPath = path.join(basePath, trimmed);
		try {
			fs.accessSync(
				resolvedPath,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return resolvedPath;
		} catch {
			return null;
		}
	}

	return trimmed;
}

/** Find the pi binary using VS Code settings, workspace node_modules, and well-known paths. */
export function findPiBinary(): string {
	const settingPath = vscode.workspace
		.getConfiguration("pi-agent")
		.get<string>("binaryPath", "pi");
	const settingResult = resolvePiBinaryFromSetting(settingPath);
	if (settingResult) {
		return settingResult;
	}

	const home = process.env.HOME || process.env.USERPROFILE || "";

	// Check global well-known paths first — prefer the user's global PI install
	// over any workspace-local copy that may come from an SDK dependency.
	// NOTE: workspace node_modules/.bin/pi is intentionally excluded — it may
	// point to a devDependency copy, not the user's global PI install.
	const candidates =
		process.platform === "win32"
			? [
					// pnpm global
					path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi"),
					path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi.exe"),
					path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi.cmd"),
					// npm global (APPDATA/npm)
					path.join(process.env.APPDATA || "", "npm", "pi"),
					path.join(process.env.APPDATA || "", "npm", "pi.exe"),
					path.join(process.env.APPDATA || "", "npm", "pi.cmd"),
					// npm global (LOCALAPPDATA/npm)
					path.join(process.env.LOCALAPPDATA || "", "npm", "pi"),
					path.join(process.env.LOCALAPPDATA || "", "npm", "pi.exe"),
					path.join(process.env.LOCALAPPDATA || "", "npm", "pi.cmd"),
					// ProgramFiles/nodejs (nodejs installer global dir)
					path.join(process.env.ProgramFiles || "", "nodejs", "pi"),
					path.join(process.env.ProgramFiles || "", "nodejs", "pi.exe"),
					path.join(process.env.ProgramFiles || "", "nodejs", "pi.cmd"),
					// bun / other
					path.join(home, ".bun", "bin", "pi"),
					path.join(home, ".npm-global", "pi"),
					path.join(home, ".npm-global", "pi.exe"),
					path.join(home, ".npm-global", "pi.cmd"),
					path.join(home, ".local", "bin", "pi"),
					path.join(home, ".local", "share", "pnpm", "bin", "pi"),
				]
			: [
					path.join(home, ".bun/bin/pi"),
					path.join(home, ".local/bin/pi"),
					path.join(home, ".npm-global/bin/pi"),
					path.join(home, ".local/share/pnpm/bin/pi"),
					"pi",
				];

	for (const c of candidates) {
		try {
			fs.accessSync(
				c,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return c;
		} catch {
			continue;
		}
	}

	return "pi";
}

/** Resolve pi binary to absolute path, returning null if not found. */
export function resolvePiBinary(): string | null {
	const binary = findPiBinary();
	if (path.isAbsolute(binary)) {
		try {
			fs.accessSync(
				binary,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return binary;
		} catch {
			return null;
		}
	}
	try {
		if (process.platform === "win32") {
			const result = spawnSync("where", [binary], {
				shell: true,
				timeout: 1000,
			});
			if (result.status === 0 && result.stdout) {
				const resolved = result.stdout.toString().split(/\r?\n/)[0]?.trim();
				return resolved || null;
			}
			return null;
		} else {
			const result = spawnSync(`command -v "${binary.replace(/"/g, '\\"')}"`, {
				shell: true,
				timeout: 1000,
			});
			if (result.status === 0 && result.stdout) {
				const resolved = result.stdout.toString().trim();
				return resolved || null;
			}
			return null;
		}
	} catch {
		return null;
	}
}

// ── Package parsing ─────────────────────────────────────────────────────

/** Parse the output of `pi list` into structured InstalledPackage entries. */
export function parseInstalledPackages(output: string): InstalledPackage[] {
	const packages: InstalledPackage[] = [];
	const lines = stripAnsi(output).split("\n");

	let pendingSource: string | null = null;

	for (const rawLine of lines) {
		const line = rawLine.replace(/\r/g, "");
		const trimmed = line.trim();

		if (
			!trimmed ||
			trimmed === "No packages installed." ||
			/packages:\s*$/i.test(trimmed)
		) {
			continue;
		}

		if (/^\s{4,}\S/.test(line) && pendingSource) {
			packages.push({ source: pendingSource, path: trimmed });
			pendingSource = null;
			continue;
		}

		if (/^\s{2,}\S/.test(line)) {
			if (pendingSource) {
				packages.push({ source: pendingSource, path: "" });
			}
			pendingSource = trimmed.replace(/\s+\(filtered\)$/, "");
		}
	}

	if (pendingSource) {
		packages.push({ source: pendingSource, path: "" });
	}

	return packages;
}

/** Read package.json from an installed package path, returning description + version. */
export function readPackageManifest(installedPath: string): {
	description: string;
	version: string;
} {
	if (!installedPath) return { description: "", version: "" };
	try {
		const pkgJsonPath = path.join(installedPath, "package.json");
		if (!fs.existsSync(pkgJsonPath)) return { description: "", version: "" };
		const raw = fs.readFileSync(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(raw);
		return {
			description: typeof pkg.description === "string" ? pkg.description : "",
			version: typeof pkg.version === "string" ? pkg.version : "",
		};
	} catch {
		return { description: "", version: "" };
	}
}

/** Read package source entries from a pi settings.json file. */
export function readPackageSourcesFromSettingsFile(
	filePath: string,
	logDebug?: (msg: string, ...details: unknown[]) => void,
): string[] {
	try {
		if (!fs.existsSync(filePath)) {
			return [];
		}

		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content) as { packages?: PackageSettingEntry[] };
		if (!Array.isArray(parsed.packages)) {
			return [];
		}

		return parsed.packages
			.map((entry) => (typeof entry === "string" ? entry : entry.source))
			.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			);
	} catch (error) {
		logDebug?.(
			"[PI] Failed to read package sources from settings file:",
			filePath,
			error,
		);
		return [];
	}
}
