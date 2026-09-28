export interface AgentSessionMock {
	sessionName: string | null;
	sessionId: string;
	messages: any[];
	resourceLoader: any;
	extensionRunner: any;
	dispose: () => void;
	subscribe: (handler: any) => void;
	prompt: (text: string, images?: unknown[]) => Promise<void>;
	abort: () => Promise<void>;
	compact: () => Promise<unknown>;
	editMessage: (index: number, text: string) => Promise<void>;
	getContextUsage?: () => unknown;
	getSessionStats?: () => unknown;
	_replaceMessageInPlace?: (target: unknown, replacement: unknown) => Promise<unknown>;
	sessionManager: {
		getCwd: () => string;
		getBranch?: (fromId?: string) => any[];
		getPath?: () => any[];
		getEntry?: (id: string) => any | undefined;
	};
	events?: any[];
}

/** Structural view of what subscribe() receives, so handlers are typed instead of `any`. */
type SessionEventHandler = (event: unknown) => void;

export interface ExtensionRunnerMock {
	setUIContext: (ctx: unknown) => void;
	getExtensionPaths?: () => string[];
	hasUI: () => boolean;
	emit: (event: unknown) => Promise<void>;
	extensions: any[];
	extendResourcesFromExtensions?: (phase: string) => Promise<void>;
}

export interface ResourceLoaderMock {
	reload: () => Promise<void>;
	getExtensions: () => { extensions: any[]; errors: any[] };
	getSkills: () => any[];
	getPrompts: () => any[];
	getAgents: () => any[];
	getContextFiles: () => any[];
	getAgentsFiles: () => { agentsFiles: any[] };
}

export function createSessionMock(options?: {
	extensionRunner?: ExtensionRunnerMock;
	sessionName?: string | null;
	sessionId?: string;
	messages?: any[];
	resourceLoader?: ResourceLoaderMock;
	events?: any[];
}): AgentSessionMock {
	const mock: AgentSessionMock = {
		sessionName: options?.sessionName ?? null,
		sessionId: options?.sessionId ?? "test-session-id",
		messages: options?.messages ?? [],
		resourceLoader: options?.resourceLoader ?? createResourceLoaderMock(),
		extensionRunner:
			options && "extensionRunner" in options
				? options.extensionRunner
				: createExtensionRunnerMock(),
		dispose: () => {},
		subscribe: () => {},
		prompt: async () => {},
		abort: async () => {},
		compact: async () => ({}),
		editMessage: async () => {},
		getContextUsage: () => ({ used: 0, total: 0 }),
		getSessionStats: () => ({}),
		_replaceMessageInPlace: async () => ({}),
		sessionManager: {
			getCwd: () => "/fake/workspace",
			getBranch: () => [],
			getPath: () => [],
			getEntry: () => undefined,
			_rewriteFile: () => {},
		} as any,
		events: options?.events ?? [],
	};
	// Register the handler exactly once. The previous implementation pushed it
	// onto both `mock.events` AND `options.events`, but when the caller passed
	// `options.events` those are the SAME array — double registration, so every
	// emitted event fired handlers twice and double-counted test expectations.
	mock.subscribe = (handler: SessionEventHandler) => {
		(mock.events as SessionEventHandler[]).push(handler);
	};
	return mock;
}

export function createExtensionRunnerMock(options?: {
	extensions?: any[];
	extensionPaths?: string[];
}): ExtensionRunnerMock {
	return {
		setUIContext: () => {},
		getExtensionPaths: () => options?.extensionPaths ?? [],
		hasUI: () => true,
		emit: async () => {},
		extensions: options?.extensions ?? [],
		extendResourcesFromExtensions: async () => {},
	};
}

export function createResourceLoaderMock(
	overrides?: Partial<ResourceLoaderMock>,
): ResourceLoaderMock {
	return {
		reload: async () => {},
		getExtensions: () => ({
			extensions: overrides?.getExtensions?.()?.extensions ?? [],
			errors: overrides?.getExtensions?.()?.errors ?? [],
		}),
		getSkills: () => overrides?.getSkills?.() ?? [],
		getPrompts: () => overrides?.getPrompts?.() ?? [],
		getAgents: () => overrides?.getAgents?.() ?? [],
		getAgentsFiles: () => ({
			agentsFiles: overrides?.getAgentsFiles?.()?.agentsFiles ?? [],
		}),
		...overrides,
	} as ResourceLoaderMock;
}
