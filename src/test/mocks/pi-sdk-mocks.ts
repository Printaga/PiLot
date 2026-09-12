import type {
	AgentSession,
	AgentSessionEvent,
	ModelRegistry,
	ModelRuntime,
	ResourceLoader,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export type MockAgentSession = AgentSession & {
	_sessionStartEvent?: AgentSessionEvent;
	_extensionUIContext?: unknown;
};

export type MockExtensionRunner = {
	setUIContext: (ctx: unknown) => void;
	getExtensionPaths?: () => string[];
	hasUI?: () => boolean;
	emit: (event: AgentSessionEvent) => Promise<void>;
	extensions?: Array<{
		path: string;
		handlers?: Map<string, (..._args: unknown[]) => unknown[]>;
	}>;
	extendResourcesFromExtensions?: (phase: string) => Promise<void>;
};

export function createMockAgentSession(options?: {
	extensionRunner?: MockExtensionRunner;
	sessionName?: string;
	sessionId?: string;
	messages?: any[];
	resourceLoader?: ResourceLoader;
	disposeCalls?: number;
}): MockAgentSession {
	const disposeCalls = 0;
	const session = {
		sessionName: options?.sessionName ?? null,
		sessionId: options?.sessionId ?? "test-session-id",
		messages: options?.messages ?? [],
		resourceLoader: options?.resourceLoader ?? createMockResourceLoader(),
		extensionRunner: options?.extensionRunner ?? createMockExtensionRunner(),
		dispose: () => {},
		subscribe: () => {},
		prompt: async () => {},
		abort: async () => {},
		compact: async () => ({}),
		editMessage: async () => ({}) as unknown,
		getContextUsage: () => ({ used: 0, total: 0 }),
		getSessionStats: () => ({}) as any,
		_replaceMessageInPlace: async () => ({}) as any,
		sessionManager: {
			getCwd: () => "/fake/workspace",
		} as any,
		...(options || {}),
		_disposeCalls: disposeCalls,
	} as unknown as MockAgentSession;

	(session as any).disposeCalls = disposeCalls;
	return session;
}

export function createMockExtensionRunner(): MockExtensionRunner {
	return {
		setUIContext: () => {},
		getExtensionPaths: () => [],
		hasUI: () => true,
		emit: async () => {},
		extensions: [],
		extendResourcesFromExtensions: async () => {},
	};
}

export function createMockResourceLoader(): ResourceLoader {
	return {
		reload: async () => {},
		getExtensions: () => ({
			extensions: [],
			errors: [],
		}),
		getSkills: () => [],
		getPrompts: () => [],
		getAgents: () => [],
		getContextFiles: () => [],
	} as unknown as ResourceLoader;
}

export function createMockAuthStorage(): unknown {
	// Legacy shape kept solely so older test fixtures that referenced it
	// (without using it) continue to compile during the SDK 0.80 migration.
	// It intentionally has no runtime users.
	return {};
}

export function createMockModelRuntime(): ModelRuntime {
	// Defaults match the SDK 0.80+ surface used by PiAgentProvider:
	// setRuntimeApiKey/removeRuntimeApiKey for auth management,
	// refresh for disk re-reads (auth.json + models.json). OAuth login/
	// logout exist on 0.84; stub them so tests that do not exercise the
	// flow still type-check and fail with clear errors if they do.
	return {
		setRuntimeApiKey: async (_provider: string, _apiKey: string) => {},
		removeRuntimeApiKey: async (_provider: string) => {},
		refresh: async () => ({}),
		checkAuth: async (_provider: string) => undefined,
		isUsingOAuth: () => false,
		getProviders: () => [],
		getRegisteredProviderIds: () => [],
		login: async (_providerId: string, _type: string, _interaction: unknown) => {
			throw new Error("login not stubbed in this test");
		},
		logout: async (_providerId: string) => {},
	} as unknown as ModelRuntime;
}

export function createMockModelRegistry(): ModelRegistry {
	// getAll() is synchronous on the real ModelRegistry; getAvailable() is async.
	return {
		getAvailable: async () => [],
		getAll: () => [],
		refresh: async () => ({}) as any,
	} as unknown as ModelRegistry;
}

export function createMockSettingsManager(): SettingsManager {
	const base: Record<string, unknown> = {
		getDefaultModel: () => null,
		getDefaultProvider: () => "",
		getDefaultThinkingLevel: () => "medium",
		setDefaultThinkingLevel: async () => {},
		setDefaultModelAndProvider: async () => {},
		getEnabledModels: () => [],
		setEnabledModels: async () => {},
		getShowCacheMissNotices: () => false,
		setShowCacheMissNotices: () => {},
		reload: async () => {},
		flush: async () => {},
		getGlobalSettings: () => ({}) as any,
		getProjectSettings: () => ({}) as any,
		isProjectTrusted: () => true,
		getRetrySettings: () => ({}) as any,
		getCompactionSettings: () => ({}) as any,
		getProviderRetrySettings: () => ({}) as any,
		getSteeringMode: () => undefined,
		getShellPath: () => undefined,
		getShellCommandPrefix: () => undefined,
		setProjectPackages: async () => {},
		setPackages: async () => {},
		setProjectTrusted: async () => {},
		get: () => undefined,
		update: async () => {},
	};
	// The SDK surface keeps growing; unknown method access becomes an async
	// no-op so resource-loader calls never explode in tests.
	return new Proxy(base, {
		get(target, prop) {
			if (prop === "then") return undefined;
			if (typeof prop === "string" && prop in target) {
				return target[prop];
			}
			return async () => undefined;
		},
	}) as unknown as SettingsManager;
}

export function createMockSessionManager(cwd = "/fake"): any {
	const sessionManager = {
		newSessionCalls: 0,
		newSession: () => {
			(sessionManager as any).newSessionCalls++;
		},
		open: async () => {},
		list: async () => [],
		getCwd: () => cwd,
	};
	return sessionManager;
}

export function createMockBinaryService(options?: {
	getCliVersion?: () => Promise<string | null>;
	resolveGitBranch?: (_cwd: string) => string | null;
}): {
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
	getCliVersion: () => Promise<string | null>;
	resolveGitBranch: (_cwd: string) => string | null;
} {
	return {
		logDebug: () => {},
		logError: () => {},
		getCliVersion: options?.getCliVersion ?? (async () => null),
		resolveGitBranch: options?.resolveGitBranch ?? (() => null),
	};
}

export function createMockMemento(): {
	get: <T>(key: string, defaultValue: T) => T;
	update: (key: string, value: unknown) => Promise<void>;
} {
	const store: Record<string, unknown> = {};
	return {
		get: <T>(key: string, defaultValue: T): T =>
			key in store ? (store[key] as T) : defaultValue,
		update: async (key: string, value: unknown): Promise<void> => {
			store[key] = value;
		},
	};
}

export function resetVscodeMocks(): void {
	const vscode = (globalThis as any).vscode;
	if (!vscode) return;

	(vscode.window.showInformationMessage as any) = async () => "Mock";
	(vscode.window.showErrorMessage as any) = async () => "Mock";
	(vscode.window.showWarningMessage as any) = async () => "Mock";
	(vscode.window.showInputBox as any) = async () => null;
	(vscode.window.showOpenDialog as any) = async () => [];
	(vscode.window.showSaveDialog as any) = async () => null;
	(vscode.window.showTextDocument as any) = () => ({});
	(vscode.window.activeTextEditor as any) = null;
	(vscode.window.withProgress as any) = async (_opts: any, task: () => Promise<any>) => task();
	(vscode.window.createTerminal as any) = () => ({
		sendText: () => {},
		show: () => {},
		dispose: () => {},
	});
	(vscode.window.createOutputChannel as any) = () => ({
		appendLine: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	});

	(vscode.workspace.workspaceFolders as any) = [{ uri: { fsPath: "/fake/workspace" } } as any];
	(vscode.workspace.getConfiguration as any) = () =>
		({
			get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
			update: async () => {},
		}) as unknown as any;
	(vscode.workspace.asRelativePath as any) = (uri: any) => uri.fsPath || "/fake";
	(vscode.workspace.findFiles as any) = async () => [];
	(vscode.workspace.openTextDocument as any) = async () => ({ getText: () => "" });
	(vscode.workspace.fs.createDirectory as any) = async () => {};
	(vscode.workspace.fs.writeFile as any) = async () => {};
	(vscode.workspace.onDidChangeConfiguration as any) = new (vscode.EventEmitter as any)().event;

	(vscode.commands.executeCommand as any) = async () => {};
	(vscode.commands.registerCommand as any) = () => ({ dispose: () => {} });

	(vscode.extensions.all as any) = [];
	(vscode.extensions.getExtension as any) = () => ({ extensionPath: "/fake/ext" });

	(vscode.Uri.file as any) = (p: string) => ({ fsPath: p, toString: () => p });
	(vscode.Uri.joinPath as any) = (uri: any, ...segments: string[]) => ({
		fsPath: [uri?.fsPath || "", ...segments].join("/"),
	});
}
