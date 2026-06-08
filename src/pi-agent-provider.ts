import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import { spawn, type ChildProcess } from "node:child_process";
import {
	createAgentSession,
	SessionManager,
	AuthStorage,
	ModelRegistry,
	SettingsManager,
	getAgentDir,
	AgentSession,
	AgentSessionEvent,
	DefaultResourceLoader,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { MessageHandler } from "./message-handler.js";
import { VoiceManager } from "./voice-manager.js";
import { type ThinkingLevel } from "./webview/types/index.js";
import { getShellCommand, execFileAsync } from "./utils/shell.js";

import { findPiBinary, resolvePiBinary, parseInstalledPackages, type InstalledPackage } from "./pi-binary.js";
import { SessionResources, isBinaryExtension, areImagesValid } from "./session-resources.js";
import { tryHandleSlashCommand, type SlashCommandContext } from "./slash-commands.js";
import { serializeMessages } from "./message-serializer.js";







const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

export function validateThinkingLevel(value: unknown): ThinkingLevel {
	if (typeof value === "string" && THINKING_LEVELS.has(value)) {
		return value as ThinkingLevel;
	}
	return "medium";
}

export interface PiAgentConfig {
	defaultModel: string;
	defaultProvider: string;
	autoContext: boolean;
	maxTokens: number;
	thinkingLevel: ThinkingLevel;
	sessionDir?: string;
}

type RegistryModel = { provider: string; id: string; name?: string };

export interface SessionItem {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
}

/** @deprecated legacy interface for native tree view — kept for SessionsTreeProvider compatibility */
export interface SessionNode {
	id: string;
	label: string;
	timestamp: number;
	children: SessionNode[];
	parent: string | null;
}

export class PiAgentProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	private _webview?: vscode.Webview;
	private view?: vscode.WebviewView;
	private session?: AgentSession;
	// Cached update info for re-sending to webview on visibility change
	private lastUpdateInfo: { piVersion: string | null; packageCount: number } = { piVersion: null, packageCount: 0 };
	private config: PiAgentConfig;
	private messageHandler: MessageHandler;
	private isInitialized = false;
	private authStorage?: AuthStorage;
	private modelRegistry?: ModelRegistry;
	private sessionManager?: SessionManager;
	private settingsManager?: SettingsManager;
	private availableModels: Array<{
		id: string;
		provider: string;
		name: string;
	}> = [];
	private favoriteModels: string[] = [];
	private cliModelIdsCache: Set<string> | null = null;
	private cliModelIdsPromise: Promise<Set<string>> | null = null;
	private currentModelId: string | null = null;
	private sessionList: SessionItem[] = [];
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	/** Resolved absolute path to pi binary, set at initialization. */
	private resolvedBinaryPath: string | null = null;

	/** Extension activity statuses forwarded from packages via ctx.ui.setStatus(). Cleared only when the extension explicitly clears them. */
	private extensionStatuses = new Map<string, string>();
	/** Interval handle for polling extension statuses from the runner. */
	private statusPoller: ReturnType<typeof setInterval> | undefined;

	/** Tracks whether auto-naming has been triggered for the current session. Reset on new/switch session. */
	private _autoNamingTriggered = false;

	get hasSession(): boolean {
		return this.session !== undefined;
	}

	private voiceManager: VoiceManager;
	private sessionResources: SessionResources;
	private logChannel: vscode.OutputChannel;

	constructor(
		private context: vscode.ExtensionContext,
		config: PiAgentConfig,
	) {
		this.config = config;
		this.logChannel = vscode.window.createOutputChannel("PiLot Studio");
		this.messageHandler = new MessageHandler(this);
		this.voiceManager = new VoiceManager({
			extensionUri: this.context.extensionUri,
			agentDir: getAgentDir(),
			logDebug: this.logDebug.bind(this),
			logError: this.logError.bind(this),
			notifyWebview: this.notifyWebview.bind(this),
		});
		this.sessionResources = new SessionResources({
			logError: this.logError.bind(this),
			logDebug: this.logDebug.bind(this),
			settingsManager: undefined,
		});
	}

	/** Resolve the pi binary once at startup, logging the result. */
	private resolvePiBinaryAtStartup(): void {
		this.resolvedBinaryPath = resolvePiBinary();
		if (this.resolvedBinaryPath) {
			this.log(`Resolved pi binary: ${this.resolvedBinaryPath}`);
		} else {
			this.logError(
				"[PI] Could not locate 'pi' binary. Set pi-agent.binaryPath in settings or ensure 'pi' is on your PATH.",
			);
		}
	}

	/** Write to the PiLot Studio output channel (always shown). */
	log(msg: string): void {
		this.logChannel.appendLine(msg);
	}

	/**
	 * Debug-level log — only written when pi-agent.diagnostics.enabled is true.
	 * Pass an optional object to include details after the message.
	 */
	logDebug(msg: string, ...details: unknown[]): void {
		const diagEnabled = vscode.workspace
			.getConfiguration("pi-agent")
			.get<boolean>("diagnostics.enabled", false);
		if (!diagEnabled) return;
		this.logChannel.appendLine(msg);
		for (const d of details) {
			this.logChannel.appendLine(String(d));
		}
	}

	/** Log an error to the output channel and to console.error. */
	logError(msg: string, error?: unknown): void {
		this.logChannel.appendLine(`[ERROR] ${msg}`);
		if (error) {
			this.logChannel.appendLine(String(error));
		}
		console.error(msg, error);
	}

	async initialize() {
		if (this.isInitialized) return;

		// Resolve pi binary once at startup
		this.resolvePiBinaryAtStartup();

		// Prepend resolved binary directory to PATH for SDK internals (only for absolute paths)
		const originalPath = process.env.PATH;
		if (this.resolvedBinaryPath && path.isAbsolute(this.resolvedBinaryPath)) {
			const binaryDir = path.dirname(this.resolvedBinaryPath);
			const pathSep = process.platform === "win32" ? ";" : ":";
			process.env.PATH = `${binaryDir}${pathSep}${process.env.PATH || ""}`;
		}

		try {
			this.authStorage = AuthStorage.create();
			this.modelRegistry = ModelRegistry.create(this.authStorage);
			this.settingsManager = SettingsManager.create(
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
			);
			this.sessionManager = SessionManager.create(
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
			);

			const models = await this.getMergedModels();
			this.availableModels = this.buildModelList(models);

			const savedFavorites = this.context.globalState.get<string[]>("favoriteModels", []);
			this.favoriteModels = savedFavorites.filter(pattern =>
				this.availableModels.some(m => m.id === pattern)
			);

			// Merge with PI CLI scoped models (bidirectional sync)
			this.syncFromCliModels().catch(() => {});

			// Restore persisted model — settings.json first, then globalState
			const settingsDefaultModel = this.settingsManager?.getDefaultModel();
			if (settingsDefaultModel) {
				const provider = this.settingsManager?.getDefaultProvider() || "";
				this.currentModelId = provider + "/" + settingsDefaultModel;
			} else {
				this.currentModelId = this.context.globalState.get<string | null>(
					"currentModelId",
					null,
				);
			}

			this.isInitialized = true;

		// Update SessionResources with the now-initialized settingsManager
		if (this.settingsManager) {
			this.sessionResources.setSettingsManager(this.settingsManager);
		}

		} catch (error) {
			// Restore PATH on failure
			if (originalPath !== undefined && this.resolvedBinaryPath) {
				process.env.PATH = originalPath;
			}
			this.logError("Failed to initialize PiLot Studio:", error);
			vscode.window.showErrorMessage(`Failed to initialize PiLot Studio: ${error}`);
		}
	}

	private async getMergedModels() {
		if (!this.modelRegistry) return [];
		const available = await this.modelRegistry.getAvailable();
		const all = this.modelRegistry.getAll();
		const merged = new Map<string, RegistryModel>();

		for (const m of all) {
			merged.set(m.provider + "/" + m.id, m);
		}

		for (const m of available) {
			merged.set(m.provider + "/" + m.id, m);
		}

		return [...merged.values()];
	}

	private buildModelList(models: RegistryModel[]) {
		return models
			.map((m) => ({
				id: m.provider + "/" + m.id,
				provider: m.provider,
				name: m.name || m.id,
			}))
			.sort(
				(a, b) =>
					a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
			);
	}

	private async refreshAvailableModels() {
		if (!this.modelRegistry) return;
		const models = await this.getMergedModels();
		this.availableModels = this.buildModelList(models);
		this.notifyWebview({
			type: "models-updated",
			data: { models: this.availableModels },
		});
	}

	updateConfig(config: PiAgentConfig) {
		this.config = config;
	}

	/** Reload session resources (extensions, skills, prompts) when discovery settings change. */
	async reloadSessionResources(): Promise<void> {
		if (!this.session) return;

		try {
			// Call reload on the session's resource loader to pick up setting changes
			const rl = (this.session as any).resourceLoader;
			if (rl && typeof rl.reload === 'function') {
				await rl.reload();
				this.logDebug("[PI] Resource loader reloaded");
			}
			// Refresh the webview with updated resources
			await this.sendSessionResources();
		} catch (e) {
			this.logError("[PI] Failed to reload session resources:", e);
		}
	}

	get webview(): vscode.Webview | undefined {
		return this._webview;
	}

	resolveWebviewView(view: vscode.WebviewView) {
		this.logDebug("[PiLot Studio] resolveWebviewView called");
		this.view = view;
		this._webview = view.webview;
		this.logDebug("[PiLot Studio] Webview view created");
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
				vscode.Uri.joinPath(this.context.extensionUri, "media"),
			],
		};
		this.logDebug("[PiLot Studio] Webview options set");

		this.logDebug("[PiLot Studio] Starting initialization");
		this.initialize()
			.then(async () => {
				this.logDebug(
					"[PiLot Studio] Initialization complete, loading webview content",
				);
				view.webview.html = await this.getWebviewContent(view.webview);
				this.logDebug("[PiLot Studio] Webview content loaded");
				// Auto-create a session so the panel isn't empty on first open
				if (!this.session) {
					this.logDebug("[PiLot Studio] Creating new session");
					await this.newSession();
				}
				this.logDebug("[PiLot Studio] Webview fully initialized");
			})
			.catch((error) => {
				this.logError("[PiLot Studio] Initialization error:", error);
			});

		this.logDebug("[PiLot Studio] Setting up message handler");
		view.webview.onDidReceiveMessage(
			this.messageHandler.handle.bind(this.messageHandler),
		);
		this.logDebug("[PiLot Studio] Message handler set up");

		// Re-sync state when the sidebar becomes visible (e.g. after switching tabs)
		view.onDidChangeVisibility(() => {
			if (view.visible && this.session) {
				this.notifyWebview({
					type: "session-updated",
					data: { sessionId: this.session.sessionId },
				});
				// Re-sync thinking level — TUI may have changed it in settings.json
				const level = this.getThinkingLevel();
				this.notifyWebview({ type: "thinking-level-changed", data: { level } });
				// Refresh installed packages when panel becomes visible
				this.refreshInstalledPackagesInWebview();
			}
			// Re-send cached update info whenever panel becomes visible
			if (view.visible) {
				this.sendUpdatesToWebview(
					this.lastUpdateInfo.piVersion,
					this.lastUpdateInfo.packageCount,
				);
			}
		});
	}

	private getWorkspacePath(): string {
		return this.sessionResources.getWorkspacePath();
	}

	private getConfiguredPackages(): InstalledPackage[] {
		return this.sessionResources.getConfiguredPackages();
	}

	private async listPackagesFromCli(): Promise<InstalledPackage[]> {
		const binaryPath = this.resolvedBinaryPath || findPiBinary();
		const direct = await execFileAsync(binaryPath, ["list"]);
		let packages = parseInstalledPackages(direct.stdout);
		this.logDebug("[PI] listPackagesFromCli: direct parsed packages:", packages);

		if (packages.length > 0) {
			return packages;
		}

		const shellCommand = getShellCommand(binaryPath, ["list"]);
		if (!shellCommand) {
			if (direct.stderr) {
				this.logError("[PI] listPackagesFromCli error:", direct.stderr);
			}
			return packages;
		}

		const fromShell = await execFileAsync(
			shellCommand.command,
			shellCommand.args,
		);
		packages = parseInstalledPackages(fromShell.stdout);
		this.logDebug("[PI] listPackagesFromCli: shell parsed packages:", packages);
		if (packages.length === 0 && (direct.stderr || fromShell.stderr)) {
			this.logError(
				"[PI] listPackagesFromCli error:",
				direct.stderr || fromShell.stderr,
			);
		}

		return packages;
	}

	private async refreshInstalledPackagesInWebview() {
		if (!this.view) return;

		const packages = await this.listPackages();
		this.notifyWebview({ type: "installed", data: packages });
	}

	private async getWebviewContent(webview: vscode.Webview): Promise<string> {
		this.logDebug("[PiLot Studio] Getting webview content");
		// Read the Vite-built index.html directly — it has the correct hashed asset names
		const builtHtmlUri = vscode.Uri.joinPath(
			this.context.extensionUri,
			"dist",
			"webview",
			"index.html",
		);
		this.logDebug("[PiLot Studio] Reading HTML from:", builtHtmlUri.fsPath);
		const builtHtmlBytes = await vscode.workspace.fs.readFile(builtHtmlUri);
		const builtHtml = builtHtmlBytes.toString();
		this.logDebug("[PiLot Studio] HTML content loaded, length:", builtHtml.length);

		// Replace relative asset paths (e.g. ./assets/index-xxx.js) with webview URIs
		// NOTE: Vite's base: './' produces paths like src="./assets/index-xxx.js"
		const webviewRoot = vscode.Uri.joinPath(
			this.context.extensionUri,
			"dist",
			"webview",
		);
		let html = builtHtml.replace(
			/(src|href)="(?:\.\/)?(assets\/[^"\s]+)"/g,
			(_, attr, assetPath) => {
				const uri = webview.asWebviewUri(
					vscode.Uri.joinPath(webviewRoot, assetPath),
				);
				return `${attr}="${uri}"`;
			},
		);

		// Strip `crossorigin` attributes — Vite adds them for production builds but VS Code
		// webview resource URIs don't return CORS headers, causing scripts/styles to silently fail.
		html = html.replace(/crossorigin/gi, "");

		// Remove the hardcoded Content-Security-Policy meta tag — VS Code injects its own
		// CSP that includes the webview's resource origin (cspSource). A hardcoded 'self'-only
		// CSP would block the webview resource URIs (https://<uuid>.vscode-resource.vscode-cdn.net).
		html = html.replace(
			/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="[^"]*"[^>]*\/?>/gi,
			"",
		);

		// Compute webview URIs for media assets and inject them as globals
		const mediaIconUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png"),
		);
		const mediaKofiUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "media", "kofi.png"),
		);
		const mediaScript = `<script>
window.__MEDIA_ICON__ = "${mediaIconUri}";
window.__MEDIA_KOFI__ = "${mediaKofiUri}";
</script>`;
		html = html.replace("</head>", `${mediaScript}</head>`);

		return html;
	}

	async createSession() {
		if (!this.isInitialized) {
			await this.initialize();
		}

		const sessionManager = this.sessionManager;
		const authStorage = this.authStorage;
		const modelRegistry = this.modelRegistry;

		if (!sessionManager || !authStorage || !modelRegistry) {
			throw new Error(
				"PiLot Studio dependencies not initialized. Check your API key configuration.",
			);
		}

		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

		// Build createAgentSession options from VS Code settings to match PI CLI behavior
		const sessionOpts = await this.buildSessionOptions(cwd);

		const { session } = await createAgentSession({
			...sessionOpts,
			sessionManager,
			authStorage,
			modelRegistry,
		});

		this.session = session;
		this.session.subscribe(this.handleSessionEvent.bind(this));

		// Bind extension UI context so package setStatus(") calls reach the webview
		this.bindExtensionUI();

		return this.session;
	}

	/**
	 * Auto-generate a descriptive session name from the first user/assistant exchange,
	 * if the session doesn't already have a name.
	 */
	private autoGenerateSessionName(): void {
		if (!this.session) return;
		if (this.session.sessionName) return;

		const messages = this.session.messages;
		if (messages.length < 2) return;

		const firstUserMsg = messages.find((m) => m.role === "user");
		const firstAssistantMsg = messages.find((m) => m.role === "assistant");

		if (!firstUserMsg) return;

		const userText = extractTextFromMessage(firstUserMsg);
		const assistantText = firstAssistantMsg
			? extractTextFromMessage(firstAssistantMsg)
			: "";

		const name = generateSessionName(userText, assistantText);
		if (name) {
			this.logDebug("[PI] Auto-generated session name:", name);
			this.session.setSessionName(name);
		}
	}

	async deleteSessions(sessionIds: string[]) {
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		try {
			const allSessions = await SessionManager.list(
				cwd,
				this.config.sessionDir,
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
						this.logError(
							`[PI] Failed to delete session ${sessionId}:`,
							error,
						);
						throw error;
					}
				}),
			);

			if (
				this.session &&
				sessionIds.includes(this.session.sessionId)
			) {
				this.session.dispose();
				this.session = undefined;
				await this.newSession();
			}

			await this.refreshSessionList();
		} catch (error) {
			this.logError("[PI] Failed to delete sessions:", error);
			vscode.window.showErrorMessage(
				`Failed to delete sessions: ${String(error)}`,
			);
			throw error;
		}
	}

	/** Build session options from VS Code configuration to match PI CLI behavior. */
	private async buildSessionOptions(cwd: string): Promise<{
		cwd: string;
		agentDir: string;
		resourceLoader: ResourceLoader;
		tools?: string[];
		noTools?: "all" | "builtin";
	}> {
		const config = vscode.workspace.getConfiguration("pi-agent");

		// Read extra resource paths
		const extraExtensions = config.get<string[]>("extraExtensions", []);
		const extraSkills = config.get<string[]>("extraSkills", []);
		const extraPromptTemplates = config.get<string[]>("extraPromptTemplates", []);

		// Read discovery flags
		const disableExtensions = config.get<boolean>("disableExtensionDiscovery", false);
		const disableSkills = config.get<boolean>("disableSkillDiscovery", false);
		const disablePromptTemplates = config.get<boolean>("disablePromptTemplateDiscovery", false);
		const disableContextFiles = config.get<boolean>("disableContextFiles", false);

		// Read system prompt settings
		const systemPrompt = config.get<string | null>("systemPrompt", null);
		const appendSystemPrompts = config.get<string[]>("appendSystemPrompts", []);

		// Read tool preset settings
		const toolPreset = config.get<string>("toolPreset", "default");
		const customTools = config.get<string[]>("customTools", []);

		// Build tools array based on preset
		let tools: string[] | undefined;
		let noTools: "all" | "builtin" | undefined;

		switch (toolPreset) {
			case "none":
				noTools = "all";
				break;
			case "review":
				tools = ["read", "grep", "find", "ls"];
				break;
			case "custom":
				tools = customTools.length > 0 ? customTools : undefined;
				break;
			case "default":
				// Default: no restrictions, use built-in tools
				break;
		}

		// Create a resource loader with VS Code settings applied
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			settingsManager: this.settingsManager,
			additionalExtensionPaths: extraExtensions.length > 0 ? extraExtensions : undefined,
			additionalSkillPaths: extraSkills.length > 0 ? extraSkills : undefined,
			additionalPromptTemplatePaths: extraPromptTemplates.length > 0 ? extraPromptTemplates : undefined,
			noExtensions: disableExtensions,
			noSkills: disableSkills,
			noPromptTemplates: disablePromptTemplates,
			noContextFiles: disableContextFiles,
			systemPrompt: systemPrompt || undefined,
			appendSystemPrompt: appendSystemPrompts.length > 0 ? appendSystemPrompts : undefined,
		});

		// Load skills, extensions, prompts, and context files from settings
		await resourceLoader.reload();

		return {
			cwd,
			agentDir: getAgentDir(),
			resourceLoader,
			tools,
			noTools,
		};
	}

	async newSession() {
		this._autoNamingTriggered = false;
		// Dispose old session properly before creating a new one
		this.stopStatusPoller();
		this.extensionStatuses.clear();
		this.notifyWebview({ type: "extension-statuses-clear" });
		if (this.session) {
			this.session.dispose();
			this.session = undefined as any;
		}
		// Create a new session file on disk — resets the SessionManager state
		// so createAgentSession starts fresh instead of continuing.
		if (this.sessionManager) {
			this.sessionManager.newSession();
		}
		await this.createSession();
		this._onDidChangeTreeData.fire();
		this.notifyWebview({
			type: "session-updated",
			data: { sessionId: this.session?.sessionId },
		});
		// Push initial context usage
		const usage = this.getContextUsage();
		this.notifyWebview({
			type: "context-usage",
			data: usage ?? { tokens: null, contextWindow: 0, percent: null },
		});
		// Push initial token stats
		this.sendSessionStats();
		// Send loaded resources: contexts, skills, extensions, and packages
		await this.sendSessionResources();
	}

	async sendSessionResources() {
		if (!this.session) return;
		try {
			const cwd =
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
			const agentDir = getAgentDir();

			// Use the session resource loader so the webview matches the TUI exactly.
			let contextFiles: Array<{ path: string }> = [];
			let skills: any[] = [];
			let extensions: any[] = [];
			let prompts: any[] = [];
			try {
				const rl = (this.session as any).resourceLoader;
				if (rl) {
					const agentsFilesResult = rl.getAgentsFiles?.();
					contextFiles = agentsFilesResult?.agentsFiles || [];
					const sr = rl.getSkills();
					skills = sr.skills || [];
					const er = rl.getExtensions();
					extensions = er.extensions || [];
					const pr = rl.getPrompts?.();
					prompts = pr?.prompts || [];
				}
			} catch {
				contextFiles = [];
				skills = [];
				extensions = [];
				prompts = [];
			}

			// Collect VS Code active extensions
			const vscodeExtensions = vscode.extensions.all
				.filter((ext) => ext.isActive)
				.map((ext) => ({
					id: ext.id,
					name: ext.packageJSON?.displayName || ext.packageJSON?.name || ext.id,
					version: ext.packageJSON?.version || "",
				}));

			// Collect currently installed PI packages
			const installedPkgs = await this.listPackages();

			this.logDebug("[PI] sendSessionResources cwd:", cwd, "agentDir:", agentDir);
			this.logDebug(
				"[PI] contextFiles:",
				JSON.stringify(contextFiles.map((f: any) => f.path)),
			);
			this.logDebug(
				"[PI] skills:",
				skills.length,
				"extensions:",
				extensions.length,
				"vscodeExtensions:",
				vscodeExtensions.length,
				"packages:",
				installedPkgs.length,
			);

			this.notifyWebview({
				type: "session-resources",
				data: {
					skills: skills.map((s: any) => ({
						name: s.name,
						description: s.description,
					})),
					skillCount: skills.length,
					extensions: extensions.map((e: any) => ({
						path: e.path,
						sourceInfo: e.sourceInfo ? { name: e.sourceInfo.name } : null,
					})),
					extensionCount: extensions.length,
					prompts: prompts.map((p: any) => ({
						name: p.name,
						description: p.description,
					})),
					promptCount: prompts.length,
					vscodeExtensions,
					vscodeExtensionCount: vscodeExtensions.length,
					contextFiles: contextFiles.map((f: any) => ({ path: f.path })),
					contextFileCount: contextFiles.length,
					packages: installedPkgs.map((p) => ({ source: p.source, path: p.path })),
					packageCount: installedPkgs.length,
				},
			});
		} catch (e) {
			this.logError("[PI] sendSessionResources failed:", e);
		}
	}

	async switchSession(sessionId: string) {
		this._autoNamingTriggered = false;
		// Find the session info from the list
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const allSessions = await SessionManager.list(cwd, this.config.sessionDir);
		const info = allSessions.find((s) => s.id === sessionId);
		if (!info) return;

		// Dispose old session
		this.stopStatusPoller();
		this.extensionStatuses.clear();
		this.notifyWebview({ type: "extension-statuses-clear" });
		if (this.session) {
			this.session.dispose();
			this.session = undefined;
		}

		// Open the session file and create a new agent session from it
		const sessionManager = SessionManager.open(
			info.path,
			this.config.sessionDir,
			cwd,
		);

		// Build session options from VS Code configuration to match PI CLI behavior
		const sessionOpts = await this.buildSessionOptions(cwd);

		const { session } = await createAgentSession({
			...sessionOpts,
			sessionManager,
			authStorage: this.authStorage,
			modelRegistry: this.modelRegistry,
		});

		this.sessionManager = sessionManager;
		this.session = session;
		this.session.subscribe(this.handleSessionEvent.bind(this));
		this._onDidChangeTreeData.fire();

		// Send session ID + message history to webview
		const messages = this.serializeMessages(session.messages);
		this.notifyWebview({
			type: "session-history",
			data: { sessionId: this.session.sessionId, messages },
		});
		await this.sendSessionResources();
	}

	async forkSession(fromNodeId?: string) {
		if (this.session) {
			await this.session.navigateTree(fromNodeId || this.session.sessionId);
		}
		this._onDidChangeTreeData.fire();
	}

	async navigateTree(nodeId: string) {
		if (this.session) {
			await this.session.navigateTree(nodeId);
			this._onDidChangeTreeData.fire();
		}
	}

	async setSessionName(name: string) {
		if (this.session) {
			this.session.setSessionName(name);
		}
	}

	private isBinaryExtension(filePath: string): boolean {
		return isBinaryExtension(filePath);
	}

	private async resolveFileMentions(text: string): Promise<string> {
		return this.sessionResources.resolveFileMentions(text);
	}

	private areImagesValid(images: unknown[]): images is Array<{ type: "image"; data: string; mimeType: string }> {
		return areImagesValid(images);
	}

	async prompt(text: string, images?: any[]) {
		if (!this.session) {
			await this.createSession();
		}

		if (!this.session) {
			throw new Error("Failed to create session");
		}

		// Validate and convert images to ImageContent[]
		const validImages = images && this.areImagesValid(images)
			? images as Array<{ type: "image"; data: string; mimeType: string }>
			: undefined;

		// Build prompt options: include images when provided, handle streaming
		const promptOpts = this.session.isStreaming
			? { streamingBehavior: "steer" as const, images: validImages }
			: validImages
				? { images: validImages }
				: undefined;

		// Try to handle slash commands locally first (text-only slash commands)
		if (text.startsWith("/") && !validImages) {
			const handled = await this.tryHandleCommand(text);
			if (handled) {
				return;
			}
			// Extension command or unknown slash - execute immediately via prompt
			try {
				await this.session.prompt(text, promptOpts);
			} catch (error) {
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				throw error;
			}
			return;
		}

		// Resolve @file mentions to actual file content
		const textWithFiles = await this.resolveFileMentions(text);

		const context = this.config.autoContext
			? await this.getProjectContext()
			: "";
		const fullPrompt = context
			? `${context}\n\n${textWithFiles}`
			: textWithFiles;

		try {
			await this.session.prompt(fullPrompt, promptOpts);
		} catch (error) {
			// Send error to webview
			this.notifyWebview({
				type: "error",
				data: {
					message: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
			});
			throw error;
		}
	}

	/** Try to handle slash commands locally. Returns true if handled. */
	private async tryHandleCommand(text: string): Promise<boolean> {
		// Handle /logout here — it needs direct access to session.prompt
		// with streamingBehavior: "steer" which differs from the default prompt path.
		const spaceIdx = text.indexOf(" ");
		const cmd = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);

		if (cmd === "logout") {
			try {
				if (this.session) {
					await this.session.prompt(text, { streamingBehavior: "steer" });
				}
			} catch (error) {
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
			}
			return true;
		}

		const ctx: SlashCommandContext = {
			notifyWebview: this.notifyWebview.bind(this),
			logError: this.logError.bind(this),
			session: this.session ? {
				sessionName: this.session.sessionName,
				sessionId: this.session.sessionId,
				setSessionName: (n) => this.session!.setSessionName(n),
				compact: (t) => this.session!.compact(t),
				getSessionStats: () => this.session!.getSessionStats(),
				exportToJsonl: (p) => this.session!.exportToJsonl(p),
				exportToHtml: (p) => this.session!.exportToHtml(p),
				getLastAssistantText: () => this.session!.getLastAssistantText(),
				messages: this.session!.messages,
			} : undefined,
			forkSession: this.forkSession.bind(this),
			sendSessionResources: this.sendSessionResources.bind(this),
		};
		return tryHandleSlashCommand(text, ctx);
	}

	async steer(text: string, images?: any[]) {
		if (this.session) {
			try {
				const validImages = images && this.areImagesValid(images)
					? images as Array<{ type: "image"; data: string; mimeType: string }>
					: undefined;
				await this.session.steer(text, validImages);
			} catch (error) {
				// Send error to webview
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				throw error;
			}
		}
	}

	async followUp(text: string, images?: any[]) {
		if (this.session) {
			try {
				const validImages = images && this.areImagesValid(images)
					? images as Array<{ type: "image"; data: string; mimeType: string }>
					: undefined;
				await this.session.followUp(text, validImages);
			} catch (error) {
				// Send error to webview
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				throw error;
			}
		}
	}

	async setModel(modelId: string) {
		if (!this.session || !this.modelRegistry) return;

		// modelId is formatted as "provider/id", e.g. "anthropic/claude-sonnet-4-5"
		const parts = modelId.split("/");
		if (parts.length < 2) return;
		const provider = parts[0];
		const id = parts.slice(1).join("/");

		const model = this.modelRegistry.find(provider, id);
		if (model) {
			await this.session.setModel(model);
		}

		// Persist selection — sync with TUI settings.json
		this.currentModelId = modelId;
		await this.context.globalState.update("currentModelId", modelId);

		// Write to settings.json so PI TUI picks it up
		if (this.settingsManager) {
			this.settingsManager.setDefaultModelAndProvider(provider, id);
			await this.settingsManager.flush();
		}

		// Broadcast to webview
		this.notifyWebview({ type: "model-changed", data: { modelId } });
	}

	async setThinkingLevel(
		level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
	) {
		if (this.session) {
			this.session.setThinkingLevel(level);
		}
		// Persist to settings.json so PI TUI reads same value
		if (this.settingsManager) {
			this.settingsManager.setDefaultThinkingLevel(level);
			await this.settingsManager.flush();
		}
	}

	async abort() {
		if (this.session) {
			try {
				await this.session.abort();
			} catch (error) {
				// Send error to webview
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				throw error;
			}
		}
	}

	async compact() {
		if (this.session) {
			try {
				const result = await this.session.compact();
				// Refresh context usage after compaction
				const usage = this.getContextUsage();
				this.notifyWebview({ type: "context-usage", data: usage });
				return result;
			} catch (error) {
				// Send error to webview
				this.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				throw error;
			}
		}
	}

	getContextUsage() {
		if (!this.session) return null;
		const usage = this.session.getContextUsage();
		// Also get auto-compaction status
		return usage
			? { ...usage, autoCompactionEnabled: this.session.autoCompactionEnabled }
			: null;
	}

	getSessionStats() {
		if (!this.session) return null;
		return this.session.getSessionStats();
	}

	getAutoCompactionEnabled(): boolean {
		return this.session?.autoCompactionEnabled ?? true;
	}

	setAutoCompactionEnabled(enabled: boolean) {
		if (this.session) {
			this.session.setAutoCompactionEnabled(enabled);
			this.notifyWebview({
				type: "auto-compaction-changed",
				data: { enabled },
			});
		}
	}

	async getAvailableModels() {
		if (!this.isInitialized) {
			await this.initialize();
		}
		return this.availableModels;
	}

	/** @internal Exposed for the update checker and other extension internals. */
	getSettingsManager(): SettingsManager | undefined {
		return this.settingsManager;
	}

	/**
	 * Send update availability info (or clear signal) to the webview.
	 * Called by the update checker when new updates are discovered or cleared.
	 */
	sendUpdatesToWebview(
		piVersion: string | null,
		packageCount: number,
	): void {
		// Cache so we can re-send when the panel becomes visible
		this.lastUpdateInfo = { piVersion, packageCount };

		if (piVersion || packageCount > 0) {
			this.notifyWebview({
				type: "updates-available",
				data: { piVersion, packageCount },
			});
		} else {
			this.notifyWebview({ type: "updates-cleared" });
		}
	}

	getCurrentModelId(): string | null {
		return this.currentModelId;
	}

	getThinkingLevel(): ThinkingLevel {
		if (this.settingsManager) {
			const level = this.settingsManager.getDefaultThinkingLevel();
			if (level) return level;
		}
		return this.config.thinkingLevel;
	}

	getFavorites(): string[] {
		return this.favoriteModels;
	}

	/**
	 * Get the set of model IDs known to the user's PI CLI.
	 * Runs `pi --list-models` and parses the output.
	 * Cached for the session lifetime; invalidated on auth changes.
	 */
	private async getCliModelIds(): Promise<Set<string>> {
		if (this.cliModelIdsCache) return this.cliModelIdsCache;
		if (!this.cliModelIdsPromise) {
			this.cliModelIdsPromise = this._resolveCliModelIds()
				.then(ids => {
					this.cliModelIdsCache = ids;
					return ids;
				})
				.catch(() => {
					this.cliModelIdsCache = new Set();
					return this.cliModelIdsCache;
				});
		}
		return this.cliModelIdsPromise;
	}

	private _resolveCliModelIds(): Promise<Set<string>> {
		const binaryPath = this.resolvedBinaryPath || findPiBinary();
		return execFileAsync(binaryPath, ["--list-models"]).then(({ stdout, stderr }) => {
			const output = (stderr || '') + '\n' + (stdout || '');
			const models = new Set<string>();

			for (const line of output.split('\n')) {
				// Match: "provider  modelId  context  max-out  thinking  images"
				const match = line.match(/^(\S+)\s+(\S+)\s+\S/);
				if (match && match[1] !== 'provider' && !match[0].startsWith('Warning')) {
					models.add(`${match[1]}/${match[2]}`);
				}
			}

			return models;
		}).catch(() => {
			this.logError("[PI] Failed to list CLI models - is 'pi' installed and on PATH?");
			return new Set<string>();
		});
	}

	/**
	 * Sync favorites to PI CLI's settings.json (enabledModels).
	 * Only writes patterns that the PI CLI actually knows about,
	 * preventing warnings from version mismatches.
	 */
	private async syncFavoritesToSettings(): Promise<void> {
		if (!this.settingsManager) return;

		const cliModels = await this.getCliModelIds();

		// If CLI not available or not yet resolved, skip sync
		if (cliModels.size === 0) return;

		// Only write patterns that the CLI actually knows about
		const validPatterns = this.favoriteModels.filter(pattern =>
			cliModels.has(pattern)
		);

		this.settingsManager.setEnabledModels(validPatterns);
		await this.settingsManager.flush();
	}

	/**
	 * Merge PI CLI's scoped models into extension favorites.
	 * Picks up models set outside the extension (e.g., via Ctrl+P in PI CLI).
	 */
	private async syncFromCliModels(): Promise<void> {
		const cliModels = await this.getCliModelIds();
		if (cliModels.size === 0) return;

		const settingsModels = this.settingsManager?.getEnabledModels() || [];
		if (settingsModels.length === 0) return;

		// Add CLI models that the extension also knows about
		const newModels = settingsModels.filter(pattern =>
			cliModels.has(pattern) &&
			this.availableModels.some(m => m.id === pattern) &&
			!this.favoriteModels.includes(pattern)
		);

		if (newModels.length > 0) {
			this.favoriteModels = [...this.favoriteModels, ...newModels];
			await this.context.globalState.update("favoriteModels", this.favoriteModels);
			this.notifyWebview({
				type: "favorites-updated",
				data: { favorites: this.favoriteModels },
			});
		}
	}

	async toggleFavorite(
		modelId: string,
		isFavorite: boolean,
	): Promise<string[]> {
		if (isFavorite && !this.favoriteModels.includes(modelId)) {
			// Guard: only add models that exist in the current registry
			if (!this.availableModels.some(m => m.id === modelId)) {
				return this.favoriteModels;
			}
			this.favoriteModels = [...this.favoriteModels, modelId];
		} else if (!isFavorite) {
			this.favoriteModels = this.favoriteModels.filter((m) => m !== modelId);
		}
		await this.context.globalState.update(
			"favoriteModels",
			this.favoriteModels,
		);

		// Sync to PI CLI settings.json (validates against CLI model list)
		await this.syncFavoritesToSettings();

		return this.favoriteModels;
	}

	async getProviderAuthData(): Promise<
		Array<{
			provider: string;
			name: string;
			configured: boolean;
			status: string;
		}>
	> {
		if (!this.isInitialized || !this.modelRegistry) {
			await this.initialize();
		}
		if (!this.modelRegistry) return [];

		const models = this.modelRegistry.getAll();
		const seen = new Set<string>();
		const result: Array<{
			provider: string;
			name: string;
			configured: boolean;
			status: string;
		}> = [];

		for (const model of models) {
			if (seen.has(model.provider)) continue;
			seen.add(model.provider);

			const authStatus = this.modelRegistry.getProviderAuthStatus(
				model.provider,
			);
			const displayName = this.modelRegistry.getProviderDisplayName(
				model.provider,
			);
			result.push({
				provider: model.provider,
				name: displayName || model.provider,
				configured: authStatus.configured,
				status:
					authStatus.source ||
					(authStatus.configured ? "configured" : "not_configured"),
			});
		}

		return result.sort((a, b) => a.provider.localeCompare(b.provider));
	}

	async setApiKey(provider: string, apiKey: string) {
		if (!this.isInitialized || !this.authStorage) {
			await this.initialize();
		}
		if (!this.authStorage) throw new Error("Auth storage not initialized");

		this.authStorage.set(provider, { type: "api_key", key: apiKey });
		await this.refreshAvailableModels();
		this.notifyWebview({
			type: "provider-auth",
			data: await this.getProviderAuthData(),
		});
	}

	async removeAuth(provider: string) {
		if (!this.isInitialized || !this.authStorage) {
			await this.initialize();
		}
		if (!this.authStorage) throw new Error("Auth storage not initialized");

		this.authStorage.remove(provider);
		await this.refreshAvailableModels();
		this.cliModelIdsCache = null;
		this.cliModelIdsPromise = null;
		this.notifyWebview({
			type: "provider-auth",
			data: await this.getProviderAuthData(),
		});
	}

	async listSessions(): Promise<SessionItem[]> {
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		try {
			const sessions = await SessionManager.list(cwd, this.config.sessionDir);
			this.sessionList = sessions.map((s) => ({
				id: s.id,
				label: s.name || s.firstMessage.slice(0, 60) || "Untitled",
				timestamp: s.modified.getTime(),
				messageCount: s.messageCount,
			}));
		} catch {
			this.sessionList = [];
		}
		return this.sessionList;
	}

	private async refreshSessionList() {
		await this.listSessions();
		this.notifyWebview({ type: "sessions-list", data: this.sessionList });
	}

	/** @deprecated Use listSessions() for webview, kept for native tree view compatibility */
	async getSessionTree(): Promise<SessionNode[]> {
		const items = await this.listSessions();
		return items.map(
			(i) =>
				({
					...i,
					children: [],
					parent: null,
				}) as SessionNode,
		);
	}

	private handleSessionEvent(event: AgentSessionEvent) {
		this.notifyWebview({ type: "pi-event", data: event });

		// Refresh the session list when messages change
		if (event.type === "message_end" || event.type === "agent_end") {
			this.refreshSessionList();
		}

		// Push token stats on message/agent end
		if (event.type === "message_end" || event.type === "agent_end") {
			this.sendSessionStats();
		}

		// Push context usage on session events that change context
		if (
			event.type === "compaction_end" ||
			event.type === "session_info_changed" ||
			event.type === "thinking_level_changed"
		) {
			const usage = this.getContextUsage();
			this.notifyWebview({
				type: "context-usage",
				data: usage ?? { tokens: null, contextWindow: 0, percent: null },
			});
		}

		if (event.type === "session_info_changed") {
			this.sendSessionResources().catch((e) =>
				this.logError("[PI] sendSessionResources in event handler failed:", e),
			);
		}

		// Auto-generate a session name on the first successful assistant response
		if (
			event.type === "agent_end" &&
			!event.willRetry &&
			!this._autoNamingTriggered
		) {
			this._autoNamingTriggered = true;
			this.autoGenerateSessionName();
		}

		// Derive activity statuses from session events
		if (event.type === "tool_execution_start") {
			const toolName = event.toolName || "tool";
			this.notifyWebview({
				type: "activity-start",
				data: { key: `tool:${event.toolCallId}`, text: `${toolName}`, activityType: "tool" },
			});
		} else if (event.type === "tool_execution_end") {
			this.notifyWebview({
				type: "activity-end",
				data: { key: `tool:${event.toolCallId}` },
			});
		} else if (event.type === "compaction_start") {
			this.notifyWebview({
				type: "activity-start",
				data: { key: "compaction", text: "Compacting context", activityType: "system" },
			});
		} else if (event.type === "compaction_end") {
			this.notifyWebview({
				type: "activity-end",
				data: { key: "compaction" },
			});
		} else if (event.type === "auto_retry_start") {
			const attempt = event.attempt || 1;
			this.notifyWebview({
				type: "activity-start",
				data: { key: "retry", text: `Retry ${attempt}/${event.maxAttempts || "?"}`, activityType: "system" },
			});
		} else if (event.type === "auto_retry_end") {
			this.notifyWebview({
				type: "activity-end",
				data: { key: "retry" },
			});
		}
	}

	/** Serialize AgentSession messages to webview-friendly format */
	private serializeMessages(messages: any[]) {
		return serializeMessages(messages);
	}

	private sendSessionStats() {
		const stats = this.getSessionStats();
		if (stats) {
			this.notifyWebview({
				type: "session-stats",
				data: { tokens: stats.tokens },
			});
		}
	}

	/**
	 * Bind a custom ExtensionUIContext to the session's extension runner
	 * so that ctx.ui.setStatus() calls from packages are forwarded to the webview.
	 */
	private bindExtensionUI(): void {
		if (!this.session) return;

		try {
			const runner = this.session.extensionRunner;
			if (!runner) return;

			// Create a UI context that forwards setStatus calls to the webview
			runner.setUIContext({
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
				onTerminalInput: () => () => {},
				setStatus: (key: string, text: string | undefined) => {
					if (text === undefined || text === null) {
						this.extensionStatuses.delete(key);
					} else {
						this.extensionStatuses.set(key, text);
					}
					this.notifyWebview({
						type: "extension-status",
						data: { key, text: text ?? undefined },
					});
				},
				setWorkingMessage: () => {},
				setWorkingVisible: () => {},
				setWorkingIndicator: () => {},
				setHiddenThinkingLabel: () => {},
				setWidget: () => {},
				setFooter: () => {},
				setHeader: () => {},
				setTitle: () => {},
				custom: async <T>() => undefined as unknown as T,
				pasteToEditor: () => {},
				setEditorText: () => {},
				getEditorText: () => "",
				editor: async () => undefined,
				addAutocompleteProvider: () => {},
				setEditorComponent: () => {},
				getEditorComponent: () => undefined,
				get theme() {
					return undefined as unknown as import("@earendil-works/pi-coding-agent").ExtensionUIContext["theme"];
				},
				getAllThemes: () => [],
				getTheme: () => undefined,
				setTheme: () => ({ success: false, error: "UI not available" }),
				getToolsExpanded: () => false,
				setToolsExpanded: () => {},
			});

			this.logDebug("[PI] Bound extension UI context for setStatus forwarding");

			// Also bind extensions with our UI context
			this.session.bindExtensions({
				uiContext: runner.getUIContext(),
			}).catch((err: unknown) => {
				this.logError("[PI] bindExtensions failed:", err);
			});

			// Start polling extension statuses as a fallback
			this.startStatusPoller();
		} catch (err) {
			this.logError("[PI] Failed to bind extension UI context:", err);
		}
	}

	/** Start polling extension statuses from the runner as a fallback/sync mechanism. */
	private startStatusPoller(): void {
		this.stopStatusPoller();
		this.statusPoller = setInterval(() => {
			this.pollExtensionStatuses();
		}, 2000);
	}

	/** Stop the status poller. */
	private stopStatusPoller(): void {
		if (this.statusPoller !== undefined) {
			clearInterval(this.statusPoller);
			this.statusPoller = undefined;
		}
	}

	/**
	 * Poll the extension runner for all current extension statuses.
	 * This syncs statuses in case setStatus was called before our UI context was attached
	 * or by extensions that bypass the UI context.
	 */
	private pollExtensionStatuses(): void {
		if (!this.session) return;

		try {
			const runner = this.session.extensionRunner;
			if (!runner || !runner.hasUI()) return;

			// The extension runner stores statuses via the FooterDataProvider.
			// Since we can't access FooterDataProvider directly from the extension host,
			// we rely on the setStatus forwarding from our UI context.
			// This poller is a safety net — send the current full map.
			if (this.extensionStatuses.size > 0) {
				this.notifyWebview({
					type: "extension-statuses-full",
					data: Object.fromEntries(this.extensionStatuses),
				});
			}
		} catch {
			// Silently ignore — session may be disposed
		}
	}

	private notifyWebview(message: { type: string; data?: unknown }) {
		if (this.view) {
			this.view.webview.postMessage(message);
		}
	}

	private async getProjectContext(): Promise<string> {
		return this.sessionResources.getProjectContext();
	}

	// Package management methods using CLI
	async listPackages() {
		this.logDebug("[PI] listPackages called");
		const configuredPackages = this.getConfiguredPackages();
		if (configuredPackages.length > 0) {
			this.logDebug(
				"[PI] listPackages: found configured packages:",
				configuredPackages,
			);
			return configuredPackages;
		}

		return this.listPackagesFromCli();
	}

	private spawnPackageCommand(args: string[]): ChildProcess {
		const binaryPath = this.resolvedBinaryPath || findPiBinary();
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
			this.notifyWebview({ type: "loading", data: { loading: true } });

			const proc = this.spawnPackageCommand(args);

			let output = "";
			proc.stdout?.on("data", (chunk) => {
				output += chunk.toString();
				this.notifyWebview({
					type: "output",
					data: { text: chunk.toString() },
				});
			});
			proc.stderr?.on("data", (chunk) => {
				output += chunk.toString();
				this.notifyWebview({
					type: "output",
					data: { text: chunk.toString() },
				});
			});

			proc.on("close", (code) => {
				// Send loading end
				this.notifyWebview({ type: "loading", data: { loading: false } });
				if (code === 0) {
					this.notifyWebview({ type: "packages-updated" });
					resolve();
				} else {
					reject(new Error(output || `Command failed with code ${code}`));
				}
			});

			proc.on("error", (err) => {
				this.notifyWebview({ type: "loading", data: { loading: false } });
				reject(err);
			});
		});
	}

	async installPackage(source: string) {
		await this.runPackageCommand(["install", source]);
	}

	async uninstallPackage(source: string) {
		await this.runPackageCommand(["remove", source]);
	}

	async updatePackages() {
		await this.runPackageCommand(["update"]);
	}

	async cycleModel() {
		if (!this.isInitialized) {
			await this.initialize();
		}

		const models = this.availableModels;
		if (models.length === 0) return;

		const currentIndex = models.findIndex((m) => m.id === this.currentModelId);
		const nextModel = models[(currentIndex + 1) % models.length];
		if (nextModel) {
			await this.setModel(nextModel.id);
		}
	}

	async cycleThinkingLevel() {
		if (!this.isInitialized) {
			await this.initialize();
		}

		const thinkingLevels: ThinkingLevel[] = [
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
		];
		const currentIndex = thinkingLevels.indexOf(
			this.config.thinkingLevel as ThinkingLevel,
		);
		const nextLevel =
			thinkingLevels[(currentIndex + 1) % thinkingLevels.length] || "medium";

		await this.setThinkingLevel(nextLevel);
		this.notifyWebview({
			type: "thinking-level-changed",
			data: { level: nextLevel },
		});
	}

	private setupEditorWebview(panel: vscode.WebviewPanel) {
		panel.webview.onDidReceiveMessage(
			this.messageHandler.handle.bind(this.messageHandler),
		);
	}

	async openCurrentSessionInEditor() {
		if (!this.session) {
			vscode.window.showInformationMessage("No active session to open");
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			"piChatEditor",
			`PI: ${this.session.sessionId}`,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
					vscode.Uri.joinPath(this.context.extensionUri, "media"),
				],
				retainContextWhenHidden: true,
			},
		);
		this.setupEditorWebview(panel);
		panel.webview.html = await this.getWebviewContent(panel.webview);

		// Show session history in the editor
		const messages = this.serializeMessages(this.session.messages);
		panel.webview.postMessage({
			type: "session-history",
			data: { sessionId: this.session.sessionId, messages },
		});
	}

	async newChatInEditor() {
		await vscode.commands.executeCommand("pi-agent.newSession");

		const panel = vscode.window.createWebviewPanel(
			"piChatEditor",
			"PI: New Chat",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
					vscode.Uri.joinPath(this.context.extensionUri, "media"),
				],
				retainContextWhenHidden: true,
			},
		);
		this.setupEditorWebview(panel);
		panel.webview.html = await this.getWebviewContent(panel.webview);
	}

	// Public method for commands to notify webview
	notifyWebviewFromCommand(type: string, data?: unknown) {
		this.notifyWebview({ type, data });
	}

	// Voice Capture Methods — delegated to VoiceManager

	async toggleVoiceCapture() {
		await this.voiceManager.toggleVoiceCapture();
	}

	dispose() {
		this.stopStatusPoller();
		this.extensionStatuses.clear();
		this._onDidChangeTreeData.dispose();
		if (this.session) {
			this.session.dispose();
		}
		this.voiceManager.dispose();
	}
}

// ── Auto-naming helpers ──────────────────────────────────────────────────────

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
		.filter((c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string")
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
export function generateSessionName(userText: string, assistantText: string): string {
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
			const stripped = lines[0].replace(
				/^(I'?ll\s|Let me\s|I can\s|I will\s|I'm going to\s|Here's\s|Here is\s)/i,
				"",
			).trim();
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
