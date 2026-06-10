import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";

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
import {
	checkBetterSqlite3,
	describeABIStatus,
	ensureBetterSqlite3Compatible,
} from "./utils/native-addons.js";

import {
	findPiBinary,
	resolvePiBinary,
	parseInstalledPackages,
	type InstalledPackage,
} from "./pi-binary.js";
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

type RegistryModel = { provider: string; id: string; name?: string };

export interface SessionItem {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
}

/** Internal session info with full details (including file path). */
interface SessionInfoFull {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
	path: string;
	name?: string;
	firstMessage?: string;
	cwd?: string;
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

	/** Cached PI CLI version string from `pi --version`. */
	private piVersion: string | null = null;

	/** Extension activity statuses forwarded from packages via ctx.ui.setStatus(). Cleared only when the extension explicitly clears them. */
	private extensionStatuses = new Map<string, string>();
	/** Interval handle for polling extension statuses from the runner. */
	private statusPoller: ReturnType<typeof setInterval> | undefined;

	/** Set to true after the first successful auto-name so we only title a session once. */
	private _autoNamingTriggered = false;
	/** Cached session list (for webview) to avoid re-reading all session files on every message. */
	private _sessionListCache: SessionItem[] = [];
	/** Cached full session info (for internal use, includes file path). */
	private _sessionListFullCache: SessionInfoFull[] = [];
	/** Timestamp of last session list refresh. */
	private _sessionListCacheTime = 0;
	/** Minimum interval between session list refreshes (ms). */
	private readonly SESSION_LIST_REFRESH_INTERVAL = 5000;

	/** Footer data for the status line (cwd, git branch, session name). */
	private footerCwd = "";
	private footerGitBranch: string | null = null;
	private footerSessionName: string | null = null;
	private gitBranchPoller: ReturnType<typeof setInterval> | undefined;

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

	/** Resolve PI CLI version by running `pi --version`. Caches result. */
	private async resolvePiVersion(): Promise<string | null> {
		if (this.piVersion) return this.piVersion;
		try {
			const binaryPath = this.resolvedBinaryPath || findPiBinary();
			const result = await execFileAsync(binaryPath, ["--version"]);
			// pi --version may output to stdout or stderr depending on the version
			const versionOutput = result.stdout?.trim() || result.stderr?.trim();
			if (result.code === 0 && versionOutput) {
				this.piVersion = versionOutput;
				this.log(`Resolved PI CLI version: ${this.piVersion}`);
				return this.piVersion;
			}
			this.logError(
				`pi --version failed (code ${result.code}): ${result.stderr}`,
			);
		} catch (e) {
			this.logError("Failed to resolve PI version:", e);
		}
		return null;
	}

	/** Update the webview view container title/description with current version info. */
	private async updateViewTitle(): Promise<void> {
		const view = this.view;
		if (!view) return;

		const extVersion = this.context.extension.packageJSON.version || "0.0.0";
		view.title = `PiLot Studio v${extVersion}`;

		const piVer = await this.resolvePiVersion();
		if (piVer) {
			view.description = `Connected to PI v${piVer}`;
		} else {
			view.description = undefined;
		}
	}

	/**
	 * Resolve the current git branch by reading .git/HEAD.
	 * Returns null if not in a git repo or on detached HEAD.
	 */
	private resolveGitBranch(cwd: string): string | null {
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
						// Worktree: .git is a file with "gitdir: ..."
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

	/** Send footer data (cwd, git branch, session name) to the webview. */
	private sendFooterData(): void {
		if (!this.session) return;
		const rawCwd = this.session.sessionManager.getCwd();
		const sessionName = this.session.sessionName ?? null;
		const gitBranch = this.resolveGitBranch(rawCwd);

		// Format cwd: replace home dir with ~
		const home = process.env.HOME || process.env.USERPROFILE || "";
		let cwd = rawCwd;
		if (home && rawCwd.startsWith(home)) {
			const rest = rawCwd.slice(home.length);
			cwd = rest === "" ? "~" : `~${rest.startsWith("/") ? "" : "/"}${rest}`;
		}

		// Only send if something changed
		if (
			cwd === this.footerCwd &&
			gitBranch === this.footerGitBranch &&
			sessionName === this.footerSessionName
		) {
			return;
		}

		this.footerCwd = cwd;
		this.footerGitBranch = gitBranch;
		this.footerSessionName = sessionName;

		this.notifyWebview({
			type: "footer-data",
			data: { cwd, gitBranch, sessionName },
		});
	}

	/** Start polling git branch for footer data. */
	private startGitBranchPoller(): void {
		this.stopGitBranchPoller();
		// Send immediately
		this.sendFooterData();
		// Then poll every 5 seconds
		this.gitBranchPoller = setInterval(() => {
			this.sendFooterData();
		}, 5000);
	}

	/** Stop the git branch poller. */
	private stopGitBranchPoller(): void {
		if (this.gitBranchPoller !== undefined) {
			clearInterval(this.gitBranchPoller);
			this.gitBranchPoller = undefined;
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

			const savedFavorites = this.context.globalState.get<string[]>(
				"favoriteModels",
				[],
			);
			this.favoriteModels = savedFavorites.filter((pattern) =>
				this.availableModels.some((m) => m.id === pattern),
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

			// Check native addon ABI compatibility (non-blocking, logs only)
			this.checkNativeAddons();
		} catch (error) {
			// Restore PATH on failure
			if (originalPath !== undefined && this.resolvedBinaryPath) {
				process.env.PATH = originalPath;
			}
			this.logError("Failed to initialize PiLot Studio:", error);
			vscode.window.showErrorMessage(
				`Failed to initialize PiLot Studio: ${error}`,
			);
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

	private getConfiguredPackages(): InstalledPackage[] {
		return this.sessionResources.getConfiguredPackages();
	}

	private async listPackagesFromCli(): Promise<InstalledPackage[]> {
		const binaryPath = this.resolvedBinaryPath || findPiBinary();
		const direct = await execFileAsync(binaryPath, ["list"]);
		let packages = parseInstalledPackages(direct.stdout);
		this.logDebug(
			"[PI] listPackagesFromCli: direct parsed packages:",
			packages,
		);

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
		await this.bindExtensionUI();

		// Start sending footer data (cwd, git branch, session name) to the webview
		this.startGitBranchPoller();

		return this.session;
	}

	/** Generate and apply a short session title from the first real exchange. */
	private tryAutoSessionName(): boolean {
		if (!this.session || this.session.sessionName) return false;

		const messages = this.session.messages;
		const firstUserMsg = messages.find((m) => m.role === "user");
		const firstAssistantMsg = messages.find((m) => m.role === "assistant");

		if (!firstUserMsg || !firstAssistantMsg) return false;

		const userText = extractTextFromMessage(firstUserMsg);
		const assistantText = extractTextFromMessage(firstAssistantMsg);

		const name = generateSessionName(userText, assistantText);
		if (name) {
			this.logDebug("[PI] Auto-generated session name:", name);
			this.session.setSessionName(name);
			return true;
		}

		return false;
	}

	/** Generate and apply a session title from the first user message only.
	 * Matches PI CLI behavior where the first user message becomes the session display name.
	 */
	private tryAutoSessionNameFromUserMessage(userMessage: {
		role: string;
		content: string | Array<{ type: string; text?: string }> | null;
	}): boolean {
		if (!this.session || this.session.sessionName) return false;

		const userText = extractTextFromMessage(userMessage);
		if (!userText) return false;

		const name = generateSessionName(userText, "");
		if (name) {
			this.logDebug(
				"[PI] Auto-generated session name from user message:",
				name,
			);
			this.session.setSessionName(name);
			return true;
		}

		return false;
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

			await this.refreshSessionList(true);
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
		console.log(
			`[PiLot DIAGNOSTIC] After resourceLoader.reload(): ${extResult.extensions.length} extensions loaded`,
		);
		if (extResult.extensions.length > 0) {
			console.log(
				"[PiLot DIAGNOSTIC] First 3 extensions:",
				extResult.extensions.slice(0, 3).map((e: any) => e.path),
			);
		}
		if (extResult.errors.length > 0) {
			console.log("[PiLot DIAGNOSTIC] Extension loading errors:");
			extResult.errors.forEach((err: any, i: number) => {
				console.log(`  [${i}] ${err.path}: ${err.error}`);
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
		this._autoNamingTriggered = false;
		// Dispose old session properly before creating a new one
		this.stopStatusPoller();
		this.stopGitBranchPoller();
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
		this.invalidateSessionListCache(); // New session created, invalidate cache
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
				console.log(
					"[PiLot DIAGNOSTIC] sendSessionResources - resourceLoader exists:",
					!!rl,
				);
				if (rl) {
					const agentsFilesResult = rl.getAgentsFiles?.();
					contextFiles = agentsFilesResult?.agentsFiles || [];
					const sr = rl.getSkills();
					skills = sr.skills || [];
					const er = rl.getExtensions();
					console.log(
						"[PiLot DIAGNOSTIC] sendSessionResources - extensions array length:",
						er.extensions?.length,
					);
					console.log(
						"[PiLot DIAGNOSTIC] sendSessionResources - first 3 extensions:",
						er.extensions?.slice(0, 3).map((e: any) => e.path),
					);
					extensions = er.extensions || [];
					const pr = rl.getPrompts?.();
					prompts = pr?.prompts || [];
				}
			} catch (e) {
				console.error("[PiLot DIAGNOSTIC] sendSessionResources error:", e);
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
		this._autoNamingTriggered = false;
		// Invalidate cache to get fresh session list
		this.invalidateSessionListCache();
		// Find the session info from the list (use full cache for path)
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		await this.listSessions(true); // force refresh (populates _sessionListFullCache)
		const info = this._sessionListFullCache.find((s) => s.id === sessionId);
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
		this.stopStatusPoller();
		this.stopGitBranchPoller();
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
		await this.bindExtensionUI();

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
		return this.resolvePiVersion();
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
				.then((ids) => {
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
		return execFileAsync(binaryPath, ["--list-models"])
			.then(({ stdout, stderr }) => {
				const output = (stderr || "") + "\n" + (stdout || "");
				const models = new Set<string>();

				for (const line of output.split("\n")) {
					// Match: "provider  modelId  context  max-out  thinking  images"
					const match = line.match(/^(\S+)\s+(\S+)\s+\S/);
					if (
						match &&
						match[1] !== "provider" &&
						!match[0].startsWith("Warning")
					) {
						models.add(`${match[1]}/${match[2]}`);
					}
				}

				return models;
			})
			.catch(() => {
				this.logError(
					"[PI] Failed to list CLI models - is 'pi' installed and on PATH?",
				);
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
		const validPatterns = this.favoriteModels.filter((pattern) =>
			cliModels.has(pattern),
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
		const newModels = settingsModels.filter(
			(pattern) =>
				cliModels.has(pattern) &&
				this.availableModels.some((m) => m.id === pattern) &&
				!this.favoriteModels.includes(pattern),
		);

		if (newModels.length > 0) {
			this.favoriteModels = [...this.favoriteModels, ...newModels];
			await this.context.globalState.update(
				"favoriteModels",
				this.favoriteModels,
			);
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
			if (!this.availableModels.some((m) => m.id === modelId)) {
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
			const sessions = await SessionManager.list(cwd, this.config.sessionDir);
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
			this.sessionList = this._sessionListCache; // Keep legacy property in sync
		} catch {
			this._sessionListFullCache = [];
			this._sessionListCache = [];
			this.sessionList = [];
		}
		return this._sessionListCache;
	}

	/** Invalidate the session list cache so next call re-reads from disk. */
	invalidateSessionListCache(): void {
		this._sessionListCache = [];
		this._sessionListFullCache = [];
		this._sessionListCacheTime = 0;
	}

	private async refreshSessionList(forceRefresh = false) {
		await this.listSessions(forceRefresh);
		this.notifyWebview({ type: "sessions-list", data: this._sessionListCache });
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

		// Refresh the session list when messages change (use cache to avoid disk I/O)
		if (event.type === "message_end" || event.type === "agent_end") {
			this.refreshSessionList(false);
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
			this.refreshSessionList(true).catch((e) =>
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
			this.sendFooterData();
		}

		// ── Session auto-naming flow ──────────────────
		// Title the session on first user message (matching PI CLI behavior:
		// first user message becomes the session display name immediately).
		if (
			event.type === "message_start" &&
			event.message?.role === "user" &&
			!this._autoNamingTriggered &&
			this.session &&
			!this.session.sessionName
		) {
			this.logDebug(
				"[PI] Auto-naming: first user message received, attempting to name session",
			);
			this._autoNamingTriggered = this.tryAutoSessionNameFromUserMessage(
				event.message,
			);
			if (this._autoNamingTriggered) {
				this.logDebug("[PI] Auto-naming: session named from user message");
				this.invalidateSessionListCache(); // Force session list refresh
				this.refreshSessionList(true);
			}
		}

		// Also try to improve the name after the first assistant response,
		// but only if we didn't already set a name from the user message.
		if (
			event.type === "agent_end" &&
			!event.willRetry &&
			!this._autoNamingTriggered &&
			this.session &&
			!this.session.sessionName
		) {
			this.logDebug(
				"[PI] Auto-naming: agent response complete, attempting to improve session name",
			);
			this._autoNamingTriggered = this.tryAutoSessionName();
			if (this._autoNamingTriggered) {
				this.logDebug(
					"[PI] Auto-naming: session name improved from assistant response",
				);
				this.invalidateSessionListCache(); // Force session list refresh
				this.refreshSessionList(true);
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

	/**
	 * Bind a custom ExtensionUIContext to the session's extension runner
	 * so that ctx.ui.setStatus() calls from packages are forwarded to the webview.
	 *
	 * We set the UI context on the extension runner directly (not via bindExtensions)
	 * because createAgentSession already initializes and binds the runner during
	 * construction. Calling bindExtensions again would re-emit session_start and
	 * re-discover resources. Instead, we replace the no-op UI context with our own
	 * and also set it on the session's _extensionUIContext field so that reload()
	 * preserves it.
	 */
	private async bindExtensionUI(): Promise<void> {
		if (!this.session) return;

		try {
			const runner = this.session.extensionRunner;
			if (!runner) {
				this.logDebug(
					"[PI] No extension runner found, skipping UI context binding",
				);
				return;
			}

			// Create a UI context that forwards setStatus calls to the webview
			const uiContext = {
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify: (message: string, type?: string) => {
					this.logDebug(`[PI] Extension notify: ${type || "info"}: ${message}`);
					this.notifyWebview({
						type: "extension-notify",
						data: { message, type: type || "info" },
					});
				},
				onTerminalInput: () => () => {},
				setStatus: (key: string, text: string | undefined) => {
					console.log(`[PiLot DIAGNOSTIC] setStatus called: ${key} = ${text}`);
					if (text === undefined || text === null) {
						this.extensionStatuses.delete(key);
					} else {
						this.extensionStatuses.set(key, text);
					}
					this.logDebug(`[PI] Extension setStatus: ${key} = ${text}`);
					this.notifyWebview({
						type: "extension-status",
						data: { key, text: text ?? undefined },
					});
				},
				setWorkingMessage: (message?: string) => {
					if (message) {
						this.notifyWebview({
							type: "activity-start",
							data: { key: "_working", text: message, activityType: "system" },
						});
					} else {
						this.notifyWebview({
							type: "activity-end",
							data: { key: "_working" },
						});
					}
				},
				setWorkingVisible: () => {},
				setWorkingIndicator: () => {},
				setHiddenThinkingLabel: () => {},
				setWidget: () => {},
				setFooter: () => {},
				setHeader: () => {},
				setTitle: () => {},
				custom: async <T>(
					factory: (
						tui: any,
						theme: any,
						keybindings: any,
						done: (result: T) => void,
					) => any,
					options?: { overlay?: boolean },
				): Promise<T> => {
					const factoryName = factory.name || "";
					const callerLine =
						new Error().stack?.split("\n").slice(2, 4).join(" / ") || "";
					this.logDebug(
						`[PI] Extension custom UI (no TUI): factory=${factoryName}, caller=${callerLine}`,
					);
					void options;

					// Call factory with no TUI context so extensions gracefully detect
					// headless mode and call done() to complete initialization.
					return new Promise<T>((resolve) => {
						const done = (result: T) => resolve(result);
						try {
							const component = factory(undefined, undefined, undefined, done);
							// Factory may return a Promise (async component factory).
							// Resolution/failure handled via done() call.
							if (component && typeof (component as any)?.then === "function") {
								(component as Promise<any>).catch((e: unknown) => {
									this.logDebug(
										`[PI] Extension custom factory promise error: ${e}`,
									);
								});
							}
						} catch (e) {
							this.logDebug(`[PI] Extension custom factory error: ${e}`);
							resolve(undefined as unknown as T);
						}
					});
				},
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
			};

			// Set the UI context on the runner so extension setStatus calls reach us
			runner.setUIContext(uiContext);

			// Also set the internal _extensionUIContext field so session.reload() preserves it.
			(this.session as any)._extensionUIContext = uiContext;

			const extensionPaths = runner.getExtensionPaths?.() ?? [];
			const extensionCount = extensionPaths.length;
			console.log(
				`[PiLot DIAGNOSTIC] Extension paths found: ${extensionCount}`,
			);
			if (extensionCount > 0) {
				console.log("[PiLot DIAGNOSTIC] Extension paths:", extensionPaths);
			}

			// Check if extensions have session_start handlers
			const extensions = (runner as any).extensions ?? [];
			console.log(`[PiLot DIAGNOSTIC] Extensions loaded: ${extensions.length}`);
			if (extensions.length > 0) {
				const handlers = extensions.map((ext: any) => ({
					path: ext.path,
					hasSessionStart: ext.handlers?.has("session_start"),
					handlerCount: ext.handlers?.get("session_start")?.length ?? 0,
				}));
				console.log("[PiLot DIAGNOSTIC] Extension handlers:", handlers);
			}

			this.logDebug(
				`[PI] Bound extension UI context for setStatus forwarding (${extensionCount} extensions loaded)`,
			);

			// Re-apply bindings so the new UI context is used by the runner
			(this.session as any)._applyExtensionBindings?.(runner);

			// CRITICAL: Emit session_start to initialize extensions
			// Without this, extensions never run their initialization handlers (LSP setup, indexing, etc.)
			// and never call setStatus() to report their activity.
			const sessionStartEvent = (this.session as any)._sessionStartEvent ?? {
				type: "session_start" as const,
				reason: "startup" as const,
				cwd: this.session.sessionManager.getCwd(),
				sessionPath: (this.session as any).sessionFile,
			};

			// Store it for future reload() calls
			(this.session as any)._sessionStartEvent = sessionStartEvent;

			console.log(
				"[PiLot DIAGNOSTIC] Emitting session_start event:",
				sessionStartEvent,
			);
			this.logDebug("[PI] Emitting session_start to extensions");
			await runner.emit(sessionStartEvent);
			console.log("[PiLot DIAGNOSTIC] session_start emitted successfully");

			// Let extensions discover additional resources (skills, prompts, themes)
			await (this.session as any).extendResourcesFromExtensions?.("startup");

			console.log(
				`[PiLot DIAGNOSTIC] Extension statuses after session_start: ${this.extensionStatuses.size}`,
			);
			if (this.extensionStatuses.size > 0) {
				console.log(
					"[PiLot DIAGNOSTIC] Statuses:",
					Object.fromEntries(this.extensionStatuses),
				);
			}

			// ── Forward extension loading errors (from createAgentSession) ──────────
			// Extensions that FAILED to load during createAgentSession never got to call
			// setStatus() because the noOpUIContext was active. Their errors are stored in
			// the resource loader's extensionsResult.errors array. Forward them now.
			this.forwardExtensionLoadingErrors();

			this.logDebug("[PI] Extensions initialized");

			// Send any statuses that extensions may have already set during initialization
			if (this.extensionStatuses.size > 0) {
				console.log(
					"[PiLot DIAGNOSTIC] Sending extension-statuses-full to webview",
				);
				this.notifyWebview({
					type: "extension-statuses-full",
					data: Object.fromEntries(this.extensionStatuses),
				});
			}

			// Start polling extension statuses as a sync mechanism
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

			// Also re-check the resource loader for extension loading errors.
			// These are set once during session creation but may change on reload.
			this.forwardExtensionLoadingErrors();
		} catch {
			// Silently ignore — session may be disposed
		}
	}

	/**
	 * Forward extension loading errors from the resource loader as extension statuses.
	 *
	 * During createAgentSession(), extensions that FAIL to load (e.g., native module ABI
	 * mismatch) are caught by loadExtension() and stored in the resource loader's
	 * extensionsResult.errors array. These errors never reach setStatus() because the
	 * no-op UI context is active at that point.
	 *
	 * This method reads those errors and creates status entries so they appear in the
	 * ActivityBar alongside normal extension statuses.
	 */
	private forwardExtensionLoadingErrors(): void {
		if (!this.session) return;

		try {
			const rl = (this.session as any).resourceLoader;
			if (!rl) return;

			const er = rl.getExtensions();
			if (!er.errors || er.errors.length === 0) return;

			for (const err of er.errors) {
				if (!err.path || !err.error) continue;
				const errKey = `ext:error:${err.path}`;
				if (this.extensionStatuses.has(errKey)) continue;

				const errorText =
					typeof err.error === "string"
						? err.error
						: err.error?.message || String(err.error);
				// Truncate long load errors to first 200 chars
				const displayText =
					errorText.length > 200 ? errorText.slice(0, 200) + "…" : errorText;

				this.extensionStatuses.set(errKey, displayText);
				this.notifyWebview({
					type: "extension-status",
					data: { key: errKey, text: displayText },
				});
			}
		} catch (e) {
			this.logDebug("[PI] Failed to forward extension loading errors:", e);
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
		this.stopGitBranchPoller();
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
