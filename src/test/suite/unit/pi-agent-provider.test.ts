import * as assert from "node:assert";
import * as vscode from "vscode";
import {
	type AuthStorage,
	type ModelRegistry,
	type SessionManager,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
	PiAgentProvider,
	type PiAgentConfig,
	piAgentProviderInternals,
} from "../../../pi-agent-provider.js";
import { ModelRegistryHandler } from "../../../model-registry-handler.js";
import { PackageManager } from "../../../package-manager.js";
import { SessionListManager } from "../../../session-manager.js";
import { SessionResources } from "../../../session-resources.js";
import {
	createSessionMock,
	createResourceLoaderMock,
} from "../../mocks/session-mock.js";
import {
	createMockMemento,
	createMockBinaryService,
	createMockModelRegistry,
	createMockSettingsManager,
	createMockSessionManager,
} from "../../mocks/pi-sdk-mocks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWebviewView(): vscode.WebviewView {
	const emitter = new vscode.EventEmitter<boolean>();
	return {
		webview: {
			postMessage: () => {},
			options: {},
			asWebviewUri: (uri: vscode.Uri) => uri,
			html: "",
		},
		title: "",
		description: undefined,
		visible: true,
		onDidChangeVisibility: emitter.event,
		show: () => {},
		dispose: () => {
			emitter.dispose();
		},
	} as unknown as vscode.WebviewView;
}

let savedCreateAgentSession:
	| typeof piAgentProviderInternals.createAgentSession
	| undefined;
let savedGetAgentDir: typeof piAgentProviderInternals.getAgentDir | undefined;
let savedCreateAuthStorage:
	| typeof piAgentProviderInternals.createAuthStorage
	| undefined;
let savedCreateModelRegistry:
	| typeof piAgentProviderInternals.createModelRegistry
	| undefined;
let savedCreateSettingsManager:
	| typeof piAgentProviderInternals.createSettingsManager
	| undefined;
let savedCreateSessionManager:
	| typeof piAgentProviderInternals.createSessionManager
	| undefined;

function setupPiSdkMocks() {
	savedCreateAgentSession = piAgentProviderInternals.createAgentSession;
	piAgentProviderInternals.createAgentSession = (async (opts: any) => ({
		session: createSessionMock({
			resourceLoader: opts.resourceLoader || createResourceLoaderMock(),
			sessionId: "mock-session-" + Math.random().toString(36).slice(2),
			sessionName: null,
		}),
		extensionsResult: { statuses: [] },
	})) as any;
	savedGetAgentDir = piAgentProviderInternals.getAgentDir;
	piAgentProviderInternals.getAgentDir = () => "/fake/agent-dir";
	savedCreateAuthStorage = piAgentProviderInternals.createAuthStorage;
	piAgentProviderInternals.createAuthStorage = () => ({} as AuthStorage);
	savedCreateModelRegistry = piAgentProviderInternals.createModelRegistry;
	piAgentProviderInternals.createModelRegistry = () => ({} as ModelRegistry);
	savedCreateSettingsManager = piAgentProviderInternals.createSettingsManager;
	piAgentProviderInternals.createSettingsManager = () => ({} as SettingsManager);
	savedCreateSessionManager = piAgentProviderInternals.createSessionManager;
	piAgentProviderInternals.createSessionManager = () => ({} as SessionManager);
}

function restorePiSdkMocks() {
	if (savedCreateAgentSession !== undefined) {
		piAgentProviderInternals.createAgentSession = savedCreateAgentSession;
	}
	if (savedGetAgentDir !== undefined) {
		piAgentProviderInternals.getAgentDir = savedGetAgentDir;
	}
	if (savedCreateAuthStorage !== undefined) {
		piAgentProviderInternals.createAuthStorage = savedCreateAuthStorage;
	}
	if (savedCreateModelRegistry !== undefined) {
		piAgentProviderInternals.createModelRegistry = savedCreateModelRegistry;
	}
	if (savedCreateSettingsManager !== undefined) {
		piAgentProviderInternals.createSettingsManager =
			savedCreateSettingsManager;
	}
	if (savedCreateSessionManager !== undefined) {
		piAgentProviderInternals.createSessionManager =
			savedCreateSessionManager;
	}
}

function createTestConfig(overrides: Partial<PiAgentConfig> = {}): PiAgentConfig {
	return {
		defaultModel: "openai/gpt-4o-mini",
		defaultProvider: "openai",
		autoContext: false,
		maxTokens: 8192,
		thinkingLevel: "medium",
		sessionDir: undefined,
		...overrides,
	};
}

function createMockAuthStorage() {
	return {} as AuthStorage;
}

function buildProvider(
	overrides: Partial<PiAgentConfig> = {},
	options: {
		mockView?: vscode.WebviewView;
		cwd?: string;
	} = {},
): PiAgentProvider {
	const config = createTestConfig(overrides);
	const view = options.mockView || createMockWebviewView();
	const contextExtensionUri = vscode.Uri.file("/fake/extension");

	const mockCtx = {
		extensionUri: contextExtensionUri,
		globalState: createMockMemento() as any,
		subscriptions: [],
		workspaceState: createMockMemento() as any,
		extension: {
			packageJSON: { version: "1.0.0" },
		},
	};

	const provider = new PiAgentProvider(mockCtx as any, config);
	provider.resolveWebviewView(view);

	const mockBinary = createMockBinaryService({ getCliVersion: async () => "0.1.0" });
	(provider as any).binaryService = {
		...mockBinary,
		resolveAtStartup: () => {},
		prependToPath: () => {},
		isBinaryAvailable: () => true,
	} as any;

	(provider as any).authStorage = createMockAuthStorage();
	(provider as any).modelRegistry = createMockModelRegistry();
	(provider as any).sessionManager = createMockSessionManager(options.cwd || "/fake/workspace");
	(provider as any).settingsManager = createMockSettingsManager();
	(provider as any).modelRegistryHandler = new ModelRegistryHandler({
		getModelRegistry: () => (provider as any).modelRegistry,
		getAuthStorage: () => (provider as any).authStorage,
		getSettingsManager: () => (provider as any).settingsManager,
		binaryService: (provider as any).binaryService,
		availableModels: (provider as any).availableModels,
		favoriteModels: (provider as any).favoriteModels,
		currentModelId: (provider as any).currentModelId,
		globalState: mockCtx.globalState,
		notifyWebview: (msg: any) => provider["notifyWebview"](msg),
		logError: (_msg: string, _e?: unknown) => {},
		logDebug: (..._args: any[]) => {},
	});
	(provider as any).packageManager = new PackageManager({
		getResourceLoader: () => (provider as any).session?.resourceLoader,
		getConfiguredPackages: () => [],
		binaryService: (provider as any).binaryService,
		notifyWebview: (msg: any) => provider["notifyWebview"](msg),
		logDebug: (..._args: any[]) => {},
		logError: (..._args: any[]) => {},
	});

	(provider as any).sessionListManager = new SessionListManager({
		config,
		getSession: () => (provider as any).session,
		setSession: (s: any) => { (provider as any).session = s; },
		getSessionManager: () => (provider as any).sessionManager,
		setSessionManager: (m: any) => { (provider as any).sessionManager = m; },
		getAuthStorage: () => (provider as any).authStorage,
		getModelRegistry: () => (provider as any).modelRegistry,
		getSettingsManager: () => (provider as any).settingsManager,
		notifyWebview: (msg: any) => provider["notifyWebview"](msg),
		logDebug: (..._args: any[]) => {},
		logError: (..._args: any[]) => {},
		onSessionDeleted: async () => { await provider["newSession"](); },
	});

	(provider as any).voiceManager = {
		dispose: () => {},
		toggleVoiceCapture: async () => {},
	} as any;

	(provider as any).sessionResources = new SessionResources({
		logError: (..._args: any[]) => {},
		logDebug: (..._args: any[]) => {},
		settingsManager: undefined,
	});

	(provider as any).footerManager = {
		start: () => {},
		stop: () => {},
		sendFooterData: () => {},
		dispose: () => {},
	} as any;

	(provider as any).messageHandler = {
		handle: async (_msg: any) => ({}),
	} as any;

	(provider as any).view = view;
	(provider as any)._webview = view.webview;
	(provider as any).isInitialized = true;

	return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite("PiAgentProvider", () => {
	setup(() => {
		setupPiSdkMocks();
	});

	teardown(() => {
		restorePiSdkMocks();
	});

	suite("constructor", () => {
		test("creates instance with defaults", () => {
			const ctx = {
				extensionUri: vscode.Uri.file("/fake/extension"),
				globalState: createMockMemento() as any,
				subscriptions: [],
				workspaceState: createMockMemento() as any,
				extension: { packageJSON: { version: "1.0.0" } },
			} as any;

			const provider = new PiAgentProvider(ctx, createTestConfig());
			assert.ok(provider, "provider should be created");
			assert.strictEqual((provider as any).isInitialized, false);
		});
	});

	suite("initialize", () => {
		test("skips if already initialized", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			await provider["initialize"]();
			assert.strictEqual((provider as any).isInitialized, true);
		});

		test("resolves binary service at startup", async () => {
			const resolveCalls: any[][] = [];
			const provider = buildProvider();
			(provider as any).binaryService.resolveAtStartup = () => {
				resolveCalls.push([]);
			};
			(provider as any).isInitialized = false;

			await provider["initialize"]();
			assert.ok(resolveCalls.length > 0, "resolveAtStartup should be called");
		});

		test("creates AuthStorage ModelRegistry SettingsManager SessionManager via PI SDK", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};

			await provider["initialize"]();
			assert.strictEqual((provider as any).isInitialized, true);
			assert.ok((provider as any).authStorage, "authStorage should be set");
			assert.ok((provider as any).modelRegistry, "modelRegistry should be set");
			assert.ok((provider as any).settingsManager, "settingsManager should be set");
			assert.ok((provider as any).sessionManager, "sessionManager should be set");
		});

		test("restores currentModelId from settings then globalState", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};

			const mockSettings = {
				getDefaultModel: () => "gpt-4o",
				getDefaultProvider: () => "openai",
				flush: async () => {},
			};
			(provider as any).settingsManager = mockSettings as any;

			await provider["initialize"]();
			assert.strictEqual((provider as any).currentModelId, "openai/gpt-4o");
		});

		test("on failure restores PATH and shows error", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};
			(provider as any).binaryService.isBinaryAvailable = () => true;

			const err = new Error("init boom");
			piAgentProviderInternals.createAuthStorage = () => {
				throw err;
			};

			const errorCalls: any[] = [];
			(vscode.window.showErrorMessage as any) = (msg: string) => {
				errorCalls.push(msg);
			};

			await provider["initialize"]();
			assert.strictEqual((provider as any).isInitialized, false);
			assert.ok(errorCalls.length > 0, "showErrorMessage should be called");
		});
	});

	suite("buildSessionOptions", () => {
		test("toolPreset none sets noTools to 'all'", async () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "toolPreset") return "none";
					return def;
				},
				update: async () => {},
			});

			const opts = await (provider as any).buildSessionOptions("/fake/workspace");
			assert.strictEqual(opts.noTools, "all");
			assert.strictEqual(opts.tools, undefined);
		});

		test("toolPreset default does not restrict tools", async () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "toolPreset") return "default";
					return def;
				},
				update: async () => {},
			});

			const opts = await (provider as any).buildSessionOptions("/fake/workspace");
			assert.strictEqual(opts.noTools, undefined);
			assert.strictEqual(opts.tools, undefined);
		});
	});

	suite("createSession", () => {
		test("throws when dependencies missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).authStorage = undefined;
			(provider as any).modelRegistry = undefined;

			try {
				await provider["createSession"]();
				assert.fail("expected error to be thrown");
			} catch (e: any) {
				assert.ok(
					e.message.includes("dependencies not initialized"),
					"expected deps error",
				);
			}
		});

		test("successful creation sets session and subscribes events", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).authStorage = createMockAuthStorage();
			(provider as any).modelRegistry = createMockModelRegistry();

			const mockSession = createSessionMock({
				sessionId: "new-session-1",
				sessionName: null,
			});
			mockSession.subscribe = (handler: any) => {
				(mockSession as any)._subscribedHandler = handler;
			};
			piAgentProviderInternals.createAgentSession = (async () => ({
				session: mockSession,
				extensionsResult: { statuses: [] },
			})) as any;

			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: () => false,
				update: async () => {},
			});

			await provider["createSession"]();
			assert.ok((provider as any).session, "session should be set");
			assert.strictEqual((provider as any).session.sessionId, "new-session-1");
		});
	});

	suite("newSession", () => {
		test("stops footer, clears statuses, and emits session-updated", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).authStorage = createMockAuthStorage();
			(provider as any).modelRegistry = createMockModelRegistry();

			const mockOldSession = createSessionMock({ sessionId: "old-session" });
			(provider as any).session = mockOldSession as any;

			const mockNewSession = createSessionMock({ sessionId: "new-session" });
			piAgentProviderInternals.createAgentSession = (async () => ({
				session: mockNewSession,
				extensionsResult: { statuses: [] },
			})) as any;

			const footerStopCalls: string[] = [];
			(provider as any).footerManager = {
				start: () => {},
				stop: () => { footerStopCalls.push("stop"); },
				sendFooterData: () => {},
				dispose: () => {},
			} as any;

			const eventCalls: any[] = [];
			(provider as any)._onDidChangeTreeData = {
				fire: () => { eventCalls.push("treeData"); },
			} as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await provider["newSession"]();

			assert.ok(
				footerStopCalls.includes("stop"),
				"footerManager.stop should be called",
			);
			assert.ok(
				messages.some((m: any) => m.type === "extension-statuses-clear"),
				"extension-statuses-clear should be sent",
			);
			assert.ok(
				messages.some((m: any) => m.type === "session-updated"),
				"session-updated should be sent",
			);
			assert.ok(
				messages.some((m: any) => m.type === "context-usage"),
				"context-usage should be sent",
			);
		});
	});

	suite("prompt", () => {
		test("creates session when missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).authStorage = createMockAuthStorage();
			(provider as any).modelRegistry = createMockModelRegistry();
			(provider as any).session = undefined;

			const mockSession = createSessionMock({ sessionId: "auto-session" });
			piAgentProviderInternals.createAgentSession = (async () => ({
				session: mockSession,
				extensionsResult: { statuses: [] },
			})) as any;

			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: () => false,
				update: async () => {},
			});

			mockSession.prompt = async () => {};
			mockSession.resourceLoader = createResourceLoaderMock();

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await provider["prompt"]("hello world");
			assert.ok((provider as any).session, "session should be created");
		});

		test("sends error to webview and re-throws on prompt failure", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).authStorage = createMockAuthStorage();
			(provider as any).modelRegistry = createMockModelRegistry();

			const mockSession = createSessionMock({ sessionId: "session-x" });
			mockSession.prompt = async () => {
				throw new Error("prompt boom");
			};
			mockSession.resourceLoader = createResourceLoaderMock();
			(provider as any).session = mockSession as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			try {
				await provider["prompt"]("hello");
				assert.fail("expected error to be re-thrown");
			} catch (e: any) {
				assert.strictEqual(e.message, "prompt boom");
			}

			const errorMsg = messages.find((m: any) => m.type === "error");
			assert.ok(errorMsg, "expected error notification");
			assert.strictEqual(errorMsg.data.message, "prompt boom");
		});
	});

	suite("abort", () => {
		test("calls session.abort when session exists", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const abortCalls: string[] = [];
			const mockSession = createSessionMock({ sessionId: "session-1" });
			mockSession.abort = async () => {
				abortCalls.push("abort");
			};
			(provider as any).session = mockSession as any;

			await provider["abort"]();
			assert.ok(abortCalls.includes("abort"), "session.abort should be called");
		});
	});

	suite("compact", () => {
		test("calls session.compact", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const mockSession = createSessionMock({ sessionId: "session-1" });
			mockSession.compact = async () => ({ ok: true });
			(mockSession as any).getContextUsage = () => ({ used: 10, total: 100 });
			(provider as any).session = mockSession as any;

			await provider["compact"]();
		});

		test("handles compaction error", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const mockSession = createSessionMock({ sessionId: "session-1" });
			mockSession.compact = async () => {
				throw new Error("compact boom");
			};
			(provider as any).session = mockSession as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			try {
				await provider["compact"]();
				assert.fail("expected error to be re-thrown");
			} catch (e: any) {
				assert.strictEqual(e.message, "compact boom");
			}

			const errorMsg = messages.find((m: any) => m.type === "error");
			assert.ok(errorMsg, "expected error notification");
		});
	});

	suite("editMessage", () => {
		test("returns early when session missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).session = undefined;

			await provider["editMessage"](0, "new text");
			assert.ok(true, "should not throw");
		});

		test("returns early when session has no messages", async () => {
			const provider = buildProvider();
			const mockSession = createSessionMock({
				sessionId: "session-1",
				messages: [],
			});
			(provider as any).session = mockSession as any;

			await provider["editMessage"](0, "updated text");
			assert.ok(true, "should not throw");
		});

		test("replaces message and broadcaster history", async () => {
			const provider = buildProvider();
			const messages: any[] = [];
			const mockSession = createSessionMock({
				sessionId: "session-1",
				messages: [
					{ role: "user", content: "original", timestamp: 1 },
				],
			});
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};
			(provider as any).session = mockSession as any;
			mockSession.editMessage = async () => {};

			await provider["editMessage"](0, "updated text");

			const historyMsg = messages.find((m: any) => m.type === "session-history");
			assert.ok(historyMsg, "session-history should be broadcast");
		});
	});

	suite("setApiKey / removeAuth", () => {
		test("setApiKey calls authStorage.set and refreshes models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const setCalls: any[] = [];
			const mockAuth = {
				set: (provider: string, credential: any) => {
					setCalls.push({ provider, credential });
				},
				remove: () => {},
			};
			(provider as any).authStorage = mockAuth as any;

			const refreshCalls: any[] = [];
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					refreshCalls.push("refresh");
				},
				buildModelList: (m: any) => m,
				getMergedModels: async () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;

			await provider["setApiKey"]("openai", "sk-123");

			assert.ok(
				setCalls.some((c) => c.provider === "openai"),
				"authStorage.set should be called with openai",
			);
			assert.ok(
				refreshCalls.includes("refresh"),
				"refreshAvailableModels should be called",
			);
		});

		test("removeAuth calls authStorage.remove and refreshes models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const removeCalls: string[] = [];
			const mockAuth = {
				set: () => {},
				remove: (provider: string) => {
					removeCalls.push(provider);
				},
			};
			(provider as any).authStorage = mockAuth as any;

			const refreshCalls: any[] = [];
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					refreshCalls.push("refresh");
				},
				buildModelList: (m: any) => m,
				getMergedModels: async () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;

			await provider["removeAuth"]("openai");

			assert.ok(removeCalls.includes("openai"), "authStorage.remove should be called");
			assert.ok(refreshCalls.includes("refresh"), "refresh should be called");
		});
	});

	suite("switchSession", () => {
		test("handles invalid session id gracefully", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).sessionManager = createMockSessionManager("/fake") as any;

			const mockListManager = {
				invalidateSessionListCache: () => {},
				refreshSessionList: async () => {},
				listSessions: async () => [],
				sessionListFullCache: [],
			};
			(provider as any).sessionListManager = mockListManager as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await provider["switchSession"]("nonexistent-session-id");

			const errorMsg = messages.find((m: any) => m.type === "error");
			assert.ok(errorMsg, "expected error notification for missing session");
		});
	});

	suite("deleteSessions", () => {
		test("returns early when no session IDs provided", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).sessionManager = createMockSessionManager("/fake") as any;

			const mockListManager = {
				invalidateSessionListCache: () => {},
				refreshSessionList: async () => {},
				listSessions: async () => [],
				sessionListFullCache: [],
			};
			(provider as any).sessionListManager = mockListManager as any;

			await provider["deleteSessions"]([]);
			assert.ok(true, "should handle empty sessionIds");
		});
	});

	suite("handleSessionEvent", () => {
		test("message_end refreshes session list and stats", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const refreshCalls: any[] = [];
			const mockListManager = {
				refreshSessionList: (...args: any[]) => {
					refreshCalls.push(args);
				},
			};
			(provider as any).sessionListManager = mockListManager as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "message_end",
			} as any);

			assert.ok(refreshCalls.length > 0, "refreshSessionList should be called");
			assert.ok(
				messages.some((m: any) => m.type === "session-stats"),
				"session-stats should be sent",
			);
		});

		test("compaction_end sends context-usage", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).session = createSessionMock({}) as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "compaction_end",
			} as any);

			assert.ok(
				messages.some((m: any) => m.type === "context-usage"),
				"context-usage should be sent on compaction_end",
			);
		});

		test("session_info_changed refreshes resources and sends name change", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).session = createSessionMock({ sessionName: "new name" }) as any;

			const refreshCalls: any[] = [];
			const mockListManager = {
				refreshSessionList: async () => {
					refreshCalls.push("refresh");
				},
			};
			(provider as any).sessionListManager = mockListManager as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "session_info_changed",
				name: "new name",
			} as any);

			assert.ok(
				messages.some((m: any) => m.type === "session-name-changed"),
				"session-name-changed should be sent",
			);
		});

		test("tool_execution_start emits activity-start with tool name", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "tool_execution_start",
				toolName: "read",
				toolCallId: "call-1",
				args: { file_path: "/fake/file.ts" },
			} as any);

			const activityMsg = messages.find((m: any) => m.type === "activity-start");
			assert.ok(activityMsg, "activity-start should be emitted");
			assert.ok(
				activityMsg.data.text.includes("read"),
				"activity text should include tool name",
			);
		});

		test("tool_execution_end emits activity-end", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "tool_execution_end",
				toolCallId: "call-1",
			} as any);

			const endMsg = messages.find((m: any) => m.type === "activity-end");
			assert.ok(endMsg, "activity-end should be emitted");
		});

		test("message_start triggers auto-naming when conditions met", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const mockSession = createSessionMock({ sessionName: null, messages: [] });
			(provider as any).session = mockSession as any;

			let autoNamingTriggered = false;
			const mockListManager = {
				refreshSessionList: async () => {},
				invalidateSessionListCache: () => {},
				autoNamingTriggered: false,
				tryAutoSessionNameFromUserMessage: (_msg: any) => {
					autoNamingTriggered = true;
					return true;
				},
			};
			(provider as any).sessionListManager = mockListManager as any;

			await (provider as any).handleSessionEvent({
				type: "message_start",
				message: { role: "user", content: "Fix bug" },
			} as any);

			assert.ok(
				autoNamingTriggered,
				"auto-naming should be triggered on first user message",
			);
		});

		test("compaction_end success/error/aborted sends correct message", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await (provider as any).handleSessionEvent({
				type: "compaction_end",
			} as any);

			const successStart = messages.find(
				(m: any) =>
					m.type === "activity-start" && m.data.text === "Context compacted ✓",
			);
			assert.ok(successStart, "success compaction should show success text");

			await (provider["handleSessionEvent"]({
				type: "compaction_end",
				errorMessage: "db locked",
			} as any));

			const errorStart = messages.find(
				(m: any) =>
					m.type === "activity-start" &&
					m.data.text.includes("Compaction error"),
			);
			assert.ok(errorStart, "error compaction should show error text");

			await (provider["handleSessionEvent"]({
				type: "compaction_end",
				aborted: true,
			} as any));

			const abortedStart = messages.find(
				(m: any) =>
					m.type === "activity-start" && m.data.text === "Compaction aborted",
			);
			assert.ok(abortedStart, "aborted compaction should show aborted text");
		});
	});

	suite("dispose", () => {
		test("stops footer manager without session", () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const stopCalls: string[] = [];
			(provider as any).footerManager = {
				start: () => {},
				stop: () => { stopCalls.push("stop"); },
				sendFooterData: () => {},
				dispose: () => {},
			} as any;

			provider.dispose();
			assert.ok(stopCalls.includes("stop"), "footerManager.stop should be called");
		});
	});

	suite("cycleModel", () => {
		test("sets next model when models available", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).availableModels = [
				{ id: "p/m1", provider: "p", name: "M1" },
				{ id: "p/m2", provider: "p", name: "M2" },
			];
			(provider as any).currentModelId = "p/m1";

			const setCalls: string[] = [];
			provider["setModel"] = async (modelId: string) => {
				setCalls.push(modelId);
			};

			await provider["cycleModel"]();
			assert.strictEqual(setCalls[0], "p/m2", "should cycle to next model");
		});

		test("returns early when no models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).availableModels = [];
			(provider as any).currentModelId = null;

			const setCalls: string[] = [];
			provider["setModel"] = async (modelId: string) => {
				setCalls.push(modelId);
			};

			await provider["cycleModel"]();
			assert.ok(
				setCalls.length === 0,
				"setModel should not be called when no models",
			);
		});
	});

	suite("cycleThinkingLevel", () => {
		test("cycles through thinking levels", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const setCalls: string[] = [];
			provider["setThinkingLevel"] = async (level: string) => {
				setCalls.push(level);
			};

			await provider["cycleThinkingLevel"]();
			assert.ok(setCalls.length > 0, "setThinkingLevel should be called");
		});
	});

	suite("updateConfig", () => {
		test("updates config object", () => {
			const provider = buildProvider();
			const newConfig = createTestConfig({ defaultModel: "anthropic/claude-3" });
			provider["updateConfig"](newConfig);

			assert.strictEqual((provider as any).config.defaultModel, "anthropic/claude-3");
		});
	});

	suite("sendUpdatesToWebview", () => {
		test("sends updates-available when version or packages present", () => {
			const provider = buildProvider();
			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			provider["sendUpdatesToWebview"]("0.2.0", 3);
			const updateMsg = messages.find((m: any) => m.type === "updates-available");
			assert.ok(updateMsg);
			assert.strictEqual(updateMsg.data.piVersion, "0.2.0");
			assert.strictEqual(updateMsg.data.packageCount, 3);
		});

		test("sends updates-cleared when no version and no packages", () => {
			const provider = buildProvider();
			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			provider["sendUpdatesToWebview"](null, 0);
			const clearedMsg = messages.find((m: any) => m.type === "updates-cleared");
			assert.ok(clearedMsg, "updates-cleared should be sent");
		});
	});

	suite("getSettings / setToolConfig / getExtensionVersion / getThinkingLevel", () => {
		test("returns settings from config", async () => {
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "toolPreset") return "custom";
					if (key === "customTools") return ["bash", "edit"];
					return def;
				},
				update: async () => {},
			});

			const provider = buildProvider();
			const settings = await provider["getSettings"]();
			assert.strictEqual(settings.toolPreset, "custom");
			assert.deepStrictEqual(settings.customTools, ["bash", "edit"]);
		});

		test("gets thinking level from settings manager or config", () => {
			const provider = buildProvider();
			(provider as any).settingsManager = {
				getDefaultThinkingLevel: () => "high",
			} as any;

			assert.strictEqual(provider["getThinkingLevel"](), "high");

			(provider as any).settingsManager = {
				getDefaultThinkingLevel: () => null,
			} as any;
			assert.strictEqual(provider["getThinkingLevel"](), "medium");
		});
	});

	suite("forkSession", () => {
		test("navigates tree when session exists", async () => {
			const provider = buildProvider();
			const navigateCalls: string[] = [];
			const mockSession = createSessionMock({
				sessionId: "session-1",
			});
			(mockSession as any).navigateTree = (nodeId: string) => {
				navigateCalls.push(nodeId);
			};
			(provider as any).session = mockSession as any;
			(provider as any)._onDidChangeTreeData = { fire: () => {} } as any;

			await provider["forkSession"]("node-1");
			assert.ok(navigateCalls.includes("node-1"), "navigateTree should be called");
		});
	});

	suite("setSessionName", () => {
		test("sets name on current session", () => {
			const provider = buildProvider();
			const setCalls: string[] = [];
			const mockSession = createSessionMock({ sessionId: "s1" });
			(mockSession as any).setSessionName = (name: string) => {
				setCalls.push(name);
			};
			(provider as any).session = mockSession as any;

			provider["setSessionName"]("new-name");
			assert.strictEqual(setCalls[0], "new-name");
		});
	});

	suite("getSettingsManager", () => {
		test("returns settingsManager", () => {
			const provider = buildProvider();
			(provider as any).settingsManager = { foo: "bar" } as any;
			assert.strictEqual((provider as any).settingsManager, provider["getSettingsManager"]());
		});

		test("returns undefined when not set", () => {
			const provider = buildProvider();
			assert.strictEqual(provider["getSettingsManager"](), undefined);
		});
	});

	suite("dispose - edge cases", () => {
		test("dispose without session completes without error", () => {
			const provider = buildProvider();
			(provider as any).session = undefined;
			(provider as any).extensionUIContext = {
				stopStatusPoller: () => {},
			} as any;
			(provider as any).footerManager = {
				stop: () => {},
				dispose: () => {},
			} as any;
			(provider as any).voiceManager = {
				dispose: () => {},
			} as any;
			(provider as any)._onDidChangeTreeData = {
				dispose: () => {},
			} as any;

			assert.doesNotThrow(() => provider.dispose());
		});
	});

	suite("getProjectContext / sendSessionStats", () => {
		test("getProjectContext delegates to sessionResources", async () => {
			const provider = buildProvider();
			(provider as any).sessionResources = {
				getProjectContext: async () => "project context",
			} as any;

			const ctx = await (provider as any).getProjectContext();
			assert.strictEqual(ctx, "project context");
		});

		test("sendSessionStats sends data when stats available", () => {
			const provider = buildProvider();
			(provider as any).getSessionStats = () => ({ tokens: 42 });
			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			(provider as any).sendSessionStats();
			const statsMsg = messages.find((m: any) => m.type === "session-stats");
			assert.ok(statsMsg);
			assert.strictEqual(statsMsg.data.tokens, 42);
		});

		test("sendSessionStats does nothing when stats null", () => {
			const provider = buildProvider();
			(provider as any).getSessionStats = () => null;
			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			(provider as any).sendSessionStats();
			assert.ok(
				!messages.some((m: any) => m.type === "session-stats"),
				"should not send session-stats when null",
			);
		});
	});

	suite("hasSession getter", () => {
		test("returns false when no session", () => {
			const provider = buildProvider();
			assert.strictEqual(provider.hasSession, false);
		});

		test("returns true when session exists", () => {
			const provider = buildProvider();
			(provider as any).session = createSessionMock({ sessionId: "s1" }) as any;
			assert.strictEqual(provider.hasSession, true);
		});
	});

	suite("resolveFileMentions private", () => {
		test("delegates to sessionResources", async () => {
			const provider = buildProvider();
			(provider as any).sessionResources = {
				resolveFileMentions: async (text: string) =>
					text.replace("@file:", "/resolved/path"),
			} as any;

			const result = await (provider as any).resolveFileMentions("@file:/fake/file.ts hello");
			assert.ok(result.includes("/resolved/path"));
		});
	});
});
