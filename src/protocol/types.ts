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

	prompt(text: string, images?: unknown[]): Promise<void>;
	newSession(): Promise<void>;
	switchSession(sessionId: string): Promise<void>;
	forkSession(fromNodeId?: string): Promise<void>;
	navigateTree(nodeId: string): Promise<void>;
	setSessionName(name: string): Promise<void>;
	setModel(modelId: string): Promise<void>;
	setThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): Promise<void>;
	steer(text: string, images?: unknown[]): Promise<void>;
	followUp(text: string, images?: unknown[]): Promise<void>;
	abort(): Promise<void>;
	compact(): Promise<unknown>;
	getContextUsage(): unknown;
	getSessionStats(): unknown;
	getAutoCompactionEnabled(): boolean;
	setAutoCompactionEnabled(enabled: boolean): void;
	getAvailableModels(): Promise<Array<{ id: string; provider: string; name: string }>>;
	getCurrentModelId(): string | null;
	getExtensionVersion(): string;
	getPiCliVersion(): Promise<string | null>;
	getThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	getFavorites(): string[];
	getProviderAuthData(): Promise<Array<{ provider: string; name: string; configured: boolean; status: string }>>;
	setApiKey(provider: string, apiKey: string): Promise<void>;
	removeAuth(provider: string): Promise<void>;
	toggleFavorite(modelId: string, isFavorite: boolean): Promise<string[]>;
	listSessions(): Promise<Array<{ id: string; label: string; timestamp: number; messageCount: number }>>;
	listPackages(): Promise<Array<{ source: string; path: string }>>;
	installPackage(source: string): Promise<void>;
	uninstallPackage(source: string): Promise<void>;
	updatePackages(): Promise<void>;
	toggleVoiceCapture(): Promise<void>;
	sendSessionResources(): Promise<void>;
	logDebug(msg: string, ...details: unknown[]): void;
	logError(msg: string, error?: unknown): void;
	deleteSessions(sessionIds: string[]): Promise<void>;
	editMessage(index: number, text: string): Promise<void>;
}
