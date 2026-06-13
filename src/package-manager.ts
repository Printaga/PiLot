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

		return packages.map((pkg) => {
			const manifest = readPackageManifest(pkg.path);

			// Match resource sourceInfo.source to this package's source string
			const srcLower = pkg.source.toLowerCase();
			const matchesSource = (sourceName: string | undefined) =>
				sourceName?.toLowerCase() === srcLower;

			const pkgSkills = skills
				.filter((s) => matchesSource(s.sourceInfo?.source))
				.map((s) => ({
					name: s.name || "",
					description: s.description || "",
				}));

			const pkgExtensions = extensions
				.filter((e) => matchesSource(e.sourceInfo?.source))
				.map((e) => ({
					path: e.path || "",
					sourceName: e.sourceInfo?.source || null,
				}));

			const pkgPrompts = prompts
				.filter((p) => matchesSource(p.sourceInfo?.source))
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
	}

	// Package management methods using CLI
	async listPackages(): Promise<EnrichedPackage[]> {
		this.deps.logDebug("[PI] listPackages called");
		const configuredPackages = this.deps.getConfiguredPackages();
		if (configuredPackages.length > 0) {
			this.deps.logDebug(
				"[PI] listPackages: found configured packages:",
				configuredPackages,
			);
			return this.enrichPackages(configuredPackages);
		}

		return this.enrichPackages(await this.listPackagesFromCli());
	}

	private async listPackagesFromCli(): Promise<InstalledPackage[]> {
		const binaryPath = this.deps.binaryService.getBinaryPath();
		const direct = await execFileAsync(binaryPath, ["list"]);
		let packages = parseInstalledPackages(direct.stdout);
		this.deps.logDebug(
			"[PI] listPackagesFromCli: direct parsed packages:",
			packages,
		);

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

		const fromShell = await execFileAsync(
			shellCommand.command,
			shellCommand.args,
		);
		packages = parseInstalledPackages(fromShell.stdout);
		this.deps.logDebug(
			"[PI] listPackagesFromCli: shell parsed packages:",
			packages,
		);
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
		await this.runPackageCommand(["remove", source]);
	}

	async updatePackages(): Promise<void> {
		await this.runPackageCommand(["update"]);
	}
}
