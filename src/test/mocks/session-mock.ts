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
	sessionManager: { getCwd: () => string };
	events?: any[];
}

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
		extensionRunner: options?.extensionRunner ?? createExtensionRunnerMock(),
		dispose: () => {},
		subscribe: () => {},
		prompt: async () => {},
		abort: async () => {},
		compact: async () => ({}),
		editMessage: async () => {},
		sessionManager: {
			getCwd: () => "/fake/workspace",
		},
		events: options?.events ?? [],
	};
	mock.subscribe = (handler: any) => {
		mock.events?.push(handler);
		if (options?.events) {
			options.events.push(handler);
		}
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
