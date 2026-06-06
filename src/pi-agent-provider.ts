import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";

import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
	createAgentSession,
	SessionManager,
	AuthStorage,
	DefaultPackageManager,
	ModelRegistry,
	SettingsManager,
	getAgentDir,
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { MessageHandler } from "./message-handler.js";

type InstalledPackage = { source: string; path: string };
type CommandResult = { code: number | null; stdout: string; stderr: string };
type PackageSettingEntry = string | { source?: string };

function stripAnsi(text: string): string {
	let result = "";

	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\u001b" && text[index + 1] === "[") {
			index += 2;
			while (index < text.length && !/[A-Za-z]/.test(text[index]!)) {
				index++;
			}
			continue;
		}

		result += char;
	}

	return result;
}

// Find pi binary - check workspace node_modules first, then global paths
function findPiBinary(): string {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const home = process.env.HOME || process.env.USERPROFILE || "";

	// Check workspace-local node_modules/.bin first
	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			const workspacePath = path.join(
				folder.uri.fsPath,
				"node_modules",
				".bin",
				process.platform === "win32" ? "pi.cmd" : "pi",
			);
			try {
				fs.accessSync(
					workspacePath,
					process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
				);
				return workspacePath;
			} catch {
				continue;
			}
		}
	}

	// Check well-known global paths
	const candidates =
		process.platform === "win32"
			? [
					path.join(process.env.APPDATA || "", "npm", "pi"),
					path.join(home, ".npm-global", "pi"),
				]
			: [
					path.join(home, ".bun/bin/pi"),
					path.join(home, ".local/bin/pi"),
					path.join(home, ".npm-global/bin/pi"),
					"pi",
				];

	for (const c of candidates) {
		try {
			fs.accessSync(
				c,
				process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
			);
			return c;
		} catch {
			continue;
		}
	}

	return "pi";
}

function parseInstalledPackages(output: string): InstalledPackage[] {
	const packages: InstalledPackage[] = [];
	const lines = stripAnsi(output).split("\n");

	let pendingSource: string | null = null;

	for (const rawLine of lines) {
		const line = rawLine.replace(/\r/g, "");
		const trimmed = line.trim();

		if (
			!trimmed ||
			trimmed === "No packages installed." ||
			/packages:\s*$/i.test(trimmed)
		) {
			continue;
		}

		if (/^\s{4,}\S/.test(line) && pendingSource) {
			packages.push({ source: pendingSource, path: trimmed });
			pendingSource = null;
			continue;
		}

		if (/^\s{2,}\S/.test(line)) {
			if (pendingSource) {
				packages.push({ source: pendingSource, path: "" });
			}
			pendingSource = trimmed.replace(/\s+\(filtered\)$/, "");
		}
	}

	if (pendingSource) {
		packages.push({ source: pendingSource, path: "" });
	}

	return packages;
}

function readPackageSourcesFromSettingsFile(filePath: string): string[] {
	try {
		if (!fs.existsSync(filePath)) {
			return [];
		}

		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content) as { packages?: PackageSettingEntry[] };
		if (!Array.isArray(parsed.packages)) {
			return [];
		}

		return parsed.packages
			.map((entry) => (typeof entry === "string" ? entry : entry.source))
			.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			);
	} catch (error) {
		console.error(
			"[PI] Failed to read package sources from settings file:",
			filePath,
			error,
		);
		return [];
	}
}

function shellQuote(arg: string): string {
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function getShellCommand(args: string[]) {
	if (process.platform === "win32") {
		return null;
	}

	const shell = process.env.SHELL || "/bin/bash";
	const command = [findPiBinary(), ...args].map(shellQuote).join(" ");
	return { command: shell, args: ["-lc", command] };
}

function execFileAsync(
	command: string,
	args: string[],
): Promise<CommandResult> {
	return new Promise((resolve) => {
		execFile(command, args, (error, stdout, stderr) => {
			resolve({
				code:
					error && "code" in error && typeof error.code === "number"
						? error.code
						: 0,
				stdout: stdout || "",
				stderr: stderr || "",
			});
		});
	});
}

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

type VoiceHelperMessage = {
	type: string;
	message?: string;
	text?: string;
	error?: string;
	code?: string;
	level?: number;
	speechActive?: boolean;
};

function getVoiceHelperPath(extensionUri?: vscode.Uri): string {
	const platform = process.platform;
	const arch = process.arch;
	// Prefer extensionUri (from ExtensionContext) because getExtension requires
	// an exact publisher.name match that may break if the extension ID changes.
	const extensionPath = extensionUri?.fsPath ||
		vscode.extensions.getExtension("pi-agent.pilots-studio")?.extensionPath ||
		"";
	const voiceDir = path.join(extensionPath, "media", "voice");

	switch (platform) {
		case "darwin":
			return path.join(voiceDir, "pi-voice-helper");
		case "linux":
			if (arch === "arm64") {
				return path.join(voiceDir, "pi-voice-helper-linux-arm64");
			}
			return path.join(voiceDir, "pi-voice-helper-linux-x64");
		case "win32":
			if (arch === "arm64") {
				return path.join(voiceDir, "pi-voice-helper-win32-arm64.exe");
			}
			return path.join(voiceDir, "pi-voice-helper-win32-x64.exe");
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}

// ── Voice model definitions (whisper.cpp models from Hugging Face) ────────

interface VoiceModelDef {
	label: string;
	remoteFilename: string;
	cacheFilename: string;
	expectedSizeMb: number;
	englishOnly: boolean;
}

const VOICE_MODELS: Record<string, VoiceModelDef> = {
	"tiny-q5_1": {
		label: "Tiny multilingual (Q5_1)",
		remoteFilename: "ggml-tiny-q5_1.bin",
		cacheFilename: "tiny-q5_1.bin",
		expectedSizeMb: 31,
		englishOnly: false,
	},
	"tiny": {
		label: "Tiny multilingual",
		remoteFilename: "ggml-tiny.bin",
		cacheFilename: "tiny.bin",
		expectedSizeMb: 75,
		englishOnly: false,
	},
	"tiny.en": {
		label: "Tiny English-only",
		remoteFilename: "ggml-tiny.en.bin",
		cacheFilename: "tiny.en.bin",
		expectedSizeMb: 75,
		englishOnly: true,
	},
	"base-q5_1": {
		label: "Base multilingual (Q5_1)",
		remoteFilename: "ggml-base-q5_1.bin",
		cacheFilename: "base-q5_1.bin",
		expectedSizeMb: 57,
		englishOnly: false,
	},
	"base": {
		label: "Base multilingual",
		remoteFilename: "ggml-base.bin",
		cacheFilename: "base.bin",
		expectedSizeMb: 141,
		englishOnly: false,
	},
	"base.en": {
		label: "Base English-only",
		remoteFilename: "ggml-base.en.bin",
		cacheFilename: "base.en.bin",
		expectedSizeMb: 141,
		englishOnly: true,
	},
};

const VOICE_MODEL_BASE_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function getVoiceModelCacheDir(): string {
	const agentDir = getAgentDir();
	return path.join(agentDir, "voice-models");
}

function getVoiceModelPath(modelName: string): string {
	const modelDef = VOICE_MODELS[modelName];
	if (!modelDef) {
		throw new Error(`Unknown voice model: ${modelName}`);
	}
	return path.join(getVoiceModelCacheDir(), modelDef.cacheFilename);
}

async function downloadVoiceModel(
	modelName: string,
	onProgress?: (downloaded: number, total: number) => void,
	onPhase?: (phase: string, message?: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	const modelDef = VOICE_MODELS[modelName];
	if (!modelDef) {
		throw new Error(`Unknown voice model: ${modelName}`);
	}

	const cacheDir = getVoiceModelCacheDir();
	await fs.promises.mkdir(cacheDir, { recursive: true });
	const destPath = path.join(cacheDir, modelDef.cacheFilename);

	// Check if already cached — verify size roughly matches expected
	if (fs.existsSync(destPath)) {
		const stats = await fs.promises.stat(destPath);
		const sizeMb = stats.size / (1024 * 1024);
		if (
			Math.abs(sizeMb - modelDef.expectedSizeMb) <=
			modelDef.expectedSizeMb * 0.2
		) {
			console.log(
				`[PI Voice] Model already cached: ${destPath} (${sizeMb.toFixed(1)} MB)`,
			);
			onPhase?.("ready", "Voice model ready.");
			return destPath;
		}
		console.log(
			`[PI Voice] Cached model size mismatch, re-downloading: ${sizeMb.toFixed(1)}MB vs expected ${modelDef.expectedSizeMb}MB`,
		);
	}

	const url = `${VOICE_MODEL_BASE_URL}/${modelDef.remoteFilename}`;
	onPhase?.(
		"downloading",
		`Downloading ${modelDef.label} (~${modelDef.expectedSizeMb} MB)...`,
	);

	const https = await import("node:https");
	const { createWriteStream } = await import("node:fs");

	const tmpPath = destPath + ".tmp";

	await new Promise<void>((resolve, reject) => {
		const doRequest = (requestUrl: string) => {
			https
				.get(requestUrl, (response) => {
					// Handle redirects
					if (
						response.statusCode &&
						response.statusCode >= 300 &&
						response.statusCode < 400 &&
						response.headers.location
					) {
						doRequest(response.headers.location);
						return;
					}

					if (response.statusCode !== 200) {
						reject(
							new Error(
								`Failed to download voice model: HTTP ${response.statusCode}`,
							),
						);
						return;
					}

					const totalSize = parseInt(
						response.headers["content-length"] || "0",
						10,
					);
					let downloaded = 0;

					const fileStream = createWriteStream(tmpPath);

					// Support cancellation via AbortSignal
					const onAbort = () => {
						response.destroy();
						fileStream.close();
						reject(new Error("Download cancelled"));
					};
					if (signal?.aborted) {
						onAbort();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });

					response.on("data", (chunk: Buffer) => {
						downloaded += chunk.length;
						onProgress?.(downloaded, totalSize);
					});

					response.on("error", reject);
					fileStream.on("error", reject);
					fileStream.on("finish", () => {
						signal?.removeEventListener("abort", onAbort);
						resolve();
					});
					response.pipe(fileStream);
				})
				.on("error", reject);
		};
		doRequest(url);
	});

	// Atomic rename
	await fs.promises.rename(tmpPath, destPath);
	console.log(`[PI Voice] Model downloaded to: ${destPath}`);
	onPhase?.("ready", "Voice model ready.");
	return destPath;
}

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
	private currentModelId: string | null = null;
	private sessionList: SessionItem[] = [];
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	get hasSession(): boolean {
		return this.session !== undefined;
	}

	private voiceHelperProcess?: ChildProcess;
	private isListening = false;
	private voiceModel: string = "tiny-q5_1"; // Default from package.json
	private voiceLineBuffer = ""; // accumulates partial stdout lines across chunks
	private logChannel: vscode.OutputChannel;

	constructor(
		private context: vscode.ExtensionContext,
		config: PiAgentConfig,
	) {
		this.config = config;
		this.logChannel = vscode.window.createOutputChannel("PiLot Studio");
		this.messageHandler = new MessageHandler(this);
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

			// Restore persisted state — sync with TUI settings.json
			const settingsModels = this.settingsManager?.getEnabledModels() || [];
			this.favoriteModels =
				settingsModels.length > 0
					? settingsModels
					: this.context.globalState.get<string[]>("favoriteModels", []);
			// Write to settings.json so TUI picks it up
			if (this.favoriteModels.length > 0 && this.settingsManager) {
				this.settingsManager.setEnabledModels(this.favoriteModels);
				await this.settingsManager.flush();
			}

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
		} catch (error) {
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
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
	}

	private getConfiguredPackages(): InstalledPackage[] {
		const workspacePath = this.getWorkspacePath();
		const agentDir = getAgentDir();
		const userSettingsPath = path.join(agentDir, "settings.json");
		const projectSettingsPath = path.join(
			workspacePath,
			".pi",
			"settings.json",
		);

		const packageSources = [
			...readPackageSourcesFromSettingsFile(userSettingsPath),
			...readPackageSourcesFromSettingsFile(projectSettingsPath),
		];

		const packages = new Map<string, InstalledPackage>();
		for (const source of packageSources) {
			packages.set(source, { source, path: "" });
		}

		if (packages.size === 0 || !this.settingsManager) {
			return [...packages.values()];
		}

		try {
			const packageManager = new DefaultPackageManager({
				cwd: workspacePath,
				agentDir,
				settingsManager: this.settingsManager,
			});

			for (const pkg of packageManager.listConfiguredPackages()) {
				const existing = packages.get(pkg.source);
				packages.set(pkg.source, {
					source: pkg.source,
					path: pkg.installedPath || existing?.path || "",
				});
			}
		} catch (error) {
			this.logError(
				"[PI] Failed to enrich configured packages with install paths:",
				error,
			);
		}

		return [...packages.values()];
	}

	private async listPackagesFromCli(): Promise<InstalledPackage[]> {
		const direct = await execFileAsync(findPiBinary(), ["list"]);
		let packages = parseInstalledPackages(direct.stdout);
		this.logDebug("[PI] listPackagesFromCli: direct parsed packages:", packages);

		if (packages.length > 0) {
			return packages;
		}

		const shellCommand = getShellCommand(["list"]);
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

		const { session } = await createAgentSession({
			cwd,
			agentDir: getAgentDir(),
			sessionManager,
			authStorage,
			modelRegistry,
		});

		this.session = session;
		this.session.subscribe(this.handleSessionEvent.bind(this));

		return this.session;
	}

	async newSession() {
		// Dispose old session properly before creating a new one
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
			try {
				const rl = (this.session as any).resourceLoader;
				if (rl) {
					const agentsFilesResult = rl.getAgentsFiles?.();
					contextFiles = agentsFilesResult?.agentsFiles || [];
					const sr = rl.getSkills();
					skills = sr.skills || [];
					const er = rl.getExtensions();
					extensions = er.extensions || [];
				}
			} catch {
				contextFiles = [];
				skills = [];
				extensions = [];
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
		// Find the session info from the list
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const allSessions = await SessionManager.list(cwd, this.config.sessionDir);
		const info = allSessions.find((s) => s.id === sessionId);
		if (!info) return;

		// Dispose old session
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
		const { session } = await createAgentSession({
			cwd,
			agentDir: getAgentDir(),
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

	private async resolveFileMentions(text: string): Promise<string> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return text;
		}
		const root = workspaceFolders[0].uri.fsPath;

		// Find all @path mentions (non-whitespace after @)
		const mentionRegex = /@([^\s]+)/g;
		const mentions: Array<{ match: string; filePath: string; index: number }> =
			[];
		let match: RegExpExecArray | null;
		while ((match = mentionRegex.exec(text)) !== null) {
			mentions.push({
				match: match[0],
				filePath: match[1],
				index: match.index,
			});
		}

		if (mentions.length === 0) return text;

		// Resolve and read each mentioned file
		const fileContexts: string[] = [];
		let resolvedText = text;

		for (const mention of mentions) {
			const absPath = path.resolve(root, mention.filePath);
			if (!fs.existsSync(absPath)) continue;

			// Skip binary files (images, audio, archives, etc.)
			if (this.isBinaryExtension(mention.filePath)) continue;

			try {
				const content = fs.readFileSync(absPath, "utf-8");
				const maxBytes = 50 * 1024; // 50KB per file
				const truncated =
					content.length > maxBytes
						? content.slice(0, maxBytes) + "\n... [file truncated at 50KB]"
						: content;
				fileContexts.push(
					`<file path="${mention.filePath}">\n${truncated}\n</file>`,
				);
				// Remove @mention from text — it's replaced by file context block
				resolvedText = resolvedText.replace(mention.match, "");
			} catch (e) {
				this.logError(`[PI] Failed to read file ${absPath}:`, e);
			}
		}

		if (fileContexts.length === 0) return text;

		const fileBlock = fileContexts.join("\n\n");
		const cleanText = resolvedText.replace(/\s+/g, " ").trim();

		return `${fileBlock}\n\n${cleanText}`;
	}

	private areImagesValid(images: any[]): images is Array<{ type: "image"; data: string; mimeType: string }> {
		if (!Array.isArray(images) || images.length === 0) return false;
		return images.every(
			(img) =>
				img &&
				img.type === "image" &&
				typeof img.data === "string" &&
				typeof img.mimeType === "string" &&
				img.data.length > 0
		);
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
		const spaceIndex = text.indexOf(" ");
		const command =
			spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		switch (command) {
			// ── UI-triggered commands ──────────────────
			case "model":
				this.notifyWebview({ type: "pickModel" });
				return true;
			case "new":
				this.notifyWebview({ type: "new-session" });
				return true;
			case "login":
				this.notifyWebview({ type: "show-login" });
				return true;
			case "settings":
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					"pi-agent",
				);
				return true;
			case "resume":
				this.notifyWebview({ type: "switchTab", data: { tab: "sessions" } });
				return true;

			case "scoped-models":
				// Open model selector to manage scoped/favorite models
				this.notifyWebview({ type: "switchTab", data: { tab: "models" } });
				return true;

			// ── Session-level commands ─────────────────
			case "name": {
				if (!this.session) return true;
				const name = args;
				if (!name) {
					const current = this.session.sessionName;
					this.notifyWebview({
						type: "system-message",
						data: {
							message: current
								? `Session name: ${current}`
								: "Usage: /name <name>",
						},
					});
				} else {
					this.session.setSessionName(name);
					this.notifyWebview({
						type: "system-message",
						data: { message: `Session name set: ${name}` },
					});
				}
				return true;
			}

			case "compact": {
				if (!this.session) return true;
				try {
					await this.session.compact(args || undefined);
					this.notifyWebview({
						type: "compact-result",
						data: { success: true },
					});
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

			case "session": {
				if (!this.session) return true;
				try {
					const stats = this.session.getSessionStats();
					const name = this.session.sessionName;
					const lines: string[] = [];
					lines.push(`📊 **Session Info**`);
					if (name) lines.push(`Name: ${name}`);
					lines.push(`File: ${stats.sessionFile ?? "In-memory"}`);
					lines.push(`ID: ${stats.sessionId}`);
					lines.push("");
					lines.push(`**Messages:** User ${stats.userMessages} · Asst ${stats.assistantMessages} · Tools ${stats.toolCalls}/${stats.toolResults} · Total ${stats.totalMessages}`);
					lines.push(`**Tokens:** In ${stats.tokens.input.toLocaleString()} · Out ${stats.tokens.output.toLocaleString()} · Total ${stats.tokens.total.toLocaleString()}`);
					if (stats.tokens.cacheRead > 0)
						lines.push(`Cache: Read ${stats.tokens.cacheRead.toLocaleString()} · Write ${stats.tokens.cacheWrite.toLocaleString()}`);
					if (stats.cost > 0)
						lines.push(`**Cost:** $${stats.cost.toFixed(4)}`);
					this.notifyWebview({
						type: "system-message",
						data: { message: lines.join("\n") },
					});
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

			case "export": {
				if (!this.session) return true;
				try {
					let filePath: string;
					if (args.endsWith(".jsonl")) {
						filePath = this.session.exportToJsonl(args || undefined);
					} else {
						filePath = await this.session.exportToHtml(
							args || undefined,
						);
					}
					// Open the exported file in VS Code
					const uri = vscode.Uri.file(filePath);
					await vscode.commands.executeCommand("vscode.open", uri);
					vscode.window.showInformationMessage(
						`Session exported to: ${filePath}`,
					);
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
				return true;
			}

			case "copy": {
				if (!this.session) return true;
				const text = this.session.getLastAssistantText();
				if (!text) {
					vscode.window.showWarningMessage(
						"No agent messages to copy yet.",
					);
				} else {
					await vscode.env.clipboard.writeText(text);
					vscode.window.showInformationMessage(
						"Copied last agent message to clipboard",
					);
				}
				return true;
			}

			case "fork": {
				// Open fork selector via session tree or show message selector
				if (!this.session) return true;
				this.notifyWebview({
					type: "system-message",
					data: {
						message:
							"Use the Session Tree to select a message to fork from, or type /tree to navigate branches.",
					},
				});
				return true;
			}

			case "clone": {
				if (!this.session) return true;
				// Clone: fork from current position (at the last user message)
				try {
					await this.forkSession();
					vscode.window.showInformationMessage("Session cloned at current position");
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to clone: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				return true;
			}

			case "tree": {
				// Navigate session tree
				this.notifyWebview({ type: "switchTab", data: { tab: "sessions" } });
				return true;
			}

			case "reload": {
				if (!this.session) return true;
				try {
					await (this.session as any).reload?.();
					await this.sendSessionResources();
					vscode.window.showInformationMessage(
						"Reloaded keybindings, extensions, skills, prompts",
					);
				} catch (error) {
					vscode.window.showErrorMessage(
						`Reload failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				return true;
			}

			case "import": {
				if (!args) {
					vscode.window.showErrorMessage("Usage: /import <path.jsonl>");
					return true;
				}
				// Import is complex (involves session replacement).
				// For now, show guidance — user can open the JSONL in editor.
				vscode.window.showInformationMessage(
					"Import from JSONL is not yet supported in the extension. Open the JSONL in the PI terminal to import.",
				);
				return true;
			}

			case "share": {
				if (!this.session) return true;
				try {
					// Export session to temp HTML, then create a secret gist via gh CLI
					const os = await import("node:os");
					const tmpFile = path.join(os.tmpdir(), `pi-session-${this.session.sessionId}.html`);
					await this.session.exportToHtml(tmpFile);

					// Check if gh CLI is available
					vscode.window.showInformationMessage(
						"Session exported. Opening in VS Code — you can copy the content to a gist at https://gist.github.com",
						"Open File",
						"Copy Path",
					).then((selection) => {
						if (selection === "Open File") {
							vscode.commands.executeCommand("vscode.open", vscode.Uri.file(tmpFile));
						} else if (selection === "Copy Path") {
							vscode.env.clipboard.writeText(tmpFile);
							vscode.window.showInformationMessage("Path copied: " + tmpFile);
						}
					});
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to share: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				return true;
			}

			case "changelog": {
				// Read the most recent changelog entries from the pi-coding-agent package
				try {
					const changelogPath = path.join(
						path.dirname(require.resolve("@earendil-works/pi-coding-agent/package.json")),
						"CHANGELOG.md",
					);
					if (fs.existsSync(changelogPath)) {
						const content = fs.readFileSync(changelogPath, "utf-8");
						// Parse ## headers — take first 3 entries
						const entries = content
							.split(/^## /m)
							.slice(1, 4)
							.map((e) => {
								const lines = e.split("\n");
								const version = lines[0]?.trim() || "";
								const body = lines.slice(1).join("\n").trim();
								// Take first ~300 chars of each entry
								const summary = body.length > 300
									? body.slice(0, 300).replace(/\n$/, "") + "..."
									: body;
								return `**${version}**\n${summary}`;
							});
						if (entries.length > 0) {
							this.notifyWebview({
								type: "system-message",
								data: {
									message:
										`📋 **Recent Changelog**\n\n${entries.join("\n\n---\n\n")}\n\n_See full changelog at: ${changelogPath}_`,
								},
							});
						} else {
							vscode.window.showInformationMessage("No changelog entries found.");
						}
					} else {
						vscode.window.showInformationMessage(
							"Changelog file not found at: " + changelogPath,
						);
					}
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to read changelog: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				return true;
			}

			case "hotkeys": {
				this.notifyWebview({
					type: "system-message",
					data: {
						message:
							"⌨ **Keyboard Shortcuts**\n" +
							"Ctrl+Shift+Alt+P — Open PiLot Studio\n" +
							"Ctrl+Shift+I — Focus chat input\n" +
							"Ctrl+Shift+N — New session\n" +
							"Ctrl+Shift+A — Attach file\n" +
							"Ctrl+Shift+; — Toggle dictation\n" +
							"Type / for slash commands",
					},
				});
				return true;
			}

			case "quit":
				// Not applicable in VS Code — ignore gracefully
				return true;

			case "logout":
				try {
					if (this.session) {
						await this.session.prompt(text, {
							streamingBehavior: "steer",
						});
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

			default:
				// Unknown slash command — forward to the session as a regular prompt
				// (handles extension commands registered via pi.registerCommand)
				return false;
		}
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

	async toggleFavorite(
		modelId: string,
		isFavorite: boolean,
	): Promise<string[]> {
		if (isFavorite && !this.favoriteModels.includes(modelId)) {
			this.favoriteModels = [...this.favoriteModels, modelId];
		} else if (!isFavorite) {
			this.favoriteModels = this.favoriteModels.filter((m) => m !== modelId);
		}
		await this.context.globalState.update(
			"favoriteModels",
			this.favoriteModels,
		);

		// Sync with TUI settings.json enabledModels (same as Ctrl+P scoped models)
		if (this.settingsManager) {
			this.settingsManager.setEnabledModels(this.favoriteModels);
			await this.settingsManager.flush();
		}

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
	}

	/** Serialize AgentSession messages to webview-friendly format */
	private serializeMessages(messages: any[]): Array<{
		role: string;
		content: string;
		thinking?: string;
		images?: Array<{ type: "image"; data: string; mimeType: string }>;
		timestamp: number;
	}> {
		const result: Array<{
			role: string;
			content: string;
			thinking?: string;
			images?: Array<{ type: "image"; data: string; mimeType: string }>;
			timestamp: number;
		}> = [];
		for (const msg of messages) {
			if (msg.role === "user") {
				if (typeof msg.content === "string") {
					result.push({ role: "user", content: msg.content, timestamp: msg.timestamp });
				} else if (Array.isArray(msg.content)) {
					const textParts: string[] = [];
					const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
					for (const c of msg.content) {
						if (c.type === "text") {
							textParts.push(c.text || "");
						} else if (c.type === "image" && c.data && c.mimeType) {
							images.push({
								type: "image",
								data: c.data,
								mimeType: c.mimeType,
							});
						}
					}
					result.push({
						role: "user",
						content: textParts.join("\n"),
						images: images.length > 0 ? images : undefined,
						timestamp: msg.timestamp,
					});
				}
			} else if (msg.role === "assistant") {
				const content = Array.isArray(msg.content)
					? msg.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text)
							.join("\n")
					: "";
				const thinking = Array.isArray(msg.content)
					? msg.content
							.filter((c: any) => c.type === "thinking")
							.map((c: any) => c.thinking)
							.join("\n")
					: undefined;
				result.push({
					role: "assistant",
					content,
					thinking,
					timestamp: msg.timestamp,
				});
			} else if (msg.role === "toolResult") {
				const content = Array.isArray(msg.content)
					? msg.content.map((c: any) => c.text || "").join("\n")
					: "";
				result.push({
					role: "system",
					content: `[Tool: ${msg.toolName}] ${content.slice(0, 200)}`,
					timestamp: msg.timestamp,
				});
			}
		}
		return result;
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
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return "";

		const root = workspaceFolders[0].uri.fsPath;

		try {
			const packageJsonPath = vscode.Uri.joinPath(
				workspaceFolders[0].uri,
				"package.json",
			);
			const packageJsonContent =
				await vscode.workspace.fs.readFile(packageJsonPath);
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
		const shellCommand = getShellCommand(args);
		if (shellCommand) {
			return spawn(shellCommand.command, shellCommand.args);
		}

		return spawn(findPiBinary(), args);
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

	// Voice Capture Methods
	private sendVoiceMessage(type: string, data?: unknown) {
		this.notifyWebview({ type, data } as any);
	}

	async toggleVoiceCapture() {
		if (this.isListening) {
			this.stopVoiceCapture();
		} else {
			await this.startVoiceCapture();
		}
	}

	private async startVoiceCapture() {
		try {
			// Check if voice is enabled in config
			const config = vscode.workspace.getConfiguration("pi-agent");
			if (config.get<boolean>("voice.enabled") === false) {
				vscode.window.showInformationMessage("Voice dictation is disabled in settings");
				return;
			}

			this.voiceModel = config.get<string>("voice.model") || "tiny-q5_1";

			// Check if voice helper exists
			const helperPath = getVoiceHelperPath(this.context.extensionUri);
			try {
				fs.accessSync(helperPath, fs.constants.X_OK);
			} catch {
				vscode.window.showErrorMessage(
					`Voice helper not found at ${helperPath}. Please reinstall the extension.`,
				);
				return;
			}

			// Resolve / download the whisper model
			let modelPath: string;
			try {
				modelPath = getVoiceModelPath(this.voiceModel);
			} catch {
				vscode.window.showErrorMessage(
					`Unknown voice model: ${this.voiceModel}. Supported models: ${Object.keys(VOICE_MODELS).join(", ")}`,
				);
				return;
			}

			const modelExists =
				fs.existsSync(modelPath) &&
				fs.statSync(modelPath).size > 1024 * 1024; // at least 1 MB

			if (!modelExists) {
				const modelDef = VOICE_MODELS[this.voiceModel];
				if (!modelDef) return;

				const choice = await vscode.window.showInformationMessage(
					`Voice dictation needs to download the whisper model "${modelDef.label}" (~${modelDef.expectedSizeMb} MB) from Hugging Face. The download is one-time and dictation always runs locally on your device.`,
					{ modal: true },
					"Download",
					"Cancel",
				);
				if (choice !== "Download") {
					return;
				}

				try {
					modelPath = await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Downloading ${modelDef.label}`,
							cancellable: true,
						},
						async (progress, token) => {
							const aborter = new AbortController();
							token.onCancellationRequested(() => aborter.abort());

							return downloadVoiceModel(
								this.voiceModel,
								(downloaded, total) => {
									if (total > 0) {
										const pct = Math.round((downloaded / total) * 100);
										const mbDown = (downloaded / (1024 * 1024)).toFixed(1);
										const mbTotal = (total / (1024 * 1024)).toFixed(1);
										progress.report({
											message: `${mbDown} / ${mbTotal} MB (${pct}%)`,
											increment: pct,
										});
										this.sendVoiceMessage("voice-status", {
											status: "downloading",
											message: `Downloading voice model... ${pct}%`,
										});
									}
								},
								(phase, message) => {
									this.sendVoiceMessage("voice-status", {
										status: phase,
										message: message || "",
									});
								},
								aborter.signal,
							);
						},
					);
				} catch (err) {
					if (
						err instanceof Error &&
						err.message === "Download cancelled"
					) {
						return;
					}
					vscode.window.showErrorMessage(
						`Failed to download voice model: ${err instanceof Error ? err.message : String(err)}`,
					);
					return;
				}
			}

			this.sendVoiceMessage("voice-status", {
				status: "preparing",
				message: "Loading voice model...",
			});

			// Initialize voice helper with full model path
			this.voiceHelperProcess = spawn(helperPath, ["--model", modelPath]);

			this.voiceHelperProcess.stdout?.on("data", (chunk) => {
				const text = chunk.toString();
				// Log all raw output for debugging transcription issues
				this.logDebug("[PI Voice stdout]", text.substring(0, 200));
				this.handleVoiceHelperOutput(text, modelPath);
			});

			this.voiceHelperProcess.stderr?.on("data", (chunk) => {
				const text = chunk.toString().trim();
				if (!text) return;

				// whisper.cpp logs model info to stderr, but the helper may also
				// send JSON messages (like transcriptions) to stderr on some platforms.
				// Try to parse each line as JSON; if it's a transcription, forward it.
				const lines = text.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed.startsWith("{")) {
						try {
							const msg: VoiceHelperMessage = JSON.parse(trimmed);
							if (msg.type === "transcription" && msg.text) {
								this.logDebug(
									"[PI Voice] Transcription (from stderr):",
									msg.text.substring(0, 100),
								);
								this.sendVoiceMessage("voice-transcription", { text: msg.text });
								continue;
							}
						} catch {
							// Not JSON, treat as log line
						}
					}
					this.logDebug("[PI Voice Helper]", trimmed);
				}
			});

			this.voiceHelperProcess.on("error", (err) => {
				this.logError("[PI Voice Helper error]:", err);
				this.sendVoiceMessage("voice-listening-changed", { listening: false });
				this.isListening = false;
			});

			this.voiceHelperProcess.on("close", (code) => {
				this.logDebug("[PI Voice Helper] Process exited with code:", code);
				if (this.isListening) {
					this.sendVoiceMessage("voice-listening-changed", { listening: false });
					this.isListening = false;
				}
			});
		} catch (error) {
			this.logError("[PI] Voice capture start failed:", error);
			vscode.window.showErrorMessage(
				`Failed to start voice capture: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private stopVoiceCapture() {
		if (this.voiceHelperProcess && this.isListening) {
			this.voiceHelperProcess.stdin?.write(JSON.stringify({ type: "stop" }) + "\n");
			this.voiceHelperProcess.stdin?.end();
			this.voiceHelperProcess = undefined;
		}
		this.isListening = false;
		this.voiceLineBuffer = "";
		this.sendVoiceMessage("voice-listening-changed", { listening: false });
	}

	private handleVoiceHelperOutput(chunk: string, modelPath: string) {
		// Accumulate partial lines — stdout chunks may split JSON lines
		// across multiple data events.
		this.voiceLineBuffer += chunk;
		const lines = this.voiceLineBuffer.split("\n");
		// The last entry is either empty (chunk ended with \n) or a partial
		// line to carry forward. Pop it and save for the next chunk.
		this.voiceLineBuffer = lines.pop() || "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg: VoiceHelperMessage = JSON.parse(trimmed);

				switch (msg.type) {
					case "ready":
						// Helper binary is ready to accept commands.
						// Send prepare to load the model, then start.
						this.voiceHelperProcess?.stdin?.write(
							JSON.stringify({ type: "prepare", modelPath }) + "\n",
						);
						break;

					case "prepared":
						// Model is loaded — start listening.
						this.voiceHelperProcess?.stdin?.write(
							JSON.stringify({ type: "start" }) + "\n",
						);
						break;

					case "started":
						// Microphone capture is active.
						this.isListening = true;
						this.sendVoiceMessage("voice-listening-changed", { listening: true });
						this.sendVoiceMessage("voice-status", {
							status: "listening",
							message: "Listening...",
						});
						break;

					case "permission":
						// Microphone permission response — expected after prepare.
						// The helper will send "prepared" next.
						break;

					case "transcript":
						if (msg.text) {
							this.logDebug(
								"[PI Voice] Transcription:",
								msg.text.substring(0, 100),
							);
							this.sendVoiceMessage("voice-transcription", { text: msg.text });
						} else {
							this.log(
								"[PI Voice] Transcription message received but text field is empty or undefined. Full message: " + JSON.stringify(msg),
							);
						}
						break;

					case "error":
						this.logError(
							"[PI Voice Helper error]:",
							msg.code + " " + (msg.message || msg.error),
						);
						// "start_failed" with "model is not ready" → model wasn't
						// loaded properly; treat as transient and stop gracefully.
						if (
							msg.code === "start_failed" &&
							msg.message?.includes("model is not ready")
						) {
							this.sendVoiceMessage("voice-status", {
								status: "error",
								message:
									"Voice model failed to load. Please try again or choose a different model.",
							});
						} else {
							vscode.window.showErrorMessage(
								`Voice capture error: ${msg.message || msg.error || "Unknown error"}`,
							);
						}
						this.stopVoiceCapture();
						break;

					case "level":
						this.sendVoiceMessage("voice-audio-level", { level: msg.level });
						break;
				}
			} catch {
				this.logDebug(
					"[PI] Failed to parse voice helper line:",
					trimmed,
				);
			}
		}
	}

	dispose() {
		this._onDidChangeTreeData.dispose();
		if (this.session) {
			this.session.dispose();
		}
		// Clean up voice helper process if running
		if (this.voiceHelperProcess) {
			this.voiceHelperProcess.stdin?.end();
			this.voiceHelperProcess.kill();
		}
	}
}
