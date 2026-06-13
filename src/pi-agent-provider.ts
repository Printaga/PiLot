import * as vscode from "vscode";
import * as fs from "node:fs/promises";
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
	type Skill,
	type Extension,
	type PromptTemplate,
} from "@earendil-works/pi-coding-agent";
import { MessageHandler } from "./message-handler.js";
import { VoiceManager } from "./voice-manager.js";
import { type ThinkingLevel } from "./webview/types/index.js";

import {
	checkBetterSqlite3,
	describeABIStatus,
	ensureBetterSqlite3Compatible,
} from "./utils/native-addons.js";

import { BinaryService } from "./binary-service.js";
import { FooterManager } from "./footer-manager.js";
import { ExtensionUIContext } from "./extension-ui-context.js";
import { ModelRegistryHandler } from "./model-registry-handler.js";
import { PackageManager } from "./package-manager.js";
import { SessionListManager, type SessionItem } from "./session-manager.js";

import { type EnrichedPackage } from "./pi-binary.js";
import { SessionResources, areImagesValid } from "./session-resources.js";
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

// RegistryModel type moved to model-registry-handler.ts

export class PiAgentProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	private _webview?: vscode.Webview;
	private view?: vscode.WebviewView;
	private session?: AgentSession;
	// Cached update info for re-sending to webview on visibility change
	private lastUpdateInfo: { piVersion: string | null; packageCount: number } = {
		piVersion: null,
		packageCount: 0,
	};
	private config: PiAgentConfig;
	private messageHandler: MessageHandler;
	private isInitialized = false;
	private authStorage?: AuthStorage;
	private modelRegistry?: ModelRegistry;
	private sessionManager?: SessionManager;
	private settingsManager?: SettingsManager;
	private binaryService = new BinaryService();
	private footerManager!: FooterManager;
	private extensionUIContext!: ExtensionUIContext;
	private modelRegistryHandler!: ModelRegistryHandler;
	private packageManager!: PackageManager;
	private sessionListManager!: SessionListManager;
	private availableModels: Array<{
		id: string;
		provider: string;
		name: string;
	}> = [];
	private favoriteModels: string[] = [];
	private currentModelId: string | null = null;
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	/** Extension activity statuses forwarded from packages via ctx.ui.setStatus(). Cleared only when the extension explicitly clears them. */
	private extensionStatuses = new Map<string, string>();

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
		this.footerManager = new FooterManager(this.binaryService, (msg) =>
			this.notifyWebview(msg),
		);
		this.extensionUIContext = new ExtensionUIContext({
			getSession: () => this.session,
			extensionStatuses: this.extensionStatuses,
			notifyWebview: (msg) => this.notifyWebview(msg),
			logDebug: this.logDebug.bind(this),
			logError: this.logError.bind(this),
		});
		this.modelRegistryHandler = new ModelRegistryHandler({
			getModelRegistry: () => this.modelRegistry,
			getAuthStorage: () => this.authStorage,
			getSettingsManager: () => this.settingsManager,
			binaryService: this.binaryService,
			availableModels: this.availableModels,
			favoriteModels: this.favoriteModels,
			currentModelId: this.currentModelId,
			globalState: this.context.globalState,
			notifyWebview: (msg) => this.notifyWebview(msg),
			logError: this.logError.bind(this),
			logDebug: this.logDebug.bind(this),
		});
		this.packageManager = new PackageManager({
			getResourceLoader: () => this.session?.resourceLoader,
			getConfiguredPackages: () =>
				this.sessionResources.getConfiguredPackages(),
			binaryService: this.binaryService,
			notifyWebview: (msg) => this.notifyWebview(msg),
			logDebug: this.logDebug.bind(this),
			logError: this.logError.bind(this),
		});
		this.sessionListManager = new SessionListManager({
			config: this.config,
			getSession: () => this.session,
			setSession: (session) => {
				this.session = session;
			},
			getSessionManager: () => this.sessionManager,
			setSessionManager: (manager) => {
				this.sessionManager = manager;
			},
			getAuthStorage: () => this.authStorage,
			getModelRegistry: () => this.modelRegistry,
			getSettingsManager: () => this.settingsManager,
			notifyWebview: (msg) => this.notifyWebview(msg),
			logDebug: this.logDebug.bind(this),
			logError: this.logError.bind(this),
			onSessionDeleted: async () => {
				await this.newSession();
			},
		});
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

	/** Update the webview view container title/description with current version info. */
	private async updateViewTitle(): Promise<void> {
		const view = this.view;
		if (!view) return;

		const extVersion = this.context.extension.packageJSON.version || "0.0.0";
		view.title = `PiLot Studio v${extVersion}`;

		const piVer = await this.binaryService.getCliVersion();
		if (piVer) {
			view.description = `Connected to PI v${piVer}`;
		} else {
			view.description = undefined;
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
		this.binaryService.resolveAtStartup();

		// Prepend resolved binary directory to PATH for SDK internals (only for absolute paths)
		const originalPath = process.env.PATH;
		this.binaryService.prependToPath();

		try {
			this.authStorage = AuthStorage.create();
			this.modelRegistry = ModelRegistry.create(this.authStorage);
			this.settingsManager = SettingsManager.create(
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
			);
			this.sessionManager = SessionManager.create(
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
			);

			const models = await this.modelRegistryHandler.getMergedModels();
			this.availableModels = this.modelRegistryHandler.buildModelList(models);

			const savedFavorites = this.context.globalState.get<string[]>(
				"favoriteModels",
				[],
			);
			this.favoriteModels = savedFavorites.filter((pattern) =>
				this.availableModels.some((m) => m.id === pattern),
			);

			// Merge with PI CLI scoped models (bidirectional sync)
			this.modelRegistryHandler.syncFromCliModels().catch(() => {});

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

			// Check native addon ABI compatibility (non-blocking, logs only)
			this.checkNativeAddons();
		} catch (error) {
			// Restore PATH on failure
			if (
				originalPath !== undefined &&
				this.binaryService.isBinaryAvailable()
			) {
				process.env.PATH = originalPath;
			}
			this.logError("Failed to initialize PiLot Studio:", error);
			vscode.window.showErrorMessage(
				`Failed to initialize PiLot Studio: ${error}`,
			);
		}
	}

	// Model methods delegated to modelRegistryHandler

	async toggleFavorite(
		modelId: string,
		isFavorite: boolean,
	): Promise<string[]> {
		return this.modelRegistryHandler.toggleFavorite(modelId, isFavorite);
	}

	updateConfig(config: PiAgentConfig) {
		this.config = config;
	}

	/** Reload session resources (extensions, skills, prompts) when discovery settings change. */
	async reloadSessionResources(): Promise<void> {
		if (!this.session) return;

		try {
			// Call reload on the session's resource loader to pick up setting changes
			const rl = this.session.resourceLoader;
			if (rl && typeof rl.reload === "function") {
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
				// Set the view title and description with version info
				this.updateViewTitle().catch((e) =>
					this.logError("[PiLot Studio] Failed to update view title:", e),
				);
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

	/**
	 * Check native addon (better-sqlite3) ABI compatibility.
	 * Auto-rebuilds if mismatched. Logs result.
	 */
	private checkNativeAddons(): void {
		try {
			const result = ensureBetterSqlite3Compatible();
			if (result.ok) {
				if (result.rebuilt) {
					this.log(
						"[PI] Native addon ABI mismatch detected — auto-rebuilt better-sqlite3 successfully",
					);
				} else {
					this.logDebug("[PI] Native addon ABI check: OK");
				}
			} else {
				const status = checkBetterSqlite3();
				const abiInfo = describeABIStatus(status.runtimeABI, status.moduleABI);
				const runtime = status.electronVersion
					? `Electron ${status.electronVersion} `
					: "";
				this.log(
					`[PI] Native addon ABI mismatch: ${runtime}${abiInfo}. Auto-rebuild failed: ${result.output}`,
				);
				this.log(
					"[PI] Code intelligence won't work until better-sqlite3 is rebuilt. Run 'PiLot: Rebuild Native Addons' command.",
				);
				if (status.modulePath) {
					this.log(`[PI] Module path: ${status.modulePath}`);
				}
			}
		} catch (error) {
			// Don't let this block anything
			this.logDebug(
				"[PI] Native addon check failed:",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/** Manually trigger better-sqlite3 rebuild. Called from command palette. */
	async rebuildNativeAddons(): Promise<void> {
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Rebuilding native addons (better-sqlite3)...",
					cancellable: false,
				},
				async () => {
					const result = ensureBetterSqlite3Compatible();
					if (result.ok) {
						vscode.window.showInformationMessage(
							result.rebuilt
								? "Native addon rebuilt successfully. Code intelligence should work now."
								: "Native addon already compatible.",
						);
					} else {
						vscode.window.showErrorMessage(
							`Native addon rebuild failed: ${result.output}`,
						);
					}
				},
			);
		} catch (error) {
			this.logError("[PI] Manual native addon rebuild failed:", error);
			vscode.window.showErrorMessage(
				`Native addon rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async refreshInstalledPackagesInWebview() {
		if (!this.view) return;

		const packages = await this.packageManager.listPackages();
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
		this.logDebug(
			"[PiLot Studio] HTML content loaded, length:",
			builtHtml.length,
		);

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
			vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg"),
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

		// Bind extension UI context so package setStatus() calls reach the webview.
		// This also emits session_start to initialize extensions (LSP, indexing, etc.)
		await this.extensionUIContext.bindExtensionUI();

		// Start sending footer data (cwd, git branch, session name) to the webview
		this.footerManager.start({
			getCwd: () => this.session!.sessionManager.getCwd(),
			sessionName: this.session.sessionName,
		});

		return this.session;
	}

	// Auto-naming methods delegated to sessionListManager

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
						this.logError(`[PI] Failed to delete session ${sessionId}:`, error);
						throw error;
					}
				}),
			);

			if (this.session && sessionIds.includes(this.session.sessionId)) {
				this.session.dispose();
				this.session = undefined;
				await this.newSession();
			}

			await this.sessionListManager.refreshSessionList(true);
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
		const extraPromptTemplates = config.get<string[]>(
			"extraPromptTemplates",
			[],
		);

		// Read discovery flags
		const disableExtensions = config.get<boolean>(
			"disableExtensionDiscovery",
			false,
		);
		const disableSkills = config.get<boolean>("disableSkillDiscovery", false);
		const disablePromptTemplates = config.get<boolean>(
			"disablePromptTemplateDiscovery",
			false,
		);
		const disableContextFiles = config.get<boolean>(
			"disableContextFiles",
			false,
		);

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
			additionalExtensionPaths:
				extraExtensions.length > 0 ? extraExtensions : undefined,
			additionalSkillPaths: extraSkills.length > 0 ? extraSkills : undefined,
			additionalPromptTemplatePaths:
				extraPromptTemplates.length > 0 ? extraPromptTemplates : undefined,
			noExtensions: disableExtensions,
			noSkills: disableSkills,
			noPromptTemplates: disablePromptTemplates,
			noContextFiles: disableContextFiles,
			systemPrompt: systemPrompt || undefined,
			appendSystemPrompt:
				appendSystemPrompts.length > 0 ? appendSystemPrompts : undefined,
		});

		// Load skills, extensions, prompts, and context files from settings
		await resourceLoader.reload();

		// DIAGNOSTIC: Log extension count after reload
		const extResult = resourceLoader.getExtensions();
		this.logDebug(
			`[PiLot DIAGNOSTIC] After resourceLoader.reload(): ${extResult.extensions.length} extensions loaded`,
		);
		if (extResult.extensions.length > 0) {
			this.logDebug(
				"[PiLot DIAGNOSTIC] First 3 extensions:",
				extResult.extensions.slice(0, 3).map((e: any) => e.path),
			);
		}
		if (extResult.errors.length > 0) {
			this.logDebug("[PiLot DIAGNOSTIC] Extension loading errors:");
			extResult.errors.forEach((err: any, i: number) => {
				this.logDebug(`  [${i}] ${err.path}: ${err.error}`);
			});
		}

		return {
			cwd,
			agentDir: getAgentDir(),
			resourceLoader,
			tools,
			noTools,
		};
	}

	async newSession() {
		this.sessionListManager.autoNamingTriggered = false;
		// Dispose old session properly before creating a new one
		this.extensionUIContext.stopStatusPoller();
		this.footerManager.stop();
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
		this.sessionListManager.invalidateSessionListCache(); // New session created, invalidate cache
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
			let skills: Skill[] = [];
			let extensions: Extension[] = [];
			let prompts: PromptTemplate[] = [];
			try {
				const rl = this.session.resourceLoader;
				this.logDebug(
					"[PiLot DIAGNOSTIC] sendSessionResources - resourceLoader exists:",
					!!rl,
				);
				if (rl) {
					const agentsFilesResult = rl.getAgentsFiles?.();
					contextFiles = agentsFilesResult?.agentsFiles || [];
					const sr = rl.getSkills();
					skills = sr.skills || [];
					const er = rl.getExtensions();
					this.logDebug(
						"[PiLot DIAGNOSTIC] sendSessionResources - extensions array length:",
						er.extensions?.length,
					);
					this.logDebug(
						"[PiLot DIAGNOSTIC] sendSessionResources - first 3 extensions:",
						er.extensions?.slice(0, 3).map((e: any) => e.path),
					);
					extensions = er.extensions || [];
					const pr = rl.getPrompts?.();
					prompts = pr?.prompts || [];
				}
			} catch (e) {
				this.logError("[PiLot DIAGNOSTIC] sendSessionResources error:", e);
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
			const installedPkgs = await this.packageManager.listPackages();

			this.logDebug(
				"[PI] sendSessionResources cwd:",
				cwd,
				"agentDir:",
				agentDir,
			);
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
					packages: installedPkgs.map((p) => ({
						source: p.source,
						path: p.path,
					})),
					packageCount: installedPkgs.length,
				},
			});
		} catch (e) {
			this.logError("[PI] sendSessionResources failed:", e);
		}
	}

	async switchSession(sessionId: string) {
		this.sessionListManager.autoNamingTriggered = false;
		// Invalidate cache to get fresh session list
		this.sessionListManager.invalidateSessionListCache();
		// Find the session info from the list (use full cache for path)
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		await this.sessionListManager.listSessions(true); // force refresh (populates _sessionListFullCache)
		const info = this.sessionListManager.sessionListFullCache.find(
			(s) => s.id === sessionId,
		);
		if (!info) {
			this.logError(`[PI] Session not found: ${sessionId}`);
			this.notifyWebview({
				type: "error",
				data: {
					message: `Session not found: ${sessionId}`,
					timestamp: Date.now(),
				},
			});
			return;
		}

		// Dispose old session
		this.extensionUIContext.stopStatusPoller();
		this.footerManager.stop();
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

		// Bind extension UI context so setStatus calls reach the webview.
		// This also emits session_start to initialize extensions for this session.
		await this.extensionUIContext.bindExtensionUI();

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

	async getSettings(): Promise<{ toolPreset: string; customTools: string[] }> {
		const config = vscode.workspace.getConfiguration("pi-agent");
		return {
			toolPreset: config.get<string>("toolPreset", "default"),
			customTools: config.get<string[]>("customTools", []),
		};
	}

	async setToolConfig(config: {
		toolPreset: string;
		customTools?: string[];
	}): Promise<void> {
		const targetConfig = vscode.workspace.getConfiguration("pi-agent");
		await targetConfig.update(
			"toolPreset",
			config.toolPreset,
			vscode.ConfigurationTarget.Global,
		);
		if (config.customTools !== undefined) {
			await targetConfig.update(
				"customTools",
				config.customTools,
				vscode.ConfigurationTarget.Global,
			);
		}
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

	private async resolveFileMentions(text: string): Promise<string> {
		return this.sessionResources.resolveFileMentions(text);
	}

	private areImagesValid(
		images: unknown[],
	): images is Array<{ type: "image"; data: string; mimeType: string }> {
		return areImagesValid(images);
	}

	async prompt(text: string, images?: any[]) {
		const isNewSession = !this.session;
		if (!this.session) {
			await this.createSession();
		}

		if (isNewSession) {
			await this.sendSessionResources();
		}

		if (!this.session) {
			throw new Error("Failed to create session");
		}

		// Validate and convert images to ImageContent[]
		const validImages =
			images && this.areImagesValid(images)
				? (images as Array<{ type: "image"; data: string; mimeType: string }>)
				: undefined;

		// Build prompt options: include images when provided, handle streaming
		const promptOpts = this.session.isStreaming
			? { streamingBehavior: "steer" as const, images: validImages }
			: validImages
				? { images: validImages }
				: undefined;

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

	async steer(text: string, images?: any[]) {
		if (this.session) {
			try {
				const validImages =
					images && this.areImagesValid(images)
						? (images as Array<{
								type: "image";
								data: string;
								mimeType: string;
							}>)
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
				const validImages =
					images && this.areImagesValid(images)
						? (images as Array<{
								type: "image";
								data: string;
								mimeType: string;
							}>)
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

	async editMessage(index: number, text: string): Promise<void> {
		if (!this.session) return;

		const messages = this.session.messages;
		if (index < 0 || index >= messages.length) return;

		const target = messages[index];
		if (target.role !== "user") return;

		// Create replacement with updated content and new timestamp
		const replacement = {
			...target,
			content: text,
			timestamp: Date.now(),
		};

		try {
			// Mutate the message in-place in agent state (private API)
			(this.session as any)._replaceMessageInPlace(target, replacement);

			// Rewrite the session file so the edit persists
			const sm = this.session.sessionManager;
			if (sm) {
				(sm as any)._rewriteFile();
			}

			// Broadcast updated messages to the webview
			const serialized = serializeMessages(this.session.messages);
			this.notifyWebview({
				type: "session-history",
				data: { sessionId: this.session.sessionId, messages: serialized },
			});
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

	getAutoContext(): boolean {
		return this.config.autoContext;
	}

	setAutoContext(enabled: boolean) {
		this.config.autoContext = enabled;
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
	sendUpdatesToWebview(piVersion: string | null, packageCount: number): void {
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

	getExtensionVersion(): string {
		return this.context.extension.packageJSON.version || "0.0.0";
	}

	getPiCliVersion(): Promise<string | null> {
		return this.binaryService.getCliVersion();
	}

	/** Whether a usable pi binary was resolved (not just the fallback 'pi' name). */
	isBinaryAvailable(): boolean {
		return this.binaryService.isBinaryAvailable();
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

	// Model methods delegated to modelRegistryHandler

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
		await this.modelRegistryHandler.refreshAvailableModels();
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
		await this.modelRegistryHandler.refreshAvailableModels();
		this.modelRegistryHandler.invalidateCliModelIdsCache();
		this.notifyWebview({
			type: "provider-auth",
			data: await this.getProviderAuthData(),
		});
	}

	// Session list methods delegated to sessionListManager

	async listSessions(forceRefresh = false): Promise<SessionItem[]> {
		return this.sessionListManager.listSessions(forceRefresh);
	}

	invalidateSessionListCache(): void {
		this.sessionListManager.invalidateSessionListCache();
	}

	private handleSessionEvent(event: AgentSessionEvent) {
		this.notifyWebview({ type: "pi-event", data: event });

		// Refresh the session list when messages change (use cache to avoid disk I/O)
		if (event.type === "message_end" || event.type === "agent_end") {
			this.sessionListManager.refreshSessionList(false);
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
			this.sessionListManager
				.refreshSessionList(true)
				.catch((e) =>
					this.logError("[PI] refreshSessionList in event handler failed:", e),
				);
			this.notifyWebview({
				type: "session-name-changed",
				data: { name: event.name },
			});
			this.sendSessionResources().catch((e) =>
				this.logError("[PI] sendSessionResources in event handler failed:", e),
			);
			// Immediately push updated footer data (includes session name)
			this.footerManager.sendFooterData(
				this.session
					? {
							getCwd: () => this.session!.sessionManager.getCwd(),
							sessionName: this.session!.sessionName,
						}
					: null,
			);
		}

		// ── Session auto-naming flow ──────────────────
		// Title the session on first user message (matching PI CLI behavior:
		// first user message becomes the session display name immediately).
		if (
			event.type === "message_start" &&
			event.message?.role === "user" &&
			!this.sessionListManager.autoNamingTriggered &&
			this.session &&
			!this.session.sessionName
		) {
			this.logDebug(
				"[PI] Auto-naming: first user message received, attempting to name session",
			);
			this.sessionListManager.autoNamingTriggered =
				this.sessionListManager.tryAutoSessionNameFromUserMessage(
					event.message,
				);
			if (this.sessionListManager.autoNamingTriggered) {
				this.logDebug("[PI] Auto-naming: session named from user message");
				this.sessionListManager.invalidateSessionListCache(); // Force session list refresh
				this.sessionListManager.refreshSessionList(true);
			}
		}

		// Also try to improve the name after the first assistant response,
		// but only if we didn't already set a name from the user message.
		if (
			event.type === "agent_end" &&
			!event.willRetry &&
			!this.sessionListManager.autoNamingTriggered &&
			this.session &&
			!this.session.sessionName
		) {
			this.logDebug(
				"[PI] Auto-naming: agent response complete, attempting to improve session name",
			);
			this.sessionListManager.autoNamingTriggered =
				this.sessionListManager.tryAutoSessionName();
			if (this.sessionListManager.autoNamingTriggered) {
				this.logDebug(
					"[PI] Auto-naming: session name improved from assistant response",
				);
				this.sessionListManager.invalidateSessionListCache(); // Force session list refresh
				this.sessionListManager.refreshSessionList(true);
			}
		}

		// Derive activity statuses from session events
		if (event.type === "tool_execution_start") {
			const toolName = event.toolName || "tool";
			// Build a brief description from args for common tools
			let description = toolName;
			const args = event.args;
			if (args && typeof args === "object") {
				if (args.file_path || args.filePath || args.path) {
					description = `${toolName}: ${args.file_path || args.filePath || args.path}`;
				} else if (args.command) {
					description = `${toolName}: ${String(args.command).slice(0, 60)}`;
				} else if (args.pattern) {
					description = `${toolName}: ${String(args.pattern).slice(0, 60)}`;
				} else if (args.glob) {
					description = `${toolName}: ${args.glob}`;
				}
			}
			this.notifyWebview({
				type: "activity-start",
				data: {
					key: `tool:${event.toolCallId}`,
					text: description,
					activityType: "tool",
				},
			});
		} else if (event.type === "tool_execution_end") {
			this.notifyWebview({
				type: "activity-end",
				data: { key: `tool:${event.toolCallId}` },
			});
		} else if (event.type === "compaction_start") {
			let compactText = "Compacting context";
			if (event.reason === "threshold") {
				compactText = "Auto-compacting (threshold reached)";
			} else if (event.reason === "overflow") {
				compactText = "Auto-compacting (context overflow)";
			} else if (event.reason === "manual") {
				compactText = "Compacting context";
			}
			this.notifyWebview({
				type: "activity-start",
				data: { key: "compaction", text: compactText, activityType: "system" },
			});
		} else if (event.type === "compaction_end") {
			// Show compaction result — clear after 3s to show briefly
			if (event.errorMessage) {
				this.notifyWebview({
					type: "activity-start",
					data: {
						key: "compaction",
						text: `Compaction error: ${event.errorMessage}`,
						activityType: "system",
					},
				});
			} else if (event.aborted) {
				this.notifyWebview({
					type: "activity-start",
					data: {
						key: "compaction",
						text: "Compaction aborted",
						activityType: "system",
					},
				});
			} else {
				this.notifyWebview({
					type: "activity-start",
					data: {
						key: "compaction",
						text: "Context compacted ✓",
						activityType: "system",
					},
				});
			}
			setTimeout(() => {
				this.notifyWebview({
					type: "activity-end",
					data: { key: "compaction" },
				});
			}, 3000);
		} else if (event.type === "auto_retry_start") {
			const attempt = event.attempt || 1;
			this.notifyWebview({
				type: "activity-start",
				data: {
					key: "retry",
					text: `Retry ${attempt}/${event.maxAttempts || "?"}`,
					activityType: "system",
				},
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

	private notifyWebview(message: { type: string; data?: unknown }) {
		if (this.view) {
			this.view.webview.postMessage(message);
		}
	}

	private async getProjectContext(): Promise<string> {
		return this.sessionResources.getProjectContext();
	}

	// Package methods delegated to packageManager

	async listPackages(): Promise<EnrichedPackage[]> {
		return this.packageManager.listPackages();
	}

	async installPackage(source: string): Promise<void> {
		await this.packageManager.installPackage(source);
	}

	async uninstallPackage(source: string): Promise<void> {
		await this.packageManager.uninstallPackage(source);
	}

	async updatePackages(): Promise<void> {
		await this.packageManager.updatePackages();
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
		this.extensionUIContext.stopStatusPoller();
		this.footerManager.stop();
		this.extensionStatuses.clear();
		this._onDidChangeTreeData.dispose();
		if (this.session) {
			this.session.dispose();
		}
		this.voiceManager.dispose();
	}
}

// Auto-naming helpers are now in session-manager.ts
