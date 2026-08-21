// ── Message protocol types shared between extension host and webview ─────────

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
	setThinkingLevel(
		level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	): Promise<void>;
	getPiUISettings(): Promise<{ showCacheMissNotices: boolean }>;
	setPiUISetting(key: "showCacheMissNotices", value: boolean): Promise<void>;
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
	getAvailableModels(): Promise<
		Array<{ id: string; provider: string; name: string }>
	>;
	tryHandleBuiltinCommand(text: string): Promise<boolean>;
	getCurrentModelId(): string | null;
	getExtensionVersion(): string;
	getPiCliVersion(): Promise<string | null>;
	isBinaryAvailable(): boolean;
	getThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
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
	refreshModels(): Promise<void>;
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
	openConfigFile(file: "auth" | "models" | "settings"): Promise<void>;
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
	setToolConfig(config: {
		toolPreset: string;
		customTools?: string[];
	}): Promise<void>;
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
	getSkillDiscovery(): boolean;
	setSkillDiscovery(enabled: boolean): void;
	setExtraSkillPaths(paths: string[]): Promise<void>;
	getExtraSkillPaths(): string[];
}
