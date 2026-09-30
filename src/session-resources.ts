// ── Session resources: context gathering, file resolution, and project info ─

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import {
	DefaultPackageManager,
	getAgentDir,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readPackageSourcesFromSettingsFile, type InstalledPackage } from "./pi-binary.js";

/** Extensions that must never be inlined into the agent context. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".ico",
	".tiff",
	".tif",
	".svg",
	".avif",
	".heic",
	".heif",
	".mp3",
	".wav",
	".ogg",
	".flac",
	".aac",
	".wma",
	".m4a",
	".mp4",
	".mov",
	".avi",
	".mkv",
	".webm",
	".flv",
	".wmv",
	".zip",
	".tar",
	".gz",
	".bz2",
	".7z",
	".rar",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".exe",
	".dll",
	".so",
	".dylib",
	".wasm",
	".o",
	".a",
	".lib",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".db",
	".sqlite",
	".sqlite3",
]);

/** Refuse to read mention files larger than this (10 MB). */
const MAX_MENTION_FILE_BYTES = 10 * 1024 * 1024;
/** Per-file inline budget before truncation (50 KB). */
const MAX_MENTION_INLINE_BYTES = 50 * 1024;
/** Marker appended when a mention file is truncated. */
const TRUNCATION_NOTICE = `\n... [file truncated at ${Math.round(
	MAX_MENTION_INLINE_BYTES / 1024,
)}KB]`;
/** Mentions matching more candidates than this are ignored entirely. */
const MAX_MENTIONS_PER_PROMPT = 64;

/** Back a byte offset off to the last complete UTF-8 sequence boundary. */
function trimToUtf8Boundary(buf: Buffer, end: number): string {
	let safe = end;
	// Do not split a multi-byte sequence: back off to a lead byte.
	while (safe > 0 && (buf[safe] & 0xc0) === 0x80) safe--;
	return buf.subarray(0, safe).toString("utf-8");
}

/**
 * Build the prompt text left after mention removal: collapse only the
 * whitespace the removal introduced, preserving the user's own newlines and
 * indentation elsewhere.
 */
function collapseAroundRemovedMentions(
	text: string,
	spans: Array<{ index: number; length: number }>,
): string {
	let result = text;
	for (const span of spans.sort((a, b) => b.index - a.index)) {
		const start = span.index;
		const end = span.index + span.length;
		let from = start;
		let to = end;
		// Swallow one adjacent whitespace run on each side of the removed span.
		while (from > 0 && /\s/.test(result[from - 1])) from--;
		while (to < result.length && /\s/.test(result[to])) to++;
		result =
			result.slice(0, from) + (from > 0 && to < result.length ? " " : "") + result.slice(to);
	}
	return result;
}

/** Check whether a file extension indicates a binary (non-text) file. */
export function isBinaryExtension(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return BINARY_EXTENSIONS.has(ext);
}

/** Validate that an array of image objects is well-formed. */
export function areImagesValid(
	images: unknown[],
): images is Array<{ type: "image"; data: string; mimeType: string }> {
	if (!Array.isArray(images) || images.length === 0) return false;
	return images.every(
		(img: unknown): img is { type: "image"; data: string; mimeType: string } => {
			if (!img || typeof img !== "object") return false;
			const o = img as Record<string, unknown>;
			return (
				o.type === "image" &&
				typeof o.data === "string" &&
				typeof o.mimeType === "string" &&
				o.data.length > 0
			);
		},
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

	/** Get the first workspace folder path, or undefined without a workspace. */
	private getWorkspaceRoot(): string | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		return folder ? folder.uri.fsPath : undefined;
	}

	/** Get packages configured in settings files, enriched with install paths. */
	getConfiguredPackages(): InstalledPackage[] {
		const workspacePath = this.getWorkspacePath();
		const agentDir = getAgentDir();
		const userSettingsPath = path.join(agentDir, "settings.json");
		const projectSettingsPath = path.join(workspacePath, ".pi", "settings.json");

		const packageSources = [
			...readPackageSourcesFromSettingsFile(userSettingsPath, this.deps.logDebug),
			...readPackageSourcesFromSettingsFile(projectSettingsPath, this.deps.logDebug),
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

	/**
	 * Resolve a @mention path against the workspace root, refusing escapes.
	 * Returns the absolute path when the mention stays inside `root`, or null
	 * when it would traverse out (`@../../etc/passwd`) or is absolute. The final
	 * decision follows symlinks: a link inside the workspace may point anywhere,
	 * so a purely lexical prefix check is not sufficient.
	 */
	resolveMentionWithinRoot(root: string, mentionPath: string): string | null {
		if (path.isAbsolute(mentionPath)) return null;
		const absPath = path.resolve(root, mentionPath);
		const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
		if (absPath !== root && !absPath.startsWith(rootWithSep)) {
			return null;
		}
		try {
			const realRoot = fs.realpathSync(root);
			const realPath = fs.realpathSync(absPath);
			const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
			if (realPath !== realRoot && !realPath.startsWith(realRootWithSep)) {
				return null;
			}
			return realPath;
		} catch {
			// realpathSync throws when the target does not exist; the caller's
			// exists check reports that case.
			return null;
		}
	}

	/**
	 * Read one resolved @mention into a `<file>` context block.
	 * Returns null when the mention should be skipped (unreadable, missing, or
	 * binary).
	 */
	private async readMentionContext(
		root: string,
		mention: { match: string; filePath: string },
	): Promise<string | null> {
		// Constrain mentions to the workspace root: a path that escapes it
		// (e.g. @../../etc/passwd) would otherwise be read and injected into
		// the agent's context as if the user had attached it.
		const absPath = this.resolveMentionWithinRoot(root, mention.filePath);
		if (!absPath) {
			this.deps.logDebug(`[PI] @mention outside the workspace ignored: ${mention.filePath}`);
			return null;
		}
		if (isBinaryExtension(mention.filePath)) {
			return null;
		}

		try {
			const stat = await fs.promises.stat(absPath);
			// Guard the read: a multi-GB text file would be loaded whole into the
			// extension host before the truncation below ever applies.
			if (stat.size > MAX_MENTION_FILE_BYTES) {
				this.deps.logDebug(`[PI] @mention file too large (${stat.size} bytes): ${absPath}`);
				return null;
			}
			const content = await fs.promises.readFile(absPath, "utf-8");
			const full = Buffer.from(content, "utf-8");
			let truncated = content;
			if (full.length > MAX_MENTION_INLINE_BYTES) {
				truncated = trimToUtf8Boundary(full, MAX_MENTION_INLINE_BYTES) + TRUNCATION_NOTICE;
			}
			// Escape the path and neutralize a content-forged closing tag so a
			// file cannot terminate (or spoof) its own <file> block.
			const safePath = mention.filePath.replace(/"/g, "&quot;");
			const safeContent = truncated.replace(/<\/file>/gi, "<\\/file>");
			return `<file path="${safePath}">\n${safeContent}\n</file>`;
		} catch (e) {
			this.deps.logError(`[PI] Failed to read file ${absPath}:`, e);
			return null;
		}
	}

	async resolveFileMentions(text: string): Promise<string> {
		const root = this.getWorkspaceRoot();
		if (!root) {
			return text;
		}

		// Match path-like candidates only: bare `@word` (emails, `@types/node`
		// scopes) carries a separator or extension char before it can be a path,
		// and trailing punctuation must not become part of the path.
		const mentionRegex = /@([\w./~-]*[\w~-])/g;
		const mentions: Array<{ match: string; filePath: string; index: number }> = [];
		let match: RegExpExecArray | null;
		while ((match = mentionRegex.exec(text)) !== null) {
			mentions.push({
				match: match[0],
				filePath: match[1],
				index: match.index,
			});
			if (mentions.length >= MAX_MENTIONS_PER_PROMPT) break;
		}

		if (mentions.length === 0) return text;

		const fileContexts: string[] = [];
		const spans: Array<{ index: number; length: number }> = [];
		let resolvedText = text;

		for (const mention of mentions) {
			const context = await this.readMentionContext(root, mention);
			if (context === null) continue;
			fileContexts.push(context);
			// Collect spans and strip below by index, not value: indices were
			// captured against the original text and stay valid until removal.
			spans.push({ index: mention.index, length: mention.match.length });
		}

		if (fileContexts.length === 0) return text;

		// Strip in descending index order so earlier offsets remain valid.
		for (const span of spans.sort((a, b) => b.index - a.index)) {
			resolvedText =
				resolvedText.slice(0, span.index) + resolvedText.slice(span.index + span.length);
		}

		const fileBlock = fileContexts.join("\n\n");
		const cleanText = collapseAroundRemovedMentions(text, spans).trim();

		return `${fileBlock}\n\n${cleanText}`;
	}

	/** Build a project context string from package.json. */
	async getProjectContext(): Promise<string> {
		const root = this.getWorkspaceRoot();
		if (!root) return "";

		try {
			const packageJsonPath = vscode.Uri.joinPath(vscode.Uri.file(root), "package.json");
			const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonPath);
			const pkg = JSON.parse(packageJsonContent.toString());

			return `
        Project Root: ${root}
        Project Name: ${pkg.name || "Unknown"}
        Project Version: ${pkg.version || "Unknown"}
      `.trim();
		} catch (error) {
			// Distinguish "no package.json" from a broken or unreadable one.
			this.deps.logError("[PI] Failed to read package.json for project context:", error);
			return `Project Root: ${root}`;
		}
	}
}
