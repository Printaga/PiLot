// ── Session resources: context gathering, file resolution, and project info ─

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { DefaultPackageManager, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { readPackageSourcesFromSettingsFile, type InstalledPackage } from "./pi-binary.js";

/** Check whether a file extension indicates a binary (non-text) file. */
export function isBinaryExtension(filePath: string): boolean {
	const binaryExts = new Set([
		'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif',
		'.svg', '.avif', '.heic', '.heif',
		'.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a',
		'.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
		'.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
		'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
		'.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.a', '.lib',
		'.woff', '.woff2', '.ttf', '.otf', '.eot',
		'.db', '.sqlite', '.sqlite3',
	]);
	const ext = path.extname(filePath).toLowerCase();
	return binaryExts.has(ext);
}

/** Validate that an array of image objects is well-formed. */
export function areImagesValid(images: unknown[]): images is Array<{ type: "image"; data: string; mimeType: string }> {
	if (!Array.isArray(images) || images.length === 0) return false;
	return images.every(
		(img) =>
			img &&
			typeof img === "object" &&
			"type" in img &&
			(img as any).type === "image" &&
			typeof (img as any).data === "string" &&
			typeof (img as any).mimeType === "string" &&
			(img as any).data.length > 0,
	);
}

// ── SessionResources class ──────────────────────────────────────────────

export interface SessionResourcesDeps {
	logError: (msg: string, error?: unknown) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	settingsManager: SettingsManager | undefined;
}

export class SessionResources {
	constructor(private deps: SessionResourcesDeps) {}

	/** Update the settingsManager reference after late initialization. */
	setSettingsManager(manager: SettingsManager): void {
		this.deps.settingsManager = manager;
	}

	/** Get the current workspace root path. */
	getWorkspacePath(): string {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
	}

	/** Get packages configured in settings files, enriched with install paths. */
	getConfiguredPackages(): InstalledPackage[] {
		const workspacePath = this.getWorkspacePath();
		const agentDir = getAgentDir();
		const userSettingsPath = path.join(agentDir, "settings.json");
		const projectSettingsPath = path.join(workspacePath, ".pi", "settings.json");

		const packageSources = [
			...readPackageSourcesFromSettingsFile(userSettingsPath),
			...readPackageSourcesFromSettingsFile(projectSettingsPath),
		];

		const packages = new Map<string, InstalledPackage>();
		for (const source of packageSources) {
			packages.set(source, { source, path: "" });
		}

		if (packages.size === 0 || !this.deps.settingsManager) {
			return [...packages.values()];
		}

		try {
			const packageManager = new DefaultPackageManager({
				cwd: workspacePath,
				agentDir,
				settingsManager: this.deps.settingsManager,
			});

			for (const pkg of packageManager.listConfiguredPackages()) {
				const existing = packages.get(pkg.source);
				packages.set(pkg.source, {
					source: pkg.source,
					path: pkg.installedPath || existing?.path || "",
				});
			}
		} catch (error) {
			this.deps.logError(
				"[PI] Failed to enrich configured packages with install paths:",
				error,
			);
		}

		return [...packages.values()];
	}

	/** Resolve @file mentions in text, replacing them with file content blocks. */
	async resolveFileMentions(text: string): Promise<string> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return text;
		}
		const root = workspaceFolders[0].uri.fsPath;

		const mentionRegex = /@([^\s]+)/g;
		const mentions: Array<{ match: string; filePath: string; index: number }> = [];
		let match: RegExpExecArray | null;
		while ((match = mentionRegex.exec(text)) !== null) {
			mentions.push({ match: match[0], filePath: match[1], index: match.index });
		}

		if (mentions.length === 0) return text;

		const fileContexts: string[] = [];
		let resolvedText = text;

		for (const mention of mentions) {
			const absPath = path.resolve(root, mention.filePath);
			if (!fs.existsSync(absPath)) continue;
			if (isBinaryExtension(mention.filePath)) continue;

			try {
				const content = fs.readFileSync(absPath, "utf-8");
				const maxBytes = 50 * 1024;
				const truncated =
					content.length > maxBytes
						? content.slice(0, maxBytes) + "\n... [file truncated at 50KB]"
						: content;
				fileContexts.push(
					`<file path="${mention.filePath}">\n${truncated}\n</file>`,
				);
				resolvedText = resolvedText.replace(mention.match, "");
			} catch (e) {
				this.deps.logError(`[PI] Failed to read file ${absPath}:`, e);
			}
		}

		if (fileContexts.length === 0) return text;

		const fileBlock = fileContexts.join("\n\n");
		const cleanText = resolvedText.replace(/\s+/g, " ").trim();

		return `${fileBlock}\n\n${cleanText}`;
	}

	/** Build a project context string from package.json. */
	async getProjectContext(): Promise<string> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return "";

		const root = workspaceFolders[0].uri.fsPath;

		try {
			const packageJsonPath = vscode.Uri.joinPath(
				workspaceFolders[0].uri,
				"package.json",
			);
			const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonPath);
			const pkg = JSON.parse(packageJsonContent.toString());

			return `
        Project Root: ${root}
        Project Name: ${pkg.name || "Unknown"}
        Project Version: ${pkg.version || "Unknown"}
      `.trim();
		} catch {
			return `Project Root: ${root}`;
		}
	}
}
