import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import {
	SessionManager as PiSessionManager,
	type ModelRegistry,
	type ModelRuntime,
	type SettingsManager,
	AgentSession,
} from "@earendil-works/pi-coding-agent";

export interface SessionItem {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
}

/** Internal session info with full details (including file path). */
export interface SessionInfoFull {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
	path: string;
	name?: string;
	firstMessage?: string;
	cwd?: string;
}

export interface SessionManagerDeps {
	config: { sessionDir?: string };
	getSession: () => AgentSession | undefined;
	setSession: (session: AgentSession | undefined) => void;
	getSessionManager: () => PiSessionManager | undefined;
	setSessionManager: (manager: PiSessionManager) => void;
	getModelRegistry: () => ModelRegistry | undefined;
	// Replaces SDK 0.78's AuthStorage getter. Kept so consumers can fetch
	// credentials helpers if needed; the field is unused inside this manager.
	getModelRuntime: () => ModelRuntime | undefined;
	getSettingsManager: () => SettingsManager | undefined;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
	onSessionCreated?: (session: AgentSession) => Promise<void>;
	onSessionDeleted?: (sessionIds: string[]) => Promise<void>;
	onSessionListChanged?: () => void;
}

/**
 * Extract text content from an AgentMessage, handling both string content
 * and structured content arrays (TextContent | ImageContent).
 */
export function extractTextFromMessage(msg: {
	role: string;
	content: string | Array<{ type: string; text?: string }> | null;
}): string {
	if (!msg.content) return "";
	if (typeof msg.content === "string") return msg.content;
	return msg.content
		.filter(
			(c): c is { type: string; text: string } =>
				c.type === "text" && typeof c.text === "string",
		)
		.map((c) => c.text)
		.join(" ");
}

/**
 * Generate a concise, descriptive session name (≤60 chars) from the first
 * user and assistant messages in a conversation.
 *
 * Prioritises the assistant's first substantive line because it tends to
 * summarise the task more naturally. Falls back to the first user message.
 */
export function generateSessionName(
	userText: string,
	assistantText: string,
): string {
	const clean = (text: string): string =>
		text
			.replace(/```[\s\S]*?```/g, "")
			.replace(/`[^`]*`/g, "")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/^#+\s*/gm, "")
			.replace(/[*_~>]/g, "")
			.trim();

	const capitalize = (s: string): string =>
		s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;

	const truncate = (s: string, max = 55): string => {
		if (s.length <= max) return s;
		const lastSpace = s.slice(0, max).lastIndexOf(" ");
		const cut = lastSpace > 10 ? s.slice(0, lastSpace) : s.slice(0, max);
		return capitalize(cut.trim());
	};

	const cleanAssistant = clean(assistantText);
	const cleanUser = clean(userText);

	// 1 — Try the assistant's first substantive line (best signal)
	if (cleanAssistant) {
		const lines = cleanAssistant
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 5 && !l.startsWith("```"));

		if (lines.length > 0) {
			// Remove polite conversational prefixes
			const stripped = lines[0]
				.replace(
					/^(I'?ll\s|Let me\s|I can\s|I will\s|I'm going to\s|Here's\s|Here is\s)/i,
					"",
				)
				.trim();
			const sentence = stripped.split(/[.!?\n]/)[0]?.trim() || stripped;
			if (sentence.length > 3 && sentence.length < 60) {
				return capitalize(sentence);
			}
			// Long sentence — take the first key phrase
			const keyPhrase = truncate(sentence, 55);
			if (keyPhrase.length < sentence.length) {
				return keyPhrase + "…";
			}
			return keyPhrase;
		}
	}

	// 2 — Fall back to the first user message
	if (!cleanUser) return "";
	if (cleanUser.length < 60) {
		return capitalize(cleanUser);
	}

	// 3 — First sentence of user message
	const firstSentence = cleanUser.split(/[.!?\n]/)[0]?.trim();
	if (firstSentence) {
		if (firstSentence.length < 60) {
			return capitalize(firstSentence);
		}
		const truncated = truncate(firstSentence, 55);
		return truncated.length < firstSentence.length
			? truncated + "…"
			: capitalize(truncated);
	}

	// 4 — Last resort: truncated user text
	const truncated = truncate(cleanUser, 55);
	return truncated.length < cleanUser.length
		? truncated + "…"
		: capitalize(truncated);
}

export class SessionListManager {
	private _autoNamingTriggered = false;
	private _sessionListCache: SessionItem[] = [];
	private _sessionListFullCache: SessionInfoFull[] = [];
	private _sessionListCacheTime = 0;
	private readonly SESSION_LIST_REFRESH_INTERVAL = 5000;

	constructor(private readonly deps: SessionManagerDeps) {}

	get autoNamingTriggered(): boolean {
		return this._autoNamingTriggered;
	}

	set autoNamingTriggered(value: boolean) {
		this._autoNamingTriggered = value;
	}

	get sessionListCache(): SessionItem[] {
		return this._sessionListCache;
	}

	get sessionListFullCache(): SessionInfoFull[] {
		return this._sessionListFullCache;
	}

	tryAutoSessionName(): boolean {
		const session = this.deps.getSession();
		if (!session || session.sessionName) return false;

		const messages = session.messages;
		const firstUserMsg = messages.find((m) => m.role === "user");
		const firstAssistantMsg = messages.find((m) => m.role === "assistant");

		if (!firstUserMsg || !firstAssistantMsg) return false;

		const userText = extractTextFromMessage(firstUserMsg);
		const assistantText = extractTextFromMessage(firstAssistantMsg);

		const name = generateSessionName(userText, assistantText);
		if (name) {
			this.deps.logDebug("[PI] Auto-generated session name:", name);
			session.setSessionName(name);
			return true;
		}

		return false;
	}

	tryAutoSessionNameFromUserMessage(userMessage: {
		role: string;
		content: string | Array<{ type: string; text?: string }> | null;
	}): boolean {
		const session = this.deps.getSession();
		if (!session || session.sessionName) return false;

		const userText = extractTextFromMessage(userMessage);
		if (!userText) return false;

		const name = generateSessionName(userText, "");
		if (name) {
			this.deps.logDebug(
				"[PI] Auto-generated session name from user message:",
				name,
			);
			session.setSessionName(name);
			return true;
		}

		return false;
	}

	async listSessions(forceRefresh = false): Promise<SessionItem[]> {
		const now = Date.now();
		// Return cached list if recent and not forced
		if (
			!forceRefresh &&
			this._sessionListCache.length > 0 &&
			now - this._sessionListCacheTime < this.SESSION_LIST_REFRESH_INTERVAL
		) {
			return this._sessionListCache;
		}

		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		try {
			const sessions = await PiSessionManager.list(
				cwd,
				this.deps.config.sessionDir,
			);
			// Cache full info for internal use (includes file path)
			this._sessionListFullCache = sessions.map((s) => ({
				id: s.id,
				label: s.name || s.firstMessage.slice(0, 60) || "Untitled",
				timestamp: s.modified.getTime(),
				messageCount: s.messageCount,
				path: s.path,
				name: s.name,
				firstMessage: s.firstMessage,
				cwd: s.cwd,
			}));
			// Cache webview-friendly version
			this._sessionListCache = this._sessionListFullCache.map((s) => ({
				id: s.id,
				label: s.label,
				timestamp: s.timestamp,
				messageCount: s.messageCount,
			}));
			this._sessionListCacheTime = now;
		} catch {
			this._sessionListFullCache = [];
			this._sessionListCache = [];
		}
		return this._sessionListCache;
	}

	invalidateSessionListCache(): void {
		this._sessionListCache = [];
		this._sessionListFullCache = [];
		this._sessionListCacheTime = 0;
	}

	async refreshSessionList(forceRefresh = false): Promise<void> {
		await this.listSessions(forceRefresh);
		this.deps.notifyWebview({
			type: "sessions-list",
			data: this._sessionListCache,
		});
	}

	async deleteSessions(sessionIds: string[]): Promise<void> {
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		try {
			const allSessions = await PiSessionManager.list(
				cwd,
				this.deps.config.sessionDir,
			);
			await Promise.all(
				sessionIds.map(async (sessionId) => {
					try {
						const targetSessionInfo = allSessions.find(
							(s) => s.id === sessionId,
						);
						if (targetSessionInfo) {
							await fs.unlink(targetSessionInfo.path);
						}
					} catch (error) {
						this.deps.logError(
							`[PI] Failed to delete session ${sessionId}:`,
							error,
						);
						throw error;
					}
				}),
			);

			const session = this.deps.getSession();
			if (session && sessionIds.includes(session.sessionId)) {
				session.dispose();
				this.deps.setSession(undefined);
				await this.deps.onSessionDeleted?.(sessionIds);
			}

			await this.refreshSessionList(true);
		} catch (error) {
			this.deps.logError("[PI] Failed to delete sessions:", error);
			vscode.window.showErrorMessage(
				`Failed to delete sessions: ${String(error)}`,
			);
			throw error;
		}
	}
}
