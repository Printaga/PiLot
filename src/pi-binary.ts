// ── Pi binary resolution and package output parsing ─────────────────────────

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
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
	/** True for synthetic local entries (e.g. local:user) that are not pi packages. */
	local?: boolean;
};
type PackageSettingEntry = string | { source?: string };

export const piBinaryInternals = {
	spawnSync: childProcess.spawnSync,
	// Tests stub filesystem access through this seam; ESM namespaces are frozen.
	accessSync: (p: string, mode?: number) => fs.accessSync(p, mode),
};

// ── Binary resolution ───────────────────────────────────────────────────

/**
 * Shell characters that would be interpreted rather than resolved as part of a
 * program name: command substitution, chaining, redirection, background, and the
 * newline that separates commands. `"`, `%`, and `^` are interpreted by cmd.exe and
 * are covered separately below, because they cannot be escaped by wrapping the
 * value in quotes the way the POSIX characters are avoided by not being present.
 *
 * `pi-agent.binaryPath` is read from settings, and settings can come from the
 * workspace — `.vscode/settings.json` is part of a clone. The resolved value is
 * handed to a `shell: true` child as the program name, so a value carrying any of
 * these would be executed as shell syntax instead of resolved as a program. A path
 * may legitimately contain many other symbols (spaces and parentheses appear in
 * real install locations), so this refuses the execution characters rather than
 * allowlisting a path alphabet.
 */
const SHELL_EXECUTION_METACHARACTERS = /[;&|$`<>\n\r]/;

/**
 * Characters cmd.exe acts on. A `"` would close the wrapping quote and expose the
 * `&` that followed it, `%` expands a variable, `^` escapes the next character,
 * and `!` expands under delayed expansion. No Windows path may contain `"`, so
 * refusing it costs nothing. These are the same characters `quoteShellArg()`
 * refuses on Windows, so the two boundaries agree.
 */
const CMD_EXECUTION_METACHARACTERS = /["%^!]/;

/** Upper bound on a configured binary path, so a pathological setting cannot be
 * echoed back into a dialog or a child argument list. */
const MAX_BINARY_PATH_LENGTH = 4096;

/**
 * Whether `value` may be used as the program name without being reinterpreted by
 * the shell that starts the pi process.
 */
export function isSafeBinaryPath(value: string, platform: string = process.platform): boolean {
	if (!value || value.length > MAX_BINARY_PATH_LENGTH) {
		return false;
	}
	if (SHELL_EXECUTION_METACHARACTERS.test(value)) {
		return false;
	}
	// `!` and `%` are only live for cmd.exe; on a POSIX shell they are inert, so a
	// path legitimately containing one is still accepted there.
	if (platform === "win32" && CMD_EXECUTION_METACHARACTERS.test(value)) {
		return false;
	}
	// A leading `(` or `{` opens a subshell or a command group when it sits in the
	// program position. The same characters later in a path are inert.
	return !value.startsWith("(") && !value.startsWith("{");
}

/** Check if the user-configured pi binary path is valid. Returns null to fall through to default resolution. */
export function resolvePiBinaryFromSetting(rawPath: string): string | null {
	const trimmed = rawPath.trim();
	if (!trimmed || trimmed === "pi") {
		return null; // Use default resolution
	}

	// A value carrying shell syntax is refused rather than resolved: accepting it
	// would let a workspace-supplied setting execute as shell syntax. An unusable
	// setting falls through to default resolution, as an unreadable path already did.
	if (!isSafeBinaryPath(trimmed)) {
		return null;
	}

	if (path.isAbsolute(trimmed)) {
		try {
			piBinaryInternals.accessSync(
				trimmed,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return trimmed;
		} catch {
			// On Windows, try common executable suffixes when the bare path doesn't exist
			if (process.platform === "win32") {
				for (const ext of [".exe", ".cmd"]) {
					try {
						piBinaryInternals.accessSync(trimmed + ext, fs.constants.F_OK);
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
		trimmed.includes("/") || (process.platform === "win32" && trimmed.includes("\\"));
	if (hasPathSep) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const basePath = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const resolvedPath = path.join(basePath, trimmed);
		try {
			piBinaryInternals.accessSync(
				resolvedPath,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			// The joined path inherits the workspace folder name, which a repository also
			// controls, so the resolved value is checked rather than only the setting.
			return isSafeBinaryPath(resolvedPath) ? resolvedPath : null;
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
					// mise shims — covers installs where 'pi' is not on PATH seen by VS Code
					path.join(home, ".local/share/mise/shims/pi"),
					"pi",
				];

	for (const c of candidates) {
		try {
			piBinaryInternals.accessSync(
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
			piBinaryInternals.accessSync(
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
			const result = piBinaryInternals.spawnSync("where", [binary], {
				shell: true,
				timeout: 1000,
			});
			if (result.status === 0 && result.stdout) {
				const resolved = result.stdout.toString().split(/\r?\n/)[0]?.trim();
				return resolved || null;
			}
			return null;
		} else {
			const result = piBinaryInternals.spawnSync("command", ["-v", binary], {
				shell: false,
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

	let currentSource: string | null = null;
	let sawPackageForSource = false;

	const flushEmptySource = () => {
		if (currentSource && !sawPackageForSource) {
			packages.push({ source: currentSource, path: "" });
		}
	};

	for (const rawLine of lines) {
		const line = rawLine.replace(/\r/g, "");
		const trimmed = line.trim();

		if (
			!trimmed ||
			trimmed === "No packages installed." ||
			/^(packages?|pkgs?):\s*$/i.test(trimmed)
		) {
			continue;
		}

		// Package paths are indented deeper than their source line.
		if (/^\s{4,}\S/.test(line)) {
			if (currentSource) {
				packages.push({ source: currentSource, path: trimmed });
				sawPackageForSource = true;
			}
			continue;
		}

		if (/^\s{2,}\S/.test(line)) {
			flushEmptySource();
			currentSource = trimmed.replace(/\s+\(filtered\)$/, "");
			sawPackageForSource = false;
		}
	}

	flushEmptySource();

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
			.map((entry) => (typeof entry === "string" ? entry.trim() : entry.source?.trim()))
			.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	} catch (error) {
		logDebug?.("[PI] Failed to read package sources from settings file:", filePath, error);
		return [];
	}
}
