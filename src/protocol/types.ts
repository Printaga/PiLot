// ── Message protocol types shared between extension host and webview ─────────

import { type ThinkingLevel } from "../webview/types/index.js";

// ── MCP protocol types (shared with the MCP panel) ───────────────────────────

export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";
export type McpScope = "global" | "project" | "extension";

export interface McpServerInfo {
	name: string;
	scope: McpScope;
	source: string;
	override?: string;
	enabled: boolean;
	exposure: McpExposure;
	transport: string;
	description: string;
	state: string;
	tools: string[];
	toolExposure?: Record<string, McpExposure>;
	resources?: boolean;
	error?: string;
}

export interface McpFilesInfo {
	global: string;
	project: string;
	projectExists: boolean;
	projectTrusted: boolean;
}

export interface McpListPayload {
	servers: McpServerInfo[];
	errors: string[];
	files: McpFilesInfo;
	note?: string;
	checkError?: string;
	checkedAt?: number;
}

export interface McpAddInput {
	name: string;
	transport: "stdio" | "http";
	command?: string;
	args?: string[];
	/** Working directory for a stdio server (`pi mcp add --cwd`). */
	cwd?: string;
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	/** Sends `Authorization: Bearer ${name}` without storing the secret. */
	bearerTokenEnvVar?: string;
	/** Pre-registered OAuth client id for an HTTP server. */
	oauthClientId?: string;
	/** Pre-registered OAuth client secret for an HTTP server. */
	oauthClientSecret?: string;
	exposure?: McpExposure;
	description?: string;
	local?: boolean;
}

export interface McpConfigPatch {
	enabled?: boolean;
	exposure?: McpExposure;
}

/**
 * The set of thinking levels as a plain union, derived from the single ordered
 * source of truth (THINKING_LEVELS in model-registry-handler). Declaring the
 * union by hand here duplicated webview/types' ThinkingLevel and drifted.
 */
export type ProtocolThinkingLevel = ThinkingLevel;

/** Messages the webview sends to the extension host */
export interface WebviewMessage {
	type: string;
	id?: string;
	data?: unknown;
}

/** Messages the extension sends to the webview (postMessage payloads) */
export interface ProviderMessage {
	type?: string;
	data?: unknown;
	id?: string;
	isError?: boolean;
}

/** Keys accepted by openConfigFile; filenames/creation policy live in the provider. */
export type ConfigFileKey =
	"auth" | "models" | "settings" | "system-prompt" | "append-system-prompt" | "mcp";

/** How the codemode tool presents tools while it is active (`codemode.mode`). */
export type CodemodeMode = "on" | "only";

/** Which config layer supplied an effective codemode value. */
export type CodemodeSource = "default" | "global" | "project";

/** Result of considering the project settings file for codemode values. */
export type CodemodeProjectStatus = "none" | "applied" | "ignored" | "invalid";

export interface CodemodeSources {
	mode: CodemodeSource;
	inlineBudget: CodemodeSource;
	autoEnableCodemode: CodemodeSource;
}

export interface CodemodeSettings {
	mode: CodemodeMode;
	/** Estimated tokens codemode may spend declaring tools (`codemode.inlineBudget`). */
	inlineBudget: number;
	/** Whether connecting a codemode server activates codemode (`autoEnableCodemode`). */
	autoEnableCodemode: boolean;
	/** Config layer that supplied each effective value. */
	sources: CodemodeSources;
	/** `<cwd>/.pi/settings.json`, when a workspace is open. */
	projectFile?: string;
	projectStatus?: CodemodeProjectStatus;
	/** Parse error for the project file, when `projectStatus` is `invalid`. */
	projectError?: string;
}

export type CodemodeSettingsPatch = Partial<
	Pick<CodemodeSettings, "mode" | "inlineBudget" | "autoEnableCodemode">
>;

/** Prompt cache-warming behavior (`cacheWarming` setting). */
export type CacheWarmingMode = "off" | "streaming" | "idle";

/** Image/classifier catalog entries for the Providers panel. */
export interface MediaModelEntry {
	provider: string;
	id: string;
	name: string;
	available: boolean;
}

// ── Provider API interface — used by MessageHandler to avoid importing
//     the full PiAgentProvider class (breaks circular dependency) ────────

export interface ProviderApi {
	readonly webview: { postMessage(message: ProviderMessage): void } | undefined;
	readonly hasSession: boolean;
	getSession(): { sessionName: string | undefined } | undefined;

	prompt(text: string, images?: unknown[]): Promise<void>;
	newSession(): Promise<void>;
	switchSession(sessionId: string): Promise<void>;
	forkSession(fromNodeId?: string): Promise<void>;
	navigateTree(nodeId: string): Promise<void>;
	setSessionName(name: string): Promise<void>;
	setModel(modelId: string): Promise<void>;
	setThinkingLevel(level: ProtocolThinkingLevel): Promise<void>;
	getPiUISettings(): Promise<{ showCacheMissNotices: boolean }>;
	setPiUISetting(key: "showCacheMissNotices", value: boolean): Promise<void>;
	getCodemodeSettings(): Promise<CodemodeSettings>;
	setCodemodeSettings(patch: CodemodeSettingsPatch): Promise<CodemodeSettings>;
	getCacheWarmingMode(): Promise<CacheWarmingMode>;
	setCacheWarmingMode(mode: CacheWarmingMode): Promise<void>;
	getDefaultToolsCodemodeEnabled(): Promise<{
		enabled: boolean;
		globalEnabled: boolean;
		tools?: string[];
	}>;
	setDefaultToolsCodemodeEnabled(enabled: boolean): Promise<{
		enabled: boolean;
		globalEnabled: boolean;
		tools?: string[];
	}>;
	getMediaModels(): Promise<{ image: MediaModelEntry[]; classifier: MediaModelEntry[] }>;
	steer(text: string, images?: unknown[]): Promise<void>;
	followUp(text: string, images?: unknown[]): Promise<void>;
	abort(): Promise<void>;
	compact(): Promise<unknown>;
	getContextUsage(): unknown;
	getSessionStats(): unknown;
	getAutoCompactionEnabled(): boolean;
	setAutoCompactionEnabled(enabled: boolean): void;
	getAutoContext(): boolean;
	setAutoContext(enabled: boolean): void;
	getAvailableModels(): Promise<Array<{ id: string; provider: string; name: string }>>;
	tryHandleBuiltinCommand(text: string): Promise<boolean>;
	getCurrentModelId(): string | null;
	getExtensionVersion(): string;
	getPiCliVersion(): Promise<string | null>;
	isBinaryAvailable(): boolean;
	getThinkingLevel(): ProtocolThinkingLevel;
	getFavorites(): string[];
	getProviderAuthData(): Promise<
		Array<{
			provider: string;
			name: string;
			configured: boolean;
			status: string;
			custom: boolean;
			credentialType: "oauth" | "api_key" | null;
			/** Provider offers an OAuth login flow (mirrors the PI CLI's /login list). */
			oauthLogin: boolean;
			/** Custom-provider base URL (models.json `baseUrl`), if known. */
			baseUrl?: string;
			/** Custom-provider API wire protocol (models.json `api`), if known. */
			api?: string;
			/** Custom-provider static model list (models.json `models`) for re-editing. */
			models?: Array<{ id: string; name?: string }>;
		}>
	>;
	checkProviderAuth(providerId: string): Promise<{
		provider: string;
		configured: boolean;
		credentialType: "oauth" | "api_key" | null;
	}>;
	refreshModels(
		refreshCredentials?: boolean,
		options?: { allowNetwork?: boolean },
	): Promise<void>;
	setApiKey(provider: string, apiKey: string): Promise<void>;
	removeAuth(provider: string): Promise<void>;
	/** Start an interactive OAuth login flow (PI CLI /login parity). */
	loginProvider(providerId: string): Promise<void>;
	/** Abort an in-flight OAuth login and reject its pending prompts. */
	cancelProviderLogin(providerId: string): void;
	/** Answer a login prompt previously sent to the webview. */
	resolveLoginPrompt(
		providerId: string,
		promptId: string,
		value: string | undefined,
		cancelled: boolean,
	): void;
	/** Open an external URL (login links) in the system browser. */
	openExternalUrl(url: string): Promise<void>;
	addProvider(input: {
		provider: string;
		name?: string;
		baseUrl?: string;
		apiKey?: string;
		api?: string;
		headers?: Record<string, string>;
		/** Model list to persist. When provided (even empty), replaces the stored list. */
		models?: Array<{ id: string; name?: string }>;
	}): Promise<void>;
	removeProvider(providerId: string): Promise<void>;
	/**
	 * Fetch the list of models advertised by a custom (OpenAI-compatible)
	 * provider endpoint, e.g. `GET {baseUrl}/models`. Returns the model IDs
	 * (and optional display names) the provider exposes.
	 */
	fetchProviderModels(input: {
		baseUrl: string;
		api?: string;
		apiKey?: string;
	}): Promise<Array<{ id: string; name?: string }>>;
	openConfigFile(file: ConfigFileKey): Promise<void>;
	/** Open the global or project `mcp.json`, creating it when missing. */
	openMcpConfig(scope: "global" | "project"): Promise<void>;
	/** Configured MCP servers from mcp.json without connecting to them. */
	listMcpServers(): Promise<McpListPayload>;
	/** Configured servers plus live state/tools from `pi mcp list --json`. */
	checkMcpServers(): Promise<McpListPayload>;
	addMcpServer(input: McpAddInput): Promise<void>;
	removeMcpServer(name: string, scope: "global" | "project"): Promise<void>;
	updateMcpServerConfig(
		name: string,
		patch: McpConfigPatch,
		scope?: "global" | "project",
	): Promise<void>;
	loginMcpServer(name: string): Promise<void>;
	logoutMcpServer(name: string): Promise<void>;
	toggleFavorite(modelId: string, isFavorite: boolean): Promise<string[]>;
	listSessions(): Promise<
		Array<{
			id: string;
			label: string;
			timestamp: number;
			messageCount: number;
		}>
	>;
	listPackages(): Promise<
		Array<{
			source: string;
			path: string;
			description: string;
			version: string;
			types: string[];
			skills: Array<{ name: string; description: string }>;
			extensions: Array<{ path: string; sourceName: string | null }>;
			prompts: Array<{ name: string; description: string }>;
			local?: boolean;
		}>
	>;
	installPackage(source: string): Promise<void>;
	uninstallPackage(source: string): Promise<void>;
	updatePackages(): Promise<void>;
	toggleVoiceCapture(): Promise<void>;
	sendSessionResources(): Promise<void>;
	logDebug(msg: string, ...details: unknown[]): void;
	logError(msg: string, error?: unknown): void;
	deleteSessions(sessionIds: string[]): Promise<void>;
	editMessage(index: number, text: string): Promise<void>;
	getSettings(): Promise<{ toolPreset: string; customTools: string[] }>;
	setToolConfig(config: { toolPreset: string; customTools?: string[] }): Promise<void>;
	getAllSkills(): Promise<
		Array<{
			name: string;
			description: string;
			sourceName: string | null;
			path: string;
			sourceType: string;
		}>
	>;
	sendSkillsList(): Promise<void>;
	/** Push the active session's live system prompt to the webview. */
	sendSystemPrompt(): void;
	getSkillDiscovery(): boolean;
	setSkillDiscovery(enabled: boolean): void;
	/** Whether pi-agent.* settings currently override SYSTEM.md / APPEND_SYSTEM.md. */
	getSystemPromptOverrides(): { systemPrompt: boolean; appendSystemPrompts: boolean };
	setExtraSkillPaths(paths: string[]): Promise<void>;
	getExtraSkillPaths(): string[];
	getLightMode(): boolean;
	/** Model pinned for commit-message drafting (`provider/id`); empty uses the standard PI model. */
	getCommitMessageModel(): string;
	setCommitMessageModel(modelId: string): Promise<void>;
	setLightMode(enabled: boolean): Promise<void>;
	getResourceToggles(): { disabledSkills: string[]; disabledPackages: string[] };
	setSkillEnabled(key: string, enabled: boolean): Promise<void>;
	setPackageEnabled(source: string, enabled: boolean): Promise<void>;
	restartSessionPreservingHistory(): Promise<void>;
}
