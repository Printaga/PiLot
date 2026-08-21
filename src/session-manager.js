"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionListManager = void 0;
exports.extractTextFromMessage = extractTextFromMessage;
exports.generateSessionName = generateSessionName;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs/promises"));
const pi_coding_agent_1 = require("@earendil-works/pi-coding-agent");
/**
 * Extract text content from an AgentMessage, handling both string content
 * and structured content arrays (TextContent | ImageContent).
 */
function extractTextFromMessage(msg) {
    if (!msg.content)
        return "";
    if (typeof msg.content === "string")
        return msg.content;
    return msg.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
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
function generateSessionName(userText, assistantText) {
    const clean = (text) => text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/[*_~>]/g, "")
        .trim();
    const capitalize = (s) => s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const truncate = (s, max = 55) => {
        if (s.length <= max)
            return s;
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
                .replace(/^(I'?ll\s|Let me\s|I can\s|I will\s|I'm going to\s|Here's\s|Here is\s)/i, "")
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
    if (!cleanUser)
        return "";
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
class SessionListManager {
    deps;
    _autoNamingTriggered = false;
    _sessionListCache = [];
    _sessionListFullCache = [];
    _sessionListCacheTime = 0;
    SESSION_LIST_REFRESH_INTERVAL = 5000;
    constructor(deps) {
        this.deps = deps;
    }
    get autoNamingTriggered() {
        return this._autoNamingTriggered;
    }
    set autoNamingTriggered(value) {
        this._autoNamingTriggered = value;
    }
    get sessionListCache() {
        return this._sessionListCache;
    }
    get sessionListFullCache() {
        return this._sessionListFullCache;
    }
    tryAutoSessionName() {
        const session = this.deps.getSession();
        if (!session || session.sessionName)
            return false;
        const messages = session.messages;
        const firstUserMsg = messages.find((m) => m.role === "user");
        const firstAssistantMsg = messages.find((m) => m.role === "assistant");
        if (!firstUserMsg || !firstAssistantMsg)
            return false;
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
    tryAutoSessionNameFromUserMessage(userMessage) {
        const session = this.deps.getSession();
        if (!session || session.sessionName)
            return false;
        const userText = extractTextFromMessage(userMessage);
        if (!userText)
            return false;
        const name = generateSessionName(userText, "");
        if (name) {
            this.deps.logDebug("[PI] Auto-generated session name from user message:", name);
            session.setSessionName(name);
            return true;
        }
        return false;
    }
    async listSessions(forceRefresh = false) {
        const now = Date.now();
        // Return cached list if recent and not forced
        if (!forceRefresh &&
            this._sessionListCache.length > 0 &&
            now - this._sessionListCacheTime < this.SESSION_LIST_REFRESH_INTERVAL) {
            return this._sessionListCache;
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        try {
            const sessions = await pi_coding_agent_1.SessionManager.list(cwd, this.deps.config.sessionDir);
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
        }
        catch {
            this._sessionListFullCache = [];
            this._sessionListCache = [];
        }
        return this._sessionListCache;
    }
    invalidateSessionListCache() {
        this._sessionListCache = [];
        this._sessionListFullCache = [];
        this._sessionListCacheTime = 0;
    }
    async refreshSessionList(forceRefresh = false) {
        await this.listSessions(forceRefresh);
        this.deps.notifyWebview({
            type: "sessions-list",
            data: this._sessionListCache,
        });
    }
    async deleteSessions(sessionIds) {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        try {
            const allSessions = await pi_coding_agent_1.SessionManager.list(cwd, this.deps.config.sessionDir);
            await Promise.all(sessionIds.map(async (sessionId) => {
                try {
                    const targetSessionInfo = allSessions.find((s) => s.id === sessionId);
                    if (targetSessionInfo) {
                        await fs.unlink(targetSessionInfo.path);
                    }
                }
                catch (error) {
                    this.deps.logError(`[PI] Failed to delete session ${sessionId}:`, error);
                    throw error;
                }
            }));
            const session = this.deps.getSession();
            if (session && sessionIds.includes(session.sessionId)) {
                session.dispose();
                this.deps.setSession(undefined);
                await this.deps.onSessionDeleted?.(sessionIds);
            }
            await this.refreshSessionList(true);
        }
        catch (error) {
            this.deps.logError("[PI] Failed to delete sessions:", error);
            vscode.window.showErrorMessage(`Failed to delete sessions: ${String(error)}`);
            throw error;
        }
    }
}
exports.SessionListManager = SessionListManager;
//# sourceMappingURL=session-manager.js.map