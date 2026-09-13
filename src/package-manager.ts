import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
	type ResourceLoader,
	type Skill,
	type Extension,
	type PromptTemplate,
} from "@earendil-works/pi-coding-agent";
import { type BinaryService } from "./binary-service.js";
import {
	parseInstalledPackages,
	readPackageManifest,
	type InstalledPackage,
	type EnrichedPackage,
} from "./pi-binary.js";
import { getShellCommand, execFileAsync } from "./utils/shell.js";

export interface PackageManagerDeps {
	getResourceLoader: () => ResourceLoader | undefined;
	getConfiguredPackages: () => InstalledPackage[];
	binaryService: BinaryService;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
}

export class PackageManager {
	constructor(private readonly deps: PackageManagerDeps) {}

	/** Enrich installed packages with description, version, types, and per-package resources from the resource loader. */
	enrichPackages(packages: InstalledPackage[]): EnrichedPackage[] {
		const rl = this.deps.getResourceLoader();
		let skills: Skill[] = [];
		let extensions: Extension[] = [];
		let prompts: PromptTemplate[] = [];
		if (rl) {
			try {
				skills = rl.getSkills().skills || [];
			} catch {
				skills = [];
			}
			try {
				extensions = rl.getExtensions().extensions || [];
			} catch {
				extensions = [];
			}
			try {
				prompts = rl.getPrompts().prompts || [];
			} catch {
				prompts = [];
			}
		}

		const getSkillPath = (s: Skill): string =>
			((s as unknown as { filePath?: string }).filePath ||
				(s as unknown as { path?: string }).path ||
				"") as string;
		const getExtensionPath = (e: Extension): string =>
			((e as unknown as { resolvedPath?: string }).resolvedPath || e.path || "") as string;
		const getPromptPath = (p: PromptTemplate): string =>
			((p as unknown as { filePath?: string }).filePath ||
				(p as unknown as { path?: string }).path ||
				"") as string;
		const isUnderDir = (filePath: string, dir: string): boolean => {
			if (!filePath || !dir) return false;
			if (filePath === dir) return true;
			return filePath.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
		};

		const enriched: EnrichedPackage[] = packages.map((pkg) => {
			const manifest = readPackageManifest(pkg.path);

			// Match resource sourceInfo.source to this package's source string,
			// or by path containment when the package has an install path.
			const srcLower = pkg.source.toLowerCase();
			const matchesPkg = (sourceName: string | undefined, resourcePath: string) => {
				if (sourceName?.toLowerCase() === srcLower) return true;
				if (pkg.path && resourcePath && isUnderDir(resourcePath, pkg.path)) return true;
				return false;
			};

			const pkgSkills = skills
				.filter((s) => matchesPkg(s.sourceInfo?.source, getSkillPath(s)))
				.map((s) => ({
					name: s.name || "",
					description: s.description || "",
				}));

			const pkgExtensions = extensions
				.filter((e) => matchesPkg(e.sourceInfo?.source, getExtensionPath(e)))
				.map((e) => ({
					path: e.path || "",
					sourceName: e.sourceInfo?.source || null,
				}));

			const pkgPrompts = prompts
				.filter((p) => matchesPkg(p.sourceInfo?.source, getPromptPath(p)))
				.map((p) => ({
					name: p.name || "",
					description: p.description || "",
				}));

			const types: string[] = [];
			if (pkgExtensions.length > 0) types.push("extensions");
			if (pkgSkills.length > 0) types.push("skills");
			if (pkgPrompts.length > 0) types.push("prompts");

			return {
				...pkg,
				description: manifest.description,
				version: manifest.version,
				types,
				skills: pkgSkills,
				extensions: pkgExtensions,
				prompts: pkgPrompts,
			};
		});

		// Surface locally-discovered top-level resources (e.g.
		// ~/.pi/agent/extensions/nvidia-nim-pacer.ts with
		// sourceInfo { source: "local", scope: "user", origin: "top-level" })
		// that never match a package source. Bucket by scope so each file
		// remains visible instead of being silently dropped.
		const isInlinePath = (p: string) => p.startsWith("<");
		const localSkills = skills.filter(
			(s) =>
				(s.sourceInfo as unknown as { origin?: string } | undefined)?.origin ===
					"top-level" && !isInlinePath(getSkillPath(s)),
		);
		const localExtensions = extensions.filter(
			(e) =>
				(e.sourceInfo as unknown as { origin?: string } | undefined)?.origin ===
					"top-level" &&
				!isInlinePath(e.path || "") &&
				!isInlinePath(getExtensionPath(e)),
		);
		const localPrompts = prompts.filter(
			(p) =>
				(p.sourceInfo as unknown as { origin?: string } | undefined)?.origin ===
					"top-level" && !isInlinePath(getPromptPath(p)),
		);

		const scopeOf = (info: unknown): "user" | "project" =>
			(info as { scope?: string } | undefined)?.scope === "project" ? "project" : "user";

		for (const scope of ["user", "project"] as const) {
			const bucketSkills = localSkills.filter((s) => scopeOf(s.sourceInfo) === scope);
			const bucketExtensions = localExtensions.filter((e) => scopeOf(e.sourceInfo) === scope);
			const bucketPrompts = localPrompts.filter((p) => scopeOf(p.sourceInfo) === scope);
			if (
				bucketSkills.length === 0 &&
				bucketExtensions.length === 0 &&
				bucketPrompts.length === 0
			) {
				continue;
			}

			const firstPath =
				(bucketExtensions.length > 0 ? getExtensionPath(bucketExtensions[0]) : "") ||
				(bucketSkills.length > 0 ? getSkillPath(bucketSkills[0]) : "") ||
				(bucketPrompts.length > 0 ? getPromptPath(bucketPrompts[0]) : "");
			const baseDir =
				(bucketExtensions[0]?.sourceInfo as unknown as { baseDir?: string })?.baseDir ||
				(bucketSkills[0]?.sourceInfo as unknown as { baseDir?: string })?.baseDir ||
				(bucketPrompts[0]?.sourceInfo as unknown as { baseDir?: string })?.baseDir ||
				(firstPath ? path.dirname(firstPath) : "");

			const types: string[] = [];
			if (bucketExtensions.length > 0) types.push("extensions");
			if (bucketSkills.length > 0) types.push("skills");
			if (bucketPrompts.length > 0) types.push("prompts");

			enriched.push({
				source: `local:${scope}`,
				path: baseDir,
				description: "",
				version: "",
				types,
				skills: bucketSkills.map((s) => ({
					name: s.name || "",
					description: s.description || "",
				})),
				extensions: bucketExtensions.map((e) => ({
					path: e.path || "",
					sourceName: e.sourceInfo?.source || null,
				})),
				prompts: bucketPrompts.map((p) => ({
					name: p.name || "",
					description: p.description || "",
				})),
				local: true,
			});
		}

		return enriched;
	}

	// Package management methods using CLI
	async listPackages(): Promise<EnrichedPackage[]> {
		this.deps.logDebug("[PI] listPackages called");
		const configuredPackages = this.deps.getConfiguredPackages();
		if (configuredPackages.length > 0) {
			this.deps.logDebug("[PI] listPackages: found configured packages:", configuredPackages);
			return this.enrichPackages(configuredPackages);
		}

		return this.enrichPackages(await this.listPackagesFromCli());
	}

	private async listPackagesFromCli(): Promise<InstalledPackage[]> {
		const binaryPath = this.deps.binaryService.getBinaryPath();
		const direct = await execFileAsync(binaryPath, ["list"]);
		let packages = parseInstalledPackages(direct.stdout);
		this.deps.logDebug("[PI] listPackagesFromCli: direct parsed packages:", packages);

		if (packages.length > 0) {
			return packages;
		}

		const shellCommand = getShellCommand(binaryPath, ["list"]);
		if (!shellCommand) {
			if (direct.stderr) {
				this.deps.logError("[PI] listPackagesFromCli error:", direct.stderr);
			}
			return packages;
		}

		const fromShell = await execFileAsync(shellCommand.command, shellCommand.args);
		packages = parseInstalledPackages(fromShell.stdout);
		this.deps.logDebug("[PI] listPackagesFromCli: shell parsed packages:", packages);
		if (packages.length === 0 && (direct.stderr || fromShell.stderr)) {
			this.deps.logError(
				"[PI] listPackagesFromCli error:",
				direct.stderr || fromShell.stderr,
			);
		}

		return packages;
	}

	private spawnPackageCommand(args: string[]): ChildProcess {
		const binaryPath = this.deps.binaryService.getBinaryPath();
		// Use shell to resolve via PATH on all platforms when binaryPath is a simple name
		if (binaryPath === "pi" || !path.isAbsolute(binaryPath)) {
			return spawn(binaryPath, args, { shell: true });
		}
		// On non-Windows, use shell for better output streaming
		if (process.platform !== "win32") {
			const shellCommand = getShellCommand(binaryPath, args);
			if (shellCommand) {
				return spawn(shellCommand.command, shellCommand.args);
			}
		}
		return spawn(binaryPath, args);
	}

	private async runPackageCommand(args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			// Send loading start
			this.deps.notifyWebview({ type: "loading", data: { loading: true } });

			const proc = this.spawnPackageCommand(args);

			let output = "";
			proc.stdout?.on("data", (chunk) => {
				output += chunk.toString();
				this.deps.notifyWebview({
					type: "output",
					data: { text: chunk.toString() },
				});
			});
			proc.stderr?.on("data", (chunk) => {
				output += chunk.toString();
				this.deps.notifyWebview({
					type: "output",
					data: { text: chunk.toString() },
				});
			});

			proc.on("close", (code) => {
				// Send loading end
				this.deps.notifyWebview({ type: "loading", data: { loading: false } });
				if (code === 0) {
					this.deps.notifyWebview({ type: "packages-updated" });
					resolve();
				} else {
					reject(new Error(output || `Command failed with code ${code}`));
				}
			});

			proc.on("error", (err) => {
				this.deps.notifyWebview({ type: "loading", data: { loading: false } });
				reject(err);
			});
		});
	}

	async installPackage(source: string): Promise<void> {
		await this.runPackageCommand(["install", source]);
	}

	async uninstallPackage(source: string): Promise<void> {
		if (source.toLowerCase().startsWith("local:")) {
			throw new Error(
				`Cannot remove ${source} via package manager: local files must be deleted manually.`,
			);
		}
		await this.runPackageCommand(["remove", source]);
	}

	async updatePackages(): Promise<void> {
		await this.runPackageCommand(["update"]);
	}
}
