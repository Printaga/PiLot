import * as vscode from "vscode";
import * as path from "node:path";
import * as fsSync from "node:fs";
import { execFileAsync } from "./utils/shell.js";
import { findPiBinary, resolvePiBinary } from "./pi-binary.js";

export interface BinaryServiceDeps {
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
}

export class BinaryService {
	private resolvedBinaryPath: string | null = null;
	private cachedVersion: string | null = null;
	private pathResolved = false;

	constructor(private readonly deps: BinaryServiceDeps) {}

	resolveAtStartup(): void {
		if (this.pathResolved) return;
		this.resolvedBinaryPath = resolvePiBinary();
		this.pathResolved = true;
		if (this.resolvedBinaryPath) {
			this.deps.logDebug(`Resolved pi binary: ${this.resolvedBinaryPath}`);
		} else {
			const msg =
				"[PI] Could not locate 'pi' binary. Set pi-agent.binaryPath in settings or ensure 'pi' is on your PATH.";
			this.deps.logError(msg);
			vscode.window.showErrorMessage(msg);
		}
	}

	prependToPath(): void {
		const originalPath = process.env.PATH;
		if (!originalPath || !this.resolvedBinaryPath) return;
		if (!path.isAbsolute(this.resolvedBinaryPath)) return;
		const binaryDir = path.dirname(this.resolvedBinaryPath);
		const pathSep = process.platform === "win32" ? ";" : ":";
		process.env.PATH = `${binaryDir}${pathSep}${originalPath}`;
	}

	restorePath(originalPath: string | undefined): void {
		if (originalPath !== undefined) {
			process.env.PATH = originalPath;
		}
	}

	async getCliVersion(): Promise<string | null> {
		if (this.cachedVersion) return this.cachedVersion;
		try {
			const binaryPath = this.resolvedBinaryPath || findPiBinary();
			const result = await execFileAsync(binaryPath, ["--version"]);
			const versionOutput = result.stdout?.trim() || result.stderr?.trim();
			if (result.code === 0 && versionOutput) {
				this.cachedVersion = versionOutput;
				this.deps.logDebug(`Resolved PI CLI version: ${this.cachedVersion}`);
				return this.cachedVersion;
			}
		} catch {
			// logging handled by caller
		}
		return null;
	}

	getResolvedPath(): string | null {
		return this.resolvedBinaryPath;
	}

	resolveBinary(): string | null {
		return resolvePiBinary();
	}

	getBinaryPath(): string {
		return findPiBinary();
	}

	isBinaryAvailable(): boolean {
		return this.resolvedBinaryPath !== null;
	}

	resolveGitBranch(cwd: string): string | null {
		try {
			let dir = cwd;
			while (true) {
				const gitPath = path.join(dir, ".git");
				if (fsSync.existsSync(gitPath)) {
					const stat = fsSync.statSync(gitPath);
					if (stat.isDirectory()) {
						const headPath = path.join(gitPath, "HEAD");
						if (!fsSync.existsSync(headPath)) return null;
						const content = fsSync.readFileSync(headPath, "utf8").trim();
						if (content.startsWith("ref: refs/heads/")) {
							return content.slice(16);
						}
						return "detached";
					} else if (stat.isFile()) {
						const content = fsSync.readFileSync(gitPath, "utf8").trim();
						if (content.startsWith("gitdir: ")) {
							const gitDir = path.resolve(dir, content.slice(8).trim());
							const headPath = path.join(gitDir, "HEAD");
							if (!fsSync.existsSync(headPath)) return null;
							const headContent = fsSync.readFileSync(headPath, "utf8").trim();
							if (headContent.startsWith("ref: refs/heads/")) {
								return headContent.slice(16);
							}
							return "detached";
						}
					}
				}
				const parent = path.dirname(dir);
				if (parent === dir) return null;
				dir = parent;
			}
		} catch {
			return null;
		}
	}
}
