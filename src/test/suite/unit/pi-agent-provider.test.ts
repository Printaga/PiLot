import * as assert from "node:assert";
import * as vscode from "vscode";
import {
	SessionManager,
	DefaultResourceLoader,
	type SessionManager as SessionManagerType,
} from "@earendil-works/pi-coding-agent";

import {
	PiAgentProvider,
	type PiAgentConfig,
	piAgentProviderInternals,
} from "../../../pi-agent-provider.js";
import { MessageHandler } from "../../../message-handler.js";
import { installConfigListener } from "../../../extension.js";
import { ModelRegistryHandler } from "../../../model-registry-handler.js";
import { PackageManager } from "../../../package-manager.js";
import { SessionListManager } from "../../../session-manager.js";
import { SessionResources } from "../../../session-resources.js";
import { createSessionMock, createResourceLoaderMock } from "../../mocks/session-mock.js";
import {
	createMockMemento,
	createMockBinaryService,
	createMockModelRegistry,
	createMockModelRuntime,
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
			postMessage: () => Promise.resolve(),
			options: {},
			asWebviewUri: (uri: vscode.Uri) => uri,
			html: "",
			onDidReceiveMessage: () => ({ dispose: () => {} }),
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

let savedCreateAgentSession: typeof piAgentProviderInternals.createAgentSession | undefined;
let savedGetAgentDir: typeof piAgentProviderInternals.getAgentDir | undefined;
let savedCreateModelRuntime: typeof piAgentProviderInternals.createModelRuntime | undefined;
let savedCreateModelRegistry: typeof piAgentProviderInternals.createModelRegistry | undefined;
let savedCreateSettingsManager: typeof piAgentProviderInternals.createSettingsManager | undefined;
let savedCreateSessionManager: typeof piAgentProviderInternals.createSessionManager | undefined;

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
	savedCreateModelRuntime = piAgentProviderInternals.createModelRuntime;
	piAgentProviderInternals.createModelRuntime = (async () => createMockModelRuntime()) as any;
	savedCreateModelRegistry = piAgentProviderInternals.createModelRegistry;
	piAgentProviderInternals.createModelRegistry = () => createMockModelRegistry();
	savedCreateSettingsManager = piAgentProviderInternals.createSettingsManager;
	piAgentProviderInternals.createSettingsManager = () => createMockSettingsManager();
	savedCreateSessionManager = piAgentProviderInternals.createSessionManager;
	piAgentProviderInternals.createSessionManager = () => ({}) as SessionManagerType;
}

function restorePiSdkMocks() {
	if (savedCreateAgentSession !== undefined) {
		piAgentProviderInternals.createAgentSession = savedCreateAgentSession;
	}
	if (savedGetAgentDir !== undefined) {
		piAgentProviderInternals.getAgentDir = savedGetAgentDir;
	}
	if (savedCreateModelRuntime !== undefined) {
		piAgentProviderInternals.createModelRuntime = savedCreateModelRuntime;
	}
	if (savedCreateModelRegistry !== undefined) {
		piAgentProviderInternals.createModelRegistry = savedCreateModelRegistry;
	}
	if (savedCreateSettingsManager !== undefined) {
		piAgentProviderInternals.createSettingsManager = savedCreateSettingsManager;
	}
	if (savedCreateSessionManager !== undefined) {
		piAgentProviderInternals.createSessionManager = savedCreateSessionManager;
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

	// Install the binary seam before resolveWebviewView() starts its
	// constructor-triggered background initialize(). The helper's tests do not
	// exercise real binary discovery; allowing it to run here leaks child
	// processes and native filesystem work across the suite.
	const mockBinary = createMockBinaryService({
		getCliVersion: async () => "0.1.0",
	});
	(provider as any).binaryService = {
		...mockBinary,
		resolveAtStartup: () => {},
		prependToPath: () => {},
		isBinaryAvailable: () => true,
	} as any;
	// Tests install the provider's view and dependencies below; do not call
	// resolveWebviewView(), whose fire-and-forget initialize() would start real
	// SDK work before the fixture has finished installing its mocks.
	(provider as any).modelRuntime = createMockModelRuntime();
	(provider as any).modelRegistry = createMockModelRegistry();
	(provider as any).sessionManager = createMockSessionManager(options.cwd || "/fake/workspace");
	(provider as any).settingsManager = createMockSettingsManager();
	(provider as any).modelRegistryHandler = new ModelRegistryHandler({
		getModelRegistry: () => (provider as any).modelRegistry,
		getModelRuntime: () => (provider as any).modelRuntime,
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
		setSession: (s: any) => {
			(provider as any).session = s;
		},
		getSessionManager: () => (provider as any).sessionManager,
		setSessionManager: (m: any) => {
			(provider as any).sessionManager = m;
		},
		getModelRegistry: () => (provider as any).modelRegistry,
		getModelRuntime: () => (provider as any).modelRuntime,
		getSettingsManager: () => (provider as any).settingsManager,
		notifyWebview: (msg: any) => provider["notifyWebview"](msg),
		logDebug: (..._args: any[]) => {},
		logError: (..._args: any[]) => {},
		onSessionDeleted: async () => {
			await provider["newSession"]();
		},
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
// Tests

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * buildProvider() starts a background initialize(); let it settle before
 * installing test mocks so it cannot stomp them mid-test.
 */
async function settleInitialize(provider: any) {
	for (let i = 0; i < 25 && !provider.isInitialized; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	// Neutralize any later re-initialization.
	provider.initialize = async () => {};
}

/**
 * Like settleInitialize, but deterministically drains the constructor-started
 * background initialize() (whose continuations can stomp dependency mocks at
 * ANY await point mid-test) and then re-asserts those mocks, so tests that
 * span multiple awaits see stable identities (e.g. the same sessionManager
 * across a session rebuild).
 */
async function stabilizeProvider(provider: any) {
	provider.initialize = async () => {};
	// The constructor-started background initialize() mutates dependency
	// fields across real async boundaries (fs-based native-addon checks). Its
	// continuations can stomp test mocks at ANY await point mid-test, so poll
	// until every dependency identity is stable across three consecutive
	// ticks before re-asserting the mocks.
	const snapshot = () => [
		provider.sessionManager,
		provider.modelRuntime,
		provider.modelRegistry,
		provider.settingsManager,
	];
	let prev = snapshot();
	let stableTicks = 0;
	for (let i = 0; i < 300 && stableTicks < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		const cur = snapshot();
		stableTicks = cur.every((v, j) => v === prev[j]) ? stableTicks + 1 : 0;
		prev = cur;
	}
	provider.modelRuntime = createMockModelRuntime();
	provider.modelRegistry = createMockModelRegistry();
	provider.settingsManager = createMockSettingsManager();
	provider.sessionManager = createMockSessionManager("/fake/workspace");
}

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

		test("creates ModelRuntime ModelRegistry SettingsManager SessionManager via PI SDK", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};

			let modelRuntimeFactoryCalls = 0;
			const savedFactory = piAgentProviderInternals.createModelRuntime;
			piAgentProviderInternals.createModelRuntime = (async () => {
				modelRuntimeFactoryCalls++;
				return createMockModelRuntime();
			}) as any;

			try {
				await provider["initialize"]();
				assert.strictEqual((provider as any).isInitialized, true);
				assert.ok((provider as any).modelRuntime, "modelRuntime should be set");
				assert.ok((provider as any).modelRegistry, "modelRegistry should be set");
				assert.ok((provider as any).settingsManager, "settingsManager should be set");
				assert.ok((provider as any).sessionManager, "sessionManager should be set");
				assert.strictEqual(
					modelRuntimeFactoryCalls,
					1,
					"createModelRuntime should be invoked exactly once during initialize()",
				);
			} finally {
				piAgentProviderInternals.createModelRuntime = savedFactory;
			}
		});

		test("initialize() does not call the removed AuthStorage.create() factory", async () => {
			// Regression guard: SDK 0.80 removed the named `AuthStorage`
			// export. PiAgentProvider used to call `AuthStorage.create()`
			// directly, which threw `Cannot read properties of undefined
			// (reading 'create')` when the bundled extension was loaded
			// against the upgraded SDK. This test reproduces the failure
			// mode by simulating the missing export and asserts the new
			// code path never reaches it.
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};

			let authStorageFactoryCalls = 0;
			const savedFactory = (piAgentProviderInternals as any).createAuthStorage;
			(piAgentProviderInternals as any).createAuthStorage = () => {
				authStorageFactoryCalls++;
				throw new TypeError("Cannot read properties of undefined (reading 'create')");
			};

			try {
				await provider["initialize"]();
				assert.strictEqual(
					authStorageFactoryCalls,
					0,
					"initialize() must not invoke the removed AuthStorage.create() factory",
				);
				assert.strictEqual((provider as any).isInitialized, true);
			} finally {
				if (savedFactory === undefined) {
					delete (piAgentProviderInternals as any).createAuthStorage;
				} else {
					(piAgentProviderInternals as any).createAuthStorage = savedFactory;
				}
			}
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
			// initialize() re-creates the settings manager through the internals
			// seam; return the mock so the restore path reads its values.
			const savedCreateSm = piAgentProviderInternals.createSettingsManager;
			piAgentProviderInternals.createSettingsManager = () => mockSettings as any;
			try {
				await provider["initialize"]();
				assert.strictEqual((provider as any).currentModelId, "openai/gpt-4o");
			} finally {
				piAgentProviderInternals.createSettingsManager = savedCreateSm;
			}
		});

		test("on failure restores PATH and shows error", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).binaryService.resolveAtStartup = () => {};
			(provider as any).binaryService.prependToPath = () => {};
			(provider as any).binaryService.isBinaryAvailable = () => true;

			const err = new Error("init boom");
			piAgentProviderInternals.createModelRuntime = (async () => {
				throw err;
			}) as any;

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

		test("lightMode disables all discovery and restricts tools under default preset", async () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "lightMode") return true;
					if (key === "toolPreset") return "default";
					return def;
				},
				update: async () => {},
			});

			const opts = await (provider as any).buildSessionOptions("/fake/workspace");
			const rlOptions = opts.resourceLoader as any;
			assert.strictEqual(rlOptions.noExtensions, true);
			assert.strictEqual(rlOptions.noSkills, true);
			assert.strictEqual(rlOptions.noPromptTemplates, true);
			assert.strictEqual(rlOptions.noContextFiles, true);
			assert.strictEqual(rlOptions.noThemes, true);
			assert.deepStrictEqual(opts.tools, ["read", "bash", "edit", "write"]);
			assert.strictEqual(opts.noTools, undefined);
		});

		test("lightMode keeps explicit tool preset behavior", async () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "lightMode") return true;
					if (key === "toolPreset") return "review";
					return def;
				},
				update: async () => {},
			});

			const opts = await (provider as any).buildSessionOptions("/fake/workspace");
			assert.deepStrictEqual(opts.tools, ["read", "grep", "find", "ls"]);
			assert.strictEqual(opts.noTools, undefined);
		});

		test("lightMode off leaves discovery and tools untouched", async () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "lightMode") return false;
					if (key === "toolPreset") return "default";
					return def;
				},
				update: async () => {},
			});

			const opts = await (provider as any).buildSessionOptions("/fake/workspace");
			const rlOptions = opts.resourceLoader as any;
			assert.strictEqual(rlOptions.noExtensions, false);
			assert.strictEqual(rlOptions.noSkills, false);
			assert.strictEqual(rlOptions.noPromptTemplates, false);
			assert.strictEqual(rlOptions.noContextFiles, false);
			assert.strictEqual(rlOptions.noThemes, false);
			assert.strictEqual(opts.tools, undefined);
		});

		test("resource toggles filter runtime resources but preserve raw skills for the UI", () => {
			const provider = buildProvider();
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "disabledSkills") return ["/skills/disabled/SKILL.md"];
					if (key === "disabledPackages") return ["npm:disabled", "local:user"];
					return def;
				},
				update: async () => {},
			});

			const loader = {
				getSkills: () => ({
					skills: [
						{ name: "active", path: "/skills/active/SKILL.md", sourceInfo: {} },
						{ name: "disabled", path: "/skills/disabled/SKILL.md", sourceInfo: {} },
						{
							name: "package",
							path: "/pkg/SKILL.md",
							sourceInfo: { source: "npm:disabled" },
						},
						{ name: "local", path: "/local/SKILL.md", sourceInfo: { scope: "user" } },
					],
				}),
				getExtensions: () => ({
					extensions: [
						{ path: "active.ts", sourceInfo: {} },
						{ path: "disabled.ts", sourceInfo: { source: "npm:disabled" } },
					],
				}),
				getPrompts: () => ({
					prompts: [
						{ name: "active", sourceInfo: {} },
						{ name: "disabled", sourceInfo: { source: "npm:disabled" } },
					],
				}),
				getThemes: () => ({
					themes: [
						{ name: "active", sourceInfo: {} },
						{ name: "disabled", sourceInfo: { source: "npm:disabled" } },
					],
				}),
			} as any;

			const filtered = (provider as any).applyResourceToggles(loader);
			assert.deepStrictEqual(
				filtered.getSkills().skills.map((skill: any) => skill.name),
				["active"],
			);
			assert.deepStrictEqual(
				filtered.getAllSkills().map((skill: any) => skill.name),
				["active", "disabled", "package", "local"],
			);
			assert.strictEqual(filtered.getExtensions().extensions.length, 1);
			assert.strictEqual(filtered.getPrompts().prompts.length, 1);
			assert.strictEqual(filtered.getThemes().themes.length, 1);
		});
	});

	// ── Light mode live-apply ─────────────────────────────────────────────
	// These tests drive the REAL chain: webview message → setLightMode →
	// config update → extension.ts listener → session rebuild → real
	// DefaultResourceLoader with the light-mode flags, restricted tools,
	// preserved transcript (same session file), and webview re-sync.
	suite("light mode live-apply", () => {
		/**
		 * Install a config store mock and a createAgentSession spy that hands
		 * out a fresh session mock (with the given transcript) per call while
		 * recording every options object it was called with. Registers the REAL
		 * extension.ts config listener against our own emitter so tests can fire
		 * configuration changes the way VS Code does.
		 */
		function installLiveApplyHarness(
			provider: any,
			options: {
				config: Map<string, any>;
				transcript: any[];
			},
		) {
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) =>
					options.config.has(key) ? options.config.get(key) : def,
				update: async (key: string, value: any) => {
					options.config.set(key, value);
				},
			});

			const createCalls: any[] = [];
			piAgentProviderInternals.createAgentSession = (async (opts: any) => {
				createCalls.push(opts);
				return {
					session: createSessionMock({
						resourceLoader: opts.resourceLoader,
						sessionId: "live-apply-session",
						messages: options.transcript,
					}),
					extensionsResult: { statuses: [] },
				};
			}) as any;

			const configEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
			(vscode.workspace as any).onDidChangeConfiguration = configEmitter.event;
			const disposable = installConfigListener(provider);

			// Count reload() on EVERY loader instance — the rebuild constructs a
			// fresh DefaultResourceLoader, so the patch must live on the prototype.
			const savedProtoReload = (DefaultResourceLoader.prototype as any).reload;
			(DefaultResourceLoader.prototype as any).reload = async function () {
				this._reloadCalls = (this._reloadCalls ?? 0) + 1;
				return savedProtoReload.call(this);
			};
			Object.defineProperty(DefaultResourceLoader.prototype, "reloadCalls", {
				get(this: any) {
					return this._reloadCalls ?? 0;
				},
				configurable: true,
			});

			/**
			 * Fire a config change for the given pi-agent key, emulating VS
			 * Code's prefix semantics: a change to `pi-agent.lightMode` makes
			 * both `pi-agent` and `pi-agent.lightMode` queries match.
			 */
			const fireConfigChange = (key: string) => {
				configEmitter.fire({
					affectsConfiguration: (section: string) =>
						section === "pi-agent" || section.startsWith(`pi-agent.${key}`),
				} as vscode.ConfigurationChangeEvent);
			};

			/** Wait until the listener's async rebuild has created a new session. */
			const waitForRebuild = async (min = 2) => {
				for (let i = 0; i < 500 && createCalls.length < min; i++) {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
			};

			/**
			 * Surface silent failures: the provider swallows restart errors and
			 * reports them via showErrorMessage — capture them for assertions.
			 */
			const errorToasts: string[] = [];
			(vscode.window as any).showErrorMessage = async (msg: string) => {
				errorToasts.push(msg);
				return undefined;
			};

			return {
				createCalls,
				fireConfigChange,
				waitForRebuild,
				errorToasts,
				dispose: () => {
					disposable.dispose();
					(DefaultResourceLoader.prototype as any).reload = savedProtoReload;
					delete (DefaultResourceLoader.prototype as any).reloadCalls;
				},
			};
		}

		function captureWebviewPosts(provider: any): any[] {
			const posted: any[] = [];
			(provider._webview as any).postMessage = (msg: any) => {
				posted.push(msg);
				return Promise.resolve();
			};
			return posted;
		}

		test("webview setLightMode rebuilds session with no* flags, restricted tools, preserved transcript", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);
			const handler = new MessageHandler(provider);

			// Light mode starts OFF; tool preset untouched ("default").
			const config = new Map<string, any>([
				["lightMode", false],
				["toolPreset", "default"],
			]);
			const transcript = [
				{ role: "user", content: "before the toggle" },
				{ role: "assistant", content: "kept across restart" },
			];
			const harness = installLiveApplyHarness(provider, {
				config,
				transcript,
			});
			const createCalls = harness.createCalls;

			await provider.createSession();
			assert.ok(provider.session, "initial session should exist");

			// The first session must be torn down (disposed) by the rebuild.
			let disposed = 0;
			const originalDispose = provider.session.dispose.bind(provider.session);
			provider.session.dispose = () => {
				disposed++;
				originalDispose();
			};

			const posted = captureWebviewPosts(provider);

			// Flip the toggle the way the webview does. `setLightMode` only
			// persists the setting — the config listener (same as in the real
			// extension) performs the rebuild.
			await handler.handle({
				type: "setLightMode",
				data: { enabled: true },
			});
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild();

			assert.deepStrictEqual(
				harness.errorToasts,
				[],
				`rebuild surfaced error toasts: ${harness.errorToasts.join(" | ")}`,
			);

			// setLightMode persisted the config change…
			assert.strictEqual(config.get("lightMode"), true);

			// …the listener rebuilt the session…
			assert.ok(
				createCalls.length >= 2,
				`expected a session rebuild, got ${createCalls.length} createAgentSession calls`,
			);
			assert.strictEqual(disposed, 1, "old session should be disposed once");

			// …the rebuilt loader is a NEW real loader carrying the light-mode
			// flags (fixed at construction — hence the rebuild) and was reloaded…
			const secondOpts = createCalls[1];
			const rl2: any = secondOpts.resourceLoader;
			assert.notStrictEqual(
				rl2,
				createCalls[0].resourceLoader,
				"expected a fresh resource loader instance",
			);
			assert.strictEqual(rl2.noSkills, true);
			assert.strictEqual(rl2.noExtensions, true);
			assert.strictEqual(rl2.noPromptTemplates, true);
			assert.strictEqual(rl2.noContextFiles, true);
			assert.strictEqual(rl2.noThemes, true);
			assert.strictEqual(rl2.reloadCalls, 1, "rebuilt loader should have reload()ed once");

			// …tools restricted to read,bash,edit,write under the default preset…
			assert.deepStrictEqual(secondOpts.tools, ["read", "bash", "edit", "write"]);

			// …the transcript survived via the SAME session file (the rebuilt
			// session reuses the provider's sessionManager)…
			assert.strictEqual(provider.session.sessionId, "live-apply-session");
			assert.strictEqual(
				createCalls[1].sessionManager,
				createCalls[0].sessionManager,
				"rebuild must reuse the same session file (sessionManager)",
			);

			// …and the webview was re-synced with history + the light-mode state.
			const history = posted.find((m) => m.type === "session-history");
			assert.ok(history, "expected session-history re-sync after rebuild");
			assert.strictEqual(history.data.messages.length, 2);
			assert.ok(
				history.data.messages.some((m: any) => m.content === "before the toggle"),
				"pre-toggle user message must survive the rebuild",
			);
			const lm = posted.find((m) => m.type === "light-mode-changed");
			assert.ok(lm, "expected light-mode-changed notification");
			assert.strictEqual(lm.data.enabled, true);
			harness.dispose();
		});

		test("toggling light mode off restores discovery and unrestricted default tools", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);
			const handler = new MessageHandler(provider);

			// Light mode starts ON.
			const config = new Map<string, any>([
				["lightMode", true],
				["toolPreset", "default"],
			]);
			const harness = installLiveApplyHarness(provider, {
				config,
				transcript: [{ role: "user", content: "hello" }],
			});
			const createCalls = harness.createCalls;

			await provider.createSession();
			const posted = captureWebviewPosts(provider);

			await handler.handle({
				type: "setLightMode",
				data: { enabled: false },
			});
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild();

			assert.strictEqual(config.get("lightMode"), false);
			assert.ok(
				createCalls.length >= 2,
				"expected a session rebuild when light mode turns off",
			);
			const secondOpts = createCalls[1];
			const rl2: any = secondOpts.resourceLoader;
			assert.strictEqual(rl2.noSkills, false);
			assert.strictEqual(rl2.noExtensions, false);
			assert.strictEqual(rl2.noPromptTemplates, false);
			assert.strictEqual(rl2.noContextFiles, false);
			assert.strictEqual(rl2.noThemes, false);
			assert.strictEqual(
				secondOpts.tools,
				undefined,
				"default preset should not restrict tools",
			);
			assert.strictEqual(secondOpts.noTools, undefined);

			const history = posted.find((m) => m.type === "session-history");
			assert.ok(history, "expected session-history re-sync after rebuild");
			harness.dispose();
		});

		test("direct pi-agent.lightMode config change triggers the rebuild via extension.ts listener", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);

			// Config edited directly in settings UI: lightMode starts off.
			const config = new Map<string, any>([
				["lightMode", false],
				["toolPreset", "default"],
			]);
			const harness = installLiveApplyHarness(provider, {
				config,
				transcript: [{ role: "user", content: "hello" }],
			});

			await provider.createSession();

			// Simulate editing pi-agent.lightMode in the VS Code settings UI,
			// then the platform firing the corresponding change event.
			config.set("lightMode", true);
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild();

			assert.ok(
				harness.createCalls.length >= 2,
				"extension.ts listener should rebuild the session on lightMode change",
			);
			const rl2: any = harness.createCalls[1].resourceLoader;
			assert.strictEqual(rl2.noSkills, true);
			assert.strictEqual(rl2.noExtensions, true);
			assert.strictEqual(rl2.noPromptTemplates, true);
			assert.strictEqual(rl2.noContextFiles, true);
			assert.strictEqual(rl2.noThemes, true);
			assert.deepStrictEqual(harness.createCalls[1].tools, ["read", "bash", "edit", "write"]);
			harness.dispose();
		});

		test("auto context is forced off while light mode is on and the preference is restored on toggle-off", async () => {
			// The user runs with auto context ON; light mode must override it
			// without overwriting the stored preference.
			const provider: any = buildProvider({ autoContext: true });
			await stabilizeProvider(provider);
			const handler = new MessageHandler(provider);

			const config = new Map<string, any>([
				["lightMode", false],
				["toolPreset", "default"],
			]);
			const harness = installLiveApplyHarness(provider, {
				config,
				transcript: [{ role: "user", content: "hello" }],
			});

			await provider.createSession();
			const posted = captureWebviewPosts(provider);

			// Toggle ON: the toggle must snap off and the UI be re-synced.
			await handler.handle({
				type: "setLightMode",
				data: { enabled: true },
			});
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild();

			assert.strictEqual(provider.getAutoContext(), false);
			assert.strictEqual(
				(provider as any).config.autoContext,
				true,
				"the user's auto-context preference must be preserved",
			);
			const acOn = posted.find((m) => m.type === "auto-context-changed");
			assert.ok(acOn, "expected auto-context-changed after enabling light mode");
			assert.strictEqual(
				acOn.data.enabled,
				false,
				"webview must be told auto context is now off",
			);

			// Toggle OFF: the preference comes back automatically.
			await handler.handle({
				type: "setLightMode",
				data: { enabled: false },
			});
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild(3);

			const acMsgs = posted.filter((m) => m.type === "auto-context-changed");
			assert.ok(
				acMsgs.length >= 2,
				"expected auto-context-changed after disabling light mode",
			);
			const last = acMsgs[acMsgs.length - 1];
			assert.strictEqual(
				last.data.enabled,
				true,
				"auto context preference must be restored on toggle-off",
			);
			assert.strictEqual(provider.getAutoContext(), true);

			harness.dispose();
		});

		test("session-resources reports the effective (empty) state while light mode is on", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);

			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => (key === "lightMode" ? true : def),
				update: async () => {},
			});

			// The loader still exposes resources (e.g. from a pre-toggle
			// session); the webview must see the EFFECTIVE light-mode state
			// so the chat context row doesn't list packages as active.
			(provider as any).session = createSessionMock({
				resourceLoader: {
					reload: async () => {},
					getAgentsFiles: () => ({ agentsFiles: [{ path: "/fake/AGENTS.md" }] }),
					getSkills: () => ({
						skills: [
							{
								name: "s1",
								description: "d",
								filePath: "/s/SKILL.md",
								sourceInfo: { origin: "package", source: "npm:foo", scope: "user" },
							},
						],
					}),
					getExtensions: () => ({
						extensions: [{ path: "/e", sourceInfo: { name: "x" } }],
						errors: [],
					}),
					getPrompts: () => ({ prompts: [{ name: "p", description: "" }] }),
				} as any,
			});
			(provider as any).packageManager.listPackages = async () => [
				{ source: "npm:foo", path: "/pkg/foo" },
				{ source: "npm:bar", path: "/pkg/bar" },
			];

			const posted = captureWebviewPosts(provider);
			await provider.sendSessionResources();

			const msg = posted.find((m) => m.type === "session-resources");
			assert.ok(msg, "expected session-resources notification");
			assert.strictEqual(msg.data.packageCount, 0);
			assert.deepStrictEqual(msg.data.packages, []);
			assert.strictEqual(msg.data.skillCount, 0);
			assert.deepStrictEqual(msg.data.skills, []);
			assert.strictEqual(msg.data.extensionCount, 0);
			assert.strictEqual(msg.data.promptCount, 0);
			assert.strictEqual(msg.data.contextFileCount, 0);
		});

		test("skills keep their file paths so the skills list keys stay unique", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);

			// The SDK exposes the skill location as filePath (not path) —
			// dropping it collapses every key to "" and wedges the list.
			(provider as any).session = createSessionMock({
				resourceLoader: {
					reload: async () => {},
					getSkills: () => ({
						skills: [
							{ name: "alpha", description: "a", filePath: "/skills/alpha/SKILL.md" },
							{ name: "beta", description: "b", filePath: "/skills/beta/SKILL.md" },
						],
					}),
				} as any,
			});

			const skills = await provider.getAllSkills();
			assert.strictEqual(skills.length, 2);
			assert.strictEqual(skills[0].path, "/skills/alpha/SKILL.md");
			assert.strictEqual(skills[1].path, "/skills/beta/SKILL.md");
			assert.strictEqual(
				new Set(skills.map((s: any) => s.path)).size,
				2,
				"skill paths must be unique so the Svelte each-key never collides",
			);
		});

		test("restart re-sync marks session-history as restored so the webview keeps its tab", async () => {
			const provider: any = buildProvider();
			await stabilizeProvider(provider);

			const config = new Map<string, any>([
				["lightMode", false],
				["toolPreset", "default"],
			]);
			const harness = installLiveApplyHarness(provider, {
				config,
				transcript: [{ role: "user", content: "hello" }],
			});

			await provider.createSession();
			const posted = captureWebviewPosts(provider);

			config.set("lightMode", true);
			harness.fireConfigChange("lightMode");
			await harness.waitForRebuild();

			const history = posted.find((m) => m.type === "session-history");
			assert.ok(history, "expected session-history re-sync after rebuild");
			assert.strictEqual(
				history.data.restored,
				true,
				"restarted sessions must not yank the webview back to the chat tab",
			);
			harness.dispose();
		});
	});

	suite("createSession", () => {
		test("throws when dependencies missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = undefined;
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
			(provider as any).modelRuntime = createMockModelRuntime();
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
			(provider as any).modelRuntime = createMockModelRuntime();
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
				stop: () => {
					footerStopCalls.push("stop");
				},
				sendFooterData: () => {},
				dispose: () => {},
			} as any;

			const eventCalls: any[] = [];
			(provider as any)._onDidChangeTreeData = {
				fire: () => {
					eventCalls.push("treeData");
				},
			} as any;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			await provider["newSession"]();

			assert.ok(footerStopCalls.includes("stop"), "footerManager.stop should be called");
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
			(provider as any).modelRuntime = createMockModelRuntime();
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
			(provider as any).modelRuntime = createMockModelRuntime();
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
				messages: [{ role: "user", content: "original", timestamp: 1 }],
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
		test("setApiKey calls ModelRuntime.setRuntimeApiKey and refreshes models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const setCalls: any[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async (provider: string, apiKey: string) => {
					setCalls.push({ provider, apiKey });
				},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
			} as any;

			const refreshCalls: any[] = [];
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					refreshCalls.push("refresh");
				},
				getAvailableModels: () => [],
				buildModelList: (m: any) => m,
				getMergedModels: async () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;

			await provider["setApiKey"]("openai", "sk-123");

			assert.ok(
				setCalls.some((c) => c.provider === "openai" && c.apiKey === "sk-123"),
				"ModelRuntime.setRuntimeApiKey should be called with openai/sk-123",
			);
			assert.ok(refreshCalls.includes("refresh"), "refreshAvailableModels should be called");
		});

		test("removeAuth calls ModelRuntime.removeRuntimeApiKey and refreshes models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const removeCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async (provider: string) => {
					removeCalls.push(provider);
				},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
			} as any;

			const refreshCalls: any[] = [];
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					refreshCalls.push("refresh");
				},
				getAvailableModels: () => [],
				buildModelList: (m: any) => m,
				getMergedModels: async () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;

			await provider["removeAuth"]("openai");

			assert.ok(
				removeCalls.includes("openai"),
				"ModelRuntime.removeRuntimeApiKey should be called",
			);
			assert.ok(refreshCalls.includes("refresh"), "refresh should be called");
		});
	});

	suite("provider management (custom providers)", () => {
		test("getProviderAuthData includes custom providers with no models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [{ id: "kilocode" }],
				getRegisteredProviderIds: () => ["kilocode"],
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => (id === "kilocode" ? "Kilo Code" : id),
			} as any;
			// models.json sync read returns the custom provider config
			(provider as any).readModelsJsonConfigSync = () => ({ providers: { kilocode: {} } });

			const data = await provider["getProviderAuthData"]();
			const kc = data.find((p: any) => p.provider === "kilocode");
			assert.ok(kc, "custom provider should appear in the list");
			assert.strictEqual(kc.name, "Kilo Code");
			assert.strictEqual(kc.custom, true);
			assert.strictEqual(kc.configured, false);
		});

		test("getProviderAuthData exposes stored baseUrl/api/models for custom providers", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [{ id: "kilocode" }],
				getRegisteredProviderIds: () => ["kilocode"],
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).readModelsJsonConfig = async () => ({
				providers: {
					kilocode: {
						name: "Kilo Code",
						baseUrl: "https://api.kilocode.ai/v1",
						api: "openai-completions",
						models: [
							{ id: "kilo-large" },
							{ id: "kilo-small", name: "Kilo Small" },
							{ id: 42 },
						],
					},
				},
			});

			const data = await provider["getProviderAuthData"]();
			const kc = data.find((p: any) => p.provider === "kilocode");
			assert.ok(kc, "custom provider should appear in the list");
			assert.strictEqual(kc.baseUrl, "https://api.kilocode.ai/v1");
			assert.strictEqual(kc.api, "openai-completions");
			assert.deepStrictEqual(kc.models, [
				{ id: "kilo-large", name: undefined },
				{ id: "kilo-small", name: "Kilo Small" },
			]);
		});

		suite("fetchProviderModels", () => {
			let originalFetch: typeof globalThis.fetch | undefined;

			setup(() => {
				originalFetch = globalThis.fetch;
			});

			teardown(() => {
				globalThis.fetch = originalFetch!;
			});

			test("queries {baseUrl}/models and maps data[].id", async () => {
				const provider = buildProvider();
				(provider as any).isInitialized = true;
				const calls: any[] = [];
				globalThis.fetch = (async (url: string, init: any) => {
					calls.push({ url, init });
					return {
						ok: true,
						status: 200,
						statusText: "OK",
						json: async () => ({
							data: [{ id: "m1" }, { id: "m2", name: "M2" }, "m3"],
						}),
					};
				}) as any;

				const models = await provider["fetchProviderModels"]({
					baseUrl: "https://api.example.com/v1/",
					apiKey: "secret-key",
				});

				assert.strictEqual(calls.length, 1);
				assert.strictEqual(calls[0].url, "https://api.example.com/v1/models");
				assert.strictEqual(calls[0].init.headers.Authorization, "Bearer secret-key");
				assert.deepStrictEqual(models, [
					{ id: "m1" },
					{ id: "m2", name: "M2" },
					{ id: "m3" },
				]);
			});

			test("throws on HTTP error and on missing baseUrl", async () => {
				const provider = buildProvider();
				(provider as any).isInitialized = true;
				globalThis.fetch = (async () => ({
					ok: false,
					status: 401,
					statusText: "Unauthorized",
				})) as any;
				await assert.rejects(
					provider["fetchProviderModels"]({ baseUrl: "https://x/v1" }),
					/401 Unauthorized/,
				);
				await assert.rejects(
					provider["fetchProviderModels"]({ baseUrl: "  " }),
					/Base URL is required/,
				);
			});
		});

		test("addProvider writes models.json and registers the provider", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const regCalls: any[] = [];
			const reloadCalls: number[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				registerProvider: (id: string, cfg: any) => {
					regCalls.push({ id, cfg });
				},
				unregisterProvider: () => {},
				reloadConfig: async () => {
					reloadCalls.push(1);
				},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({ providers: {} });
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["addProvider"]({
				provider: "kilocode",
				name: "Kilo Code",
				baseUrl: "https://api.kilocode.ai",
			});

			assert.ok(written, "models.json should be written");
			assert.ok(written.providers.kilocode, "provider entry written");
			assert.strictEqual(written.providers.kilocode.name, "Kilo Code");
			assert.strictEqual(written.providers.kilocode.baseUrl, "https://api.kilocode.ai");
			assert.ok(
				regCalls.some((c) => c.id === "kilocode"),
				"registerProvider called",
			);
			assert.strictEqual(reloadCalls.length, 1, "reloadConfig called");
		});

		test("addProvider persists models to models.json and registerProvider", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const regCalls: any[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				registerProvider: (id: string, cfg: any) => {
					regCalls.push({ id, cfg });
				},
				unregisterProvider: () => {},
				reloadConfig: async () => {},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({ providers: {} });
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["addProvider"]({
				provider: "kilocode",
				api: "openai-completions",
				models: [{ id: "kilo-large" }, { id: "kilo-small", name: "Kilo Small" }],
			});

			assert.ok(written, "models.json should be written");
			const entry = written.providers.kilocode;
			assert.ok(entry, "provider entry written");
			assert.strictEqual(entry.api, "openai-completions", "api default applied");
			assert.deepStrictEqual(
				entry.models,
				[{ id: "kilo-large" }, { id: "kilo-small", name: "Kilo Small" }],
				"models written with ids and names",
			);
			const reg = regCalls.find((c) => c.id === "kilocode");
			assert.ok(reg, "registerProvider called");
			assert.deepStrictEqual(
				reg.cfg.models,
				[{ id: "kilo-large" }, { id: "kilo-small", name: "Kilo Small" }],
				"models passed to registerProvider",
			);
		});

		test("addProvider omits models when none provided", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				registerProvider: () => {},
				unregisterProvider: () => {},
				reloadConfig: async () => {},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({ providers: {} });
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["addProvider"]({ provider: "kilocode", apiKey: "x" });

			assert.ok(written, "models.json should be written");
			assert.strictEqual(
				written.providers.kilocode.models,
				undefined,
				"no models key when none provided",
			);
		});

		test("addProvider with empty models array clears stored models", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				registerProvider: () => {},
				unregisterProvider: () => {},
				reloadConfig: async () => {},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			let written: any = null;
			// Existing entry already has models from a previous save.
			(provider as any).readModelsJsonConfig = async () => ({
				providers: { kilocode: { baseUrl: "https://x", models: [{ id: "old" }] } },
			});
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["addProvider"]({ provider: "kilocode", models: [] });

			assert.ok(written, "models.json should be written");
			assert.deepStrictEqual(
				written.providers.kilocode.models,
				[],
				"empty list should replace stored models",
			);
		});

		test("removeProvider deletes models.json entry and unregisters", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const unregCalls: string[] = [];
			const reloadCalls: number[] = [];
			const removeCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async (id: string) => {
					removeCalls.push(id);
				},
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => ["kilocode"],
				registerProvider: () => {},
				unregisterProvider: (id: string) => {
					unregCalls.push(id);
				},
				reloadConfig: async () => {
					reloadCalls.push(1);
				},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({
				providers: { kilocode: { name: "Kilo Code" } },
			});
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["removeProvider"]("kilocode");

			assert.ok(written, "models.json should be written");
			assert.ok(!written.providers.kilocode, "provider entry removed");
			assert.ok(unregCalls.includes("kilocode"), "unregisterProvider called");
			assert.ok(removeCalls.includes("kilocode"), "removeRuntimeApiKey called");
			assert.strictEqual(reloadCalls.length, 1, "reloadConfig called");
		});

		test("addProvider falls back to refresh() when reloadConfig is missing (SDK 0.84+)", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const refreshCalls: number[] = [];
			// SDK 0.84 removed ModelRuntime.reloadConfig(); refresh() now reloads models.json.
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				refresh: async () => {
					refreshCalls.push(1);
				},
				registerProvider: () => {},
				unregisterProvider: () => {},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				invalidateCliModelIdsCache: () => {},
				getAvailableModels: () => [],
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({ providers: {} });
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["addProvider"]({
				provider: "kilocode",
				name: "Kilo Code",
				baseUrl: "https://api.kilocode.ai",
			});

			assert.ok(written?.providers?.kilocode, "models.json should be written");
			assert.strictEqual(
				refreshCalls.length,
				2,
				"refresh() used as reloadConfig replacement, then again by refreshModels()",
			);
		});

		test("removeProvider falls back to refresh() when reloadConfig is missing (SDK 0.84+)", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const refreshCalls: number[] = [];
			const unregCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => ["kilocode"],
				refresh: async () => {
					refreshCalls.push(1);
				},
				registerProvider: () => {},
				unregisterProvider: (id: string) => {
					unregCalls.push(id);
				},
				isUsingOAuth: () => false,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				invalidateCliModelIdsCache: () => {},
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
			} as any;
			let written: any = null;
			(provider as any).readModelsJsonConfig = async () => ({
				providers: { kilocode: { name: "Kilo Code" } },
			});
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			(provider as any).writeModelsJsonConfig = async (cfg: any) => {
				written = cfg;
			};

			await provider["removeProvider"]("kilocode");

			assert.ok(!written.providers.kilocode, "provider entry removed");
			assert.ok(unregCalls.includes("kilocode"), "unregisterProvider called");
			assert.strictEqual(
				refreshCalls.length,
				2,
				"refresh() used as reloadConfig replacement, then again by refreshModels()",
			);
		});

		test("addProvider throws when provider ID is empty", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = createMockModelRuntime();
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
			} as any;
			let threw = false;
			try {
				await provider["addProvider"]({ provider: "  " });
			} catch {
				threw = true;
			}
			assert.ok(threw, "addProvider should reject an empty provider ID");
		});

		test("addProvider rejects built-in provider IDs", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [{ id: "openai" }],
				getRegisteredProviderIds: () => [],
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
			} as any;
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			let threw = false;
			let message = "";
			try {
				await provider["addProvider"]({ provider: "openai" });
			} catch (e) {
				threw = true;
				message = e instanceof Error ? e.message : String(e);
			}
			assert.ok(threw, "addProvider should reject a built-in provider ID");
			assert.match(message, /built-in/i);
		});

		test("removeProvider rejects built-in provider IDs", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				registerProvider: () => {},
				unregisterProvider: () => {},
				reloadConfig: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
			} as any;
			(provider as any).readModelsJsonConfigSync = () => ({ providers: {} });
			let threw = false;
			let message = "";
			try {
				await provider["removeProvider"]("openai");
			} catch (e) {
				threw = true;
				message = e instanceof Error ? e.message : String(e);
			}
			assert.ok(threw, "removeProvider should reject a built-in provider ID");
			assert.match(message, /built-in/i);
		});
	});

	suite("refreshModels + handleExternalConfigChange", () => {
		test("refreshModels calls ModelRuntime.refresh before refreshing models", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const refreshCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				refresh: async () => {
					refreshCalls.push("refresh");
					return {};
				},
			} as any;

			const modelRefreshCalls: any[] = [];
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					modelRefreshCalls.push("refresh");
				},
				invalidateCliModelIdsCache: () => {},
				getMergedModels: async () => [],
				getAvailableModels: async () => [],
				getProviderAuthData: async () => [],
			} as any;

			await provider["refreshModels"]();

			assert.ok(
				refreshCalls.length === 1,
				"ModelRuntime.refresh should be called exactly once",
			);
			assert.ok(
				modelRefreshCalls.includes("refresh"),
				"refreshAvailableModels should be called",
			);
		});

		test("handleExternalConfigChange on auth.json calls ModelRuntime.refresh", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const refreshCalls: string[] = [];
			const invalidateCalls: string[] = [];
			const modelRefreshCalls: string[] = [];

			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				refresh: async () => {
					refreshCalls.push("refresh");
					return {};
				},
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					modelRefreshCalls.push("refresh");
				},
				invalidateCliModelIdsCache: () => {
					invalidateCalls.push("inv");
				},
				getMergedModels: async () => [],
				getAvailableModels: async () => [],
				getProviderAuthData: async () => [],
			} as any;

			await provider["handleExternalConfigChange"]("auth.json");

			assert.ok(
				refreshCalls.length === 1,
				"ModelRuntime.refresh should be called exactly once",
			);
			assert.ok(invalidateCalls.length === 1, "CLI model ids cache should be invalidated");
			assert.ok(
				modelRefreshCalls.length === 1,
				"refreshAvailableModels should be called exactly once",
			);
		});

		test("handleExternalConfigChange on models.json does NOT call ModelRuntime.refresh", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const refreshCalls: string[] = [];
			const modelRefreshCalls: string[] = [];

			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				refresh: async () => {
					refreshCalls.push("refresh");
					return {};
				},
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					modelRefreshCalls.push("refresh");
				},
				invalidateCliModelIdsCache: () => {},
				getMergedModels: async () => [],
				getAvailableModels: async () => [],
				getProviderAuthData: async () => [],
			} as any;

			await provider["handleExternalConfigChange"]("models.json");

			assert.ok(
				refreshCalls.length === 0,
				"ModelRuntime.refresh should NOT be called for models.json changes",
			);
			assert.ok(modelRefreshCalls.length === 1, "refreshAvailableModels should still run");
		});

		test("rapid auth.json changes coalesce into a single refresh+refreshAvailable", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const refreshCalls: string[] = [];
			const modelRefreshCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
				refresh: async () => {
					refreshCalls.push("refresh");
					return {};
				},
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {
					modelRefreshCalls.push("refresh");
				},
				invalidateCliModelIdsCache: () => {},
				getMergedModels: async () => [],
				getAvailableModels: async () => [],
				getProviderAuthData: async () => [],
			} as any;

			// Fire several handler calls in the same tick — representing one
			// atomic-rename save emitting 2-3 fs.watch events back-to-back.
			const p1 = provider["handleExternalConfigChange"]("auth.json");
			const p2 = provider["handleExternalConfigChange"]("auth.json");
			const p3 = provider["handleExternalConfigChange"]("auth.json");
			await Promise.all([p1, p2, p3]);

			assert.strictEqual(
				refreshCalls.length,
				1,
				"ModelRuntime.refresh should be called exactly once after debounce coalesces",
			);
			assert.strictEqual(
				modelRefreshCalls.length,
				1,
				"refreshAvailableModels should be called exactly once after debounce coalesces",
			);
		});
	});

	suite("openConfigFile", () => {
		/**
		 * Stub the fs/vscode seams openConfigFile uses. `exists` controls
		 * existsFile, `infoChoice` the dialog answer. Returns recorded calls
		 * and a restore function.
		 */
		function stubOpenConfig(opts: { exists?: boolean; infoChoice?: string } = {}) {
			const calls = {
				writes: [] as Array<{ p: string; content: string }>,
				opened: [] as string[],
				prompts: 0,
			};
			const saved = {
				exists: piAgentProviderInternals.existsFile,
				mkdir: piAgentProviderInternals.mkdir,
				write: piAgentProviderInternals.writeFile,
				open: vscode.workspace.openTextDocument,
				show: vscode.window.showTextDocument,
				info: vscode.window.showInformationMessage,
			};
			piAgentProviderInternals.existsFile = () => opts.exists ?? false;
			piAgentProviderInternals.mkdir = async () => undefined;
			piAgentProviderInternals.writeFile = async (p: string, content: string, o: any) => {
				assert.strictEqual(o.flag, "wx");
				calls.writes.push({ p, content });
			};
			vscode.workspace.openTextDocument = async (uri: any) => {
				calls.opened.push(uri.fsPath);
				return {} as any;
			};
			vscode.window.showTextDocument = (async () => {}) as any;
			(vscode.window as any).showInformationMessage = async () => {
				calls.prompts++;
				return opts.infoChoice;
			};
			return {
				calls,
				restore() {
					piAgentProviderInternals.existsFile = saved.exists;
					piAgentProviderInternals.mkdir = saved.mkdir;
					piAgentProviderInternals.writeFile = saved.write;
					vscode.workspace.openTextDocument = saved.open;
					vscode.window.showTextDocument = saved.show;
					vscode.window.showInformationMessage = saved.info;
				},
			};
		}

		function buildInitializedProvider() {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			return provider;
		}

		test("creates missing file with {} and opens document", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig();
			try {
				await provider["openConfigFile"]("models");
				assert.strictEqual(calls.writes.length, 1, "writeFile called once");
				assert.strictEqual(calls.writes[0].content, "{}");
				assert.ok(calls.writes[0].p.endsWith("models.json"));
				assert.ok(calls.opened[0].endsWith("models.json"), "opens models.json");
			} finally {
				restore();
			}
		});

		test("does not overwrite an existing file (EEXIST ignored)", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig();
			piAgentProviderInternals.writeFile = async () => {
				const err: any = new Error("exists");
				err.code = "EEXIST";
				throw err;
			};
			try {
				await provider["openConfigFile"]("settings");
				// EEXIST was swallowed: the flow continued to open the document.
				assert.strictEqual(calls.opened.length, 1);
			} finally {
				restore();
			}
		});

		test("maps system-prompt to SYSTEM.md after confirmation", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig({ infoChoice: "Create" });
			try {
				await provider["openConfigFile"]("system-prompt");
				assert.strictEqual(calls.prompts, 1, "warns before creating SYSTEM.md");
				assert.strictEqual(calls.writes.length, 1);
				assert.strictEqual(calls.writes[0].content, "");
				assert.ok(calls.writes[0].p.endsWith("SYSTEM.md"));
				assert.ok(calls.opened[0].endsWith("SYSTEM.md"), "opens SYSTEM.md");
			} finally {
				restore();
			}
		});

		test("cancelling the SYSTEM.md prompt creates nothing and opens nothing", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig({ infoChoice: undefined });
			try {
				await provider["openConfigFile"]("system-prompt");
				assert.strictEqual(calls.writes.length, 0, "no file created");
				assert.strictEqual(calls.opened.length, 0, "no document opened");
			} finally {
				restore();
			}
		});

		test("existing SYSTEM.md opens without prompting", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig({ exists: true, infoChoice: "Create" });
			try {
				await provider["openConfigFile"]("system-prompt");
				assert.strictEqual(calls.prompts, 0, "no prompt for existing file");
				assert.strictEqual(calls.writes.length, 0, "not rewritten");
				assert.ok(calls.opened[0].endsWith("SYSTEM.md"), "opens SYSTEM.md");
			} finally {
				restore();
			}
		});

		test("maps append-system-prompt to APPEND_SYSTEM.md", async () => {
			const provider = buildInitializedProvider();
			const { calls, restore } = stubOpenConfig();
			try {
				await provider["openConfigFile"]("append-system-prompt");
				assert.strictEqual(calls.writes.length, 1);
				assert.strictEqual(calls.writes[0].content, "");
				assert.ok(calls.writes[0].p.endsWith("APPEND_SYSTEM.md"));
				assert.ok(calls.opened[0].endsWith("APPEND_SYSTEM.md"));
			} finally {
				restore();
			}
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

		test("surfaces delete failures instead of silently succeeding", async () => {
			const provider = buildProvider();
			const originalListSessions = piAgentProviderInternals.listSessions;
			const originalUnlinkFile = piAgentProviderInternals.unlinkFile;
			const mockSession = createSessionMock({ sessionId: "session-1" });
			(provider as any).session = mockSession as any;

			let refreshed = false;
			let createdReplacementSession = false;
			(provider as any).sessionListManager = {
				refreshSessionList: async () => {
					refreshed = true;
				},
			} as any;
			(provider as any).newSession = async () => {
				createdReplacementSession = true;
			};

			const errorCalls: string[] = [];
			(vscode.window.showErrorMessage as any) = async (msg: string) => {
				errorCalls.push(msg);
				return "Mock";
			};

			piAgentProviderInternals.listSessions = (async () => [
				{ id: "session-1", path: "/fake/.pi/sessions/session-1.jsonl" },
			]) as any;
			piAgentProviderInternals.unlinkFile = async () => {
				throw new Error("permission denied");
			};

			try {
				await provider["deleteSessions"](["session-1"]);
				assert.fail("expected deleteSessions to throw");
			} catch (error) {
				assert.match(String(error), /Failed to delete sessions: session-1/);
			} finally {
				piAgentProviderInternals.listSessions = originalListSessions;
				piAgentProviderInternals.unlinkFile = originalUnlinkFile;
			}

			assert.strictEqual(createdReplacementSession, false);
			assert.strictEqual((provider as any).session, mockSession);
			assert.strictEqual(refreshed, true);
			assert.ok(errorCalls.some((msg) => msg.includes("session-1")));
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
			(provider as any).session = createSessionMock();

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
			(provider as any).session = createSessionMock({
				sessionName: "new name",
			}) as any;

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
			const mockSession = createSessionMock({
				sessionName: null,
				messages: [],
			});
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

			assert.ok(autoNamingTriggered, "auto-naming should be triggered on first user message");
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
				(m: any) => m.type === "activity-start" && m.data.text === "Context compacted ✓",
			);
			assert.ok(successStart, "success compaction should show success text");

			await provider["handleSessionEvent"]({
				type: "compaction_end",
				errorMessage: "db locked",
			} as any);

			const errorStart = messages.find(
				(m: any) => m.type === "activity-start" && m.data.text.includes("Compaction error"),
			);
			assert.ok(errorStart, "error compaction should show error text");

			await provider["handleSessionEvent"]({
				type: "compaction_end",
				aborted: true,
			} as any);

			const abortedStart = messages.find(
				(m: any) => m.type === "activity-start" && m.data.text === "Compaction aborted",
			);
			assert.ok(abortedStart, "aborted compaction should show aborted text");
		});

		test("re-sends session-history on agent_end (non-retry) so messages get entryId", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).session = createSessionMock({
				sessionId: "session-1",
			}) as any;

			const serialized: any[] = [
				{ role: "user", content: "hi", entryId: "entry-1", timestamp: 100 },
			];
			(provider as any).getSerializedSessionMessages = () => serialized;

			const messages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				messages.push(msg);
			};

			// Should send session-history on agent_end without retry
			await (provider as any).handleSessionEvent({
				type: "agent_end",
				willRetry: false,
			} as any);

			const historyMsg = messages.find((m: any) => m.type === "session-history");
			assert.ok(historyMsg, "session-history should be sent on agent_end (non-retry)");
			assert.strictEqual(historyMsg?.data?.sessionId, "session-1");
			assert.strictEqual(
				historyMsg?.data?.messages?.[0]?.entryId,
				"entry-1",
				"messages should carry entryId from path entries",
			);

			// Should NOT send session-history on agent_end with willRetry
			messages.length = 0;
			await (provider as any).handleSessionEvent({
				type: "agent_end",
				willRetry: true,
			} as any);
			const retryHistory = messages.find((m: any) => m.type === "session-history");
			assert.ok(
				!retryHistory,
				"session-history should NOT be sent on agent_end with willRetry",
			);

			// Should NOT send session-history when session is null
			messages.length = 0;
			(provider as any).session = null;
			await (provider as any).handleSessionEvent({
				type: "agent_end",
				willRetry: false,
			} as any);
			const noSessionHistory = messages.find((m: any) => m.type === "session-history");
			assert.ok(!noSessionHistory, "session-history should NOT be sent when session is null");
		});

		test("getSerializedSessionMessages uses sessionManager.getBranch for entryId", () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const session = createSessionMock({
				sessionId: "session-1",
			}) as any;
			// Path entries carry entryId; raw session.messages do not.
			session.sessionManager.getBranch = () => [
				{
					type: "message",
					id: "entry-1",
					parentId: null,
					timestamp: "2024-01-01T00:00:00Z",
					message: { role: "user", content: "hi" },
				},
			];
			session.sessionManager.getPath = undefined;
			session.messages = [{ role: "user", content: "hi" }];
			(provider as any).session = session;

			const result = (provider as any).getSerializedSessionMessages(session);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(
				result[0].entryId,
				"entry-1",
				"path entries should yield entryId for fork support",
			);
		});

		test("getSerializedSessionMessages falls back to session.messages when getBranch is missing", () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const session = createSessionMock({
				sessionId: "session-1",
			}) as any;
			session.sessionManager.getBranch = undefined;
			session.sessionManager.getPath = undefined;
			session.messages = [{ role: "user", content: "hi" }];
			(provider as any).session = session;

			const result = (provider as any).getSerializedSessionMessages(session);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(
				result[0].entryId,
				undefined,
				"raw messages have no entryId; this is the degraded fallback",
			);
		});
	});

	suite("dispose", () => {
		test("stops footer manager without session", () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;

			const stopCalls: string[] = [];
			(provider as any).footerManager = {
				start: () => {},
				stop: () => {
					stopCalls.push("stop");
				},
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
			assert.ok(setCalls.length === 0, "setModel should not be called when no models");
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
			const newConfig = createTestConfig({
				defaultModel: "anthropic/claude-3",
			});
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

	suite("commit-message model setting", () => {
		test("reports the standard model when the setting is empty", () => {
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "git.commitMessageModel") return "";
					return def;
				},
				update: async () => {},
			});

			assert.strictEqual(buildProvider().getCommitMessageModel(), "");
		});

		test("returns the pinned model, ignoring surrounding whitespace", () => {
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (key: string, def: any) => {
					if (key === "git.commitMessageModel") return "  anthropic/claude-haiku-4-5  ";
					return def;
				},
				update: async () => {},
			});

			assert.strictEqual(
				buildProvider().getCommitMessageModel(),
				"anthropic/claude-haiku-4-5",
			);
		});

		test("persists the chosen model globally", async () => {
			const writes: Array<{ key: string; value: unknown }> = [];
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (_key: string, def: any) => def,
				update: async (key: string, value: unknown) => {
					writes.push({ key, value });
				},
			});

			await buildProvider().setCommitMessageModel("anthropic/claude-haiku-4-5");

			assert.deepStrictEqual(writes, [
				{ key: "git.commitMessageModel", value: "anthropic/claude-haiku-4-5" },
			]);
		});

		test("persists the empty string back to the standard model", async () => {
			const writes: Array<{ key: string; value: unknown }> = [];
			(vscode.workspace as any).getConfiguration = (_section?: string) => ({
				get: (_key: string, def: any) => def,
				update: async (key: string, value: unknown) => {
					writes.push({ key, value });
				},
			});

			await buildProvider().setCommitMessageModel("");

			assert.deepStrictEqual(writes, [{ key: "git.commitMessageModel", value: "" }]);
		});
	});

	suite("forkSession", () => {
		test("forks before the selected user entry, restarts footer updates, and restores its prompt", async () => {
			const provider = buildProvider();

			const currentSessionManager = {
				getSessionId: () => "session-1",
				getCwd: () => "/fake/workspace",
				getSessionDir: () => "/fake/.pi/sessions",
				getSessionFile: () => "/fake/.pi/sessions/original.jsonl",
				getPath: () => [
					{
						type: "message",
						id: "user-entry",
						parentId: "assistant-parent",
						message: { role: "user", content: "Original prompt" },
					},
				],
				getEntry: (id: string) =>
					id === "user-entry"
						? {
								type: "message",
								id: "user-entry",
								parentId: "assistant-parent",
								message: {
									role: "user",
									content: [
										{ type: "text", text: "Original prompt" },
										{
											type: "image",
											data: "abc123",
											mimeType: "image/png",
											name: "diagram.png",
										},
									],
								},
							}
						: undefined,
			};

			const tempManager = {
				createBranchedSession: (leafId: string) => {
					assert.strictEqual(leafId, "assistant-parent");
					return "/fake/.pi/sessions/forked.jsonl";
				},
			};

			const forkedManager = {
				getCwd: () => "/fake/workspace",
				getSessionDir: () => "/fake/.pi/sessions",
				getSessionFile: () => "/fake/.pi/sessions/forked.jsonl",
				getPath: () => [],
			};

			const openCalls: string[] = [];
			const originalOpen = SessionManager.open;
			(SessionManager as any).open = (path: string) => {
				openCalls.push(path);
				if (path === "/fake/.pi/sessions/original.jsonl") {
					return tempManager;
				}
				return forkedManager;
			};

			const extensionRunner = {
				emit: async () => {},
			};
			const newSession = createSessionMock({
				sessionId: "forked-session",
			});
			newSession.extensionRunner = extensionRunner as any;

			const mockSession = createSessionMock({
				sessionId: "session-1",
			});
			(mockSession as any).sessionManager = currentSessionManager;
			(provider as any).session = mockSession as any;
			(provider as any)._onDidChangeTreeData = { fire: () => {} } as any;
			(provider as any).extensionUIContext = {
				stopStatusPoller: () => {},
				bindExtensionUI: async () => {},
			} as any;
			const footerStartCalls: Array<{
				cwd: string;
				sessionName: string | null;
			}> = [];
			(provider as any).footerManager = {
				start: (config: { getCwd: () => string; sessionName: string | null }) => {
					footerStartCalls.push({
						cwd: config.getCwd(),
						sessionName: config.sessionName,
					});
				},
				stop: () => {},
			} as any;
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				webviewMessages.push(msg);
			};

			const originalCreate = piAgentProviderInternals.createAgentSession;
			piAgentProviderInternals.createAgentSession = (async (opts: any) => {
				assert.ok(opts.sessionManager, "sessionManager must be provided");
				return { session: newSession, extensionsResult: {} as any };
			}) as any;

			await provider["forkSession"]("user-entry");

			assert.strictEqual(openCalls.length, 2);
			assert.ok(openCalls[1].includes("forked.jsonl"));
			assert.strictEqual((provider as any).session!.sessionId, "forked-session");
			assert.ok(
				webviewMessages.some(
					(msg: any) =>
						msg.type === "fork-input-restored" &&
						msg.data?.text === "Original prompt" &&
						msg.data?.images?.[0]?.name === "diagram.png",
				),
				"forked prompt should be restored into the input",
			);
			assert.deepStrictEqual(footerStartCalls, [
				{ cwd: "/fake/workspace", sessionName: null },
			]);

			(SessionManager as any).open = originalOpen;
			piAgentProviderInternals.createAgentSession = originalCreate;
		});

		test("is no-op when no session exists", async () => {
			const provider = buildProvider();
			await provider["forkSession"]("node-1");
			assert.ok(true);
		});

		test("rejects forking from a non-user entry", async () => {
			const provider = buildProvider();

			const currentSessionManager = {
				getCwd: () => "/fake/workspace",
				getSessionDir: () => "/fake/.pi/sessions",
				getSessionFile: () => "/fake/.pi/sessions/original.jsonl",
				getPath: () => [
					{
						type: "message",
						id: "assistant-entry",
						parentId: "user-entry",
						message: { role: "assistant", content: "Nope" },
					},
				],
				getEntry: (id: string) =>
					id === "assistant-entry"
						? {
								type: "message",
								id: "assistant-entry",
								parentId: "user-entry",
								message: { role: "assistant", content: "Nope" },
							}
						: undefined,
			};

			const mockSession = createSessionMock({ sessionId: "session-1" });
			(mockSession as any).sessionManager = currentSessionManager;
			(provider as any).session = mockSession as any;
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (msg: any) => {
				webviewMessages.push(msg);
			};

			await provider["forkSession"]("assistant-entry");

			assert.ok(
				webviewMessages.some(
					(msg: any) =>
						msg.type === "error" &&
						String(msg.data?.message || "").includes("user message"),
				),
				"expected an error when trying to fork from a non-user entry",
			);
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
			(provider as any).settingsManager = undefined;
			assert.strictEqual(provider["getSettingsManager"](), undefined);
		});
	});

	suite("pi UI settings", () => {
		test("getPiUISettings reads showCacheMissNotices from settings manager", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).settingsManager = {
				getShowCacheMissNotices: () => true,
			} as any;
			const result = await provider["getPiUISettings"]();
			assert.deepStrictEqual(result, { showCacheMissNotices: true });
		});

		test("getPiUISettings returns default false when unset", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).settingsManager = {
				getShowCacheMissNotices: () => false,
			} as any;
			const result = await provider["getPiUISettings"]();
			assert.deepStrictEqual(result, { showCacheMissNotices: false });
		});

		test("getPiUISettings returns false when settings manager missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).settingsManager = undefined;
			const result = await provider["getPiUISettings"]();
			assert.deepStrictEqual(result, { showCacheMissNotices: false });
		});

		test("setPiUISetting persists and notifies webview", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			const calls: unknown[] = [];
			const flushCalls: unknown[] = [];
			(provider as any).settingsManager = {
				setShowCacheMissNotices: (v: boolean) => calls.push(v),
				flush: async () => flushCalls.push(true),
			} as any;
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (m: any) => webviewMessages.push(m);

			await provider["setPiUISetting"]("showCacheMissNotices", true);

			assert.deepStrictEqual(calls, [true]);
			assert.strictEqual(flushCalls.length, 1);
			assert.ok(
				webviewMessages.some(
					(m: any) =>
						m.type === "pi-settings-changed" && m.data.showCacheMissNotices === true,
				),
			);
		});

		test("setPiUISetting throws when settings manager missing", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = false;
			(provider as any).settingsManager = undefined;
			// initialize() re-creates the settings manager through this seam;
			// return undefined so the missing-manager error path is reached.
			const savedCreateSm = piAgentProviderInternals.createSettingsManager;
			piAgentProviderInternals.createSettingsManager = () => undefined as any;
			try {
				await assert.rejects(
					provider["setPiUISetting"]("showCacheMissNotices", true),
					/not initialized/,
				);
			} finally {
				piAgentProviderInternals.createSettingsManager = savedCreateSm;
			}
		});
	});

	suite("provider auth check", () => {
		test("checkProviderAuth returns configured api_key", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				checkAuth: async () => ({ type: "api_key", source: "auth.json" }),
			} as any;
			const result = await provider["checkProviderAuth"]("openai");
			assert.deepStrictEqual(result, {
				provider: "openai",
				configured: true,
				credentialType: "api_key",
			});
		});

		test("checkProviderAuth returns configured oauth", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				checkAuth: async () => ({ type: "oauth", source: "env" }),
			} as any;
			const result = await provider["checkProviderAuth"]("anthropic");
			assert.deepStrictEqual(result, {
				provider: "anthropic",
				configured: true,
				credentialType: "oauth",
			});
		});

		test("checkProviderAuth reports unconfigured when checkAuth undefined", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRuntime = {
				checkAuth: async () => undefined,
			} as any;
			const result = await provider["checkProviderAuth"]("openai");
			assert.deepStrictEqual(result, {
				provider: "openai",
				configured: false,
				credentialType: null,
			});
		});

		test("checkProviderAuth throws when runtime missing", async () => {
			const provider: any = buildProvider();
			await settleInitialize(provider);
			provider.isInitialized = true;
			provider.modelRuntime = undefined;
			await assert.rejects(provider["checkProviderAuth"]("openai"), /not initialized/);
		});
	});

	suite("provider oauth login", () => {
		/** Build a provider whose runtime/handler mocks cover the login flow. */
		async function buildLoginProvider(runtimeOverrides: Record<string, unknown>) {
			const provider: any = buildProvider();
			await settleInitialize(provider);
			provider.isInitialized = true;
			const webviewMessages: any[] = [];
			provider.notifyWebview = (m: any) => webviewMessages.push(m);
			const openedUrls: string[] = [];
			provider.openExternalUrl = async (url: string) => {
				openedUrls.push(url);
			};
			provider.modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async () => {},
				refresh: async () => ({}),
				getProviders: () => [
					{ id: "anthropic", auth: { oauth: {} } },
					{ id: "openai", auth: { apiKey: {} } },
				],
				getRegisteredProviderIds: () => [],
				isUsingOAuth: () => false,
				login: async () => {
					throw new Error("login stub should not run");
				},
				...runtimeOverrides,
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;
			(provider as any).getCustomProviderIds = () => new Set<string>();
			return { provider, webviewMessages, openedUrls };
		}

		test("loginProvider streams events, opens the browser, and resolves prompts", async () => {
			const { provider, webviewMessages, openedUrls } = await buildLoginProvider({
				login: async (_id: string, _type: string, interaction: any) => {
					interaction.notify({
						type: "auth_url",
						url: "https://auth.example/start",
						instructions: "Visit to authorize",
					});
					const code = await interaction.prompt({
						type: "text",
						message: "Enter the code",
						placeholder: "code",
					});
					assert.strictEqual(code, "123-456");
				},
			});

			const done = provider["loginProvider"]("anthropic");
			// Let the flow run until it blocks on the pending prompt.
			await new Promise((resolve) => setTimeout(resolve, 0));

			const promptMsg = webviewMessages.find((m: any) => m.type === "provider-login-prompt");
			assert.ok(promptMsg, "prompt message should be sent to the webview");
			assert.strictEqual(promptMsg.data.prompt.type, "text");
			assert.strictEqual(promptMsg.data.prompt.message, "Enter the code");

			const eventMsg = webviewMessages.find(
				(m: any) => m.type === "provider-login-event" && m.data.event.type === "auth_url",
			);
			assert.ok(eventMsg, "auth_url event should be forwarded");
			assert.strictEqual(eventMsg.data.event.url, "https://auth.example/start");
			assert.deepStrictEqual(
				openedUrls,
				["https://auth.example/start"],
				"browser should open the auth URL",
			);

			provider["resolveLoginPrompt"]("anthropic", promptMsg.data.promptId, "123-456", false);
			await done;

			const resultMsg = webviewMessages.find((m: any) => m.type === "provider-login-result");
			assert.ok(resultMsg, "result message should be sent");
			assert.strictEqual(resultMsg.data.success, true);
			assert.strictEqual(
				(provider as any).activeLogins.size,
				0,
				"login state should be cleaned up",
			);
			assert.strictEqual(
				(provider as any).pendingLoginPrompts.size,
				0,
				"prompt state should be cleaned up",
			);
			// Success refreshes the provider list so the new auth state shows.
			assert.ok(
				webviewMessages.some((m: any) => m.type === "provider-auth"),
				"provider-auth refresh should follow a successful login",
			);
		});

		test("loginProvider forwards device_code events with the verification URL", async () => {
			const { provider, webviewMessages, openedUrls } = await buildLoginProvider({
				login: async (_id: string, _type: string, interaction: any) => {
					interaction.notify({
						type: "device_code",
						userCode: "ABCD-1234",
						verificationUri: "https://example.com/device",
					});
				},
			});

			await provider["loginProvider"]("anthropic");

			const eventMsg = webviewMessages.find(
				(m: any) =>
					m.type === "provider-login-event" && m.data.event.type === "device_code",
			);
			assert.ok(eventMsg, "device_code event should be forwarded");
			assert.strictEqual(eventMsg.data.event.userCode, "ABCD-1234");
			assert.deepStrictEqual(
				openedUrls,
				["https://example.com/device"],
				"verification URL should be opened in the browser",
			);
		});

		test("loginProvider reports flow failures as result messages without rejecting", async () => {
			const { provider, webviewMessages } = await buildLoginProvider({
				login: async () => {
					throw new Error("invalid_grant");
				},
			});

			await provider["loginProvider"]("anthropic");

			const resultMsg = webviewMessages.find((m: any) => m.type === "provider-login-result");
			assert.ok(resultMsg, "result message should be sent");
			assert.strictEqual(resultMsg.data.success, false);
			assert.strictEqual(resultMsg.data.error, "invalid_grant");
			assert.strictEqual(
				(provider as any).activeLogins.size,
				0,
				"failed login should be cleaned up",
			);
		});

		test("loginProvider throws for providers without OAuth support", async () => {
			const { provider } = await buildLoginProvider({});
			await assert.rejects(provider["loginProvider"]("openai"), /does not offer OAuth login/);
		});

		test("loginProvider rejects duplicate concurrent logins", async () => {
			const { provider, webviewMessages } = await buildLoginProvider({
				login: (_id: string, _type: string, interaction: any) =>
					new Promise((_resolve, reject) => {
						interaction.signal.addEventListener("abort", () =>
							reject(new Error("Login cancelled")),
						);
					}),
			});

			const first = provider["loginProvider"]("anthropic");
			await new Promise((resolve) => setTimeout(resolve, 0));

			await assert.rejects(provider["loginProvider"]("anthropic"), /already in progress/);

			provider["cancelProviderLogin"]("anthropic");
			await first;

			const resultMsg = webviewMessages.find((m: any) => m.type === "provider-login-result");
			assert.ok(resultMsg, "cancelled login should report a result");
			assert.strictEqual(resultMsg.data.success, false);
			assert.strictEqual(resultMsg.data.cancelled, true);
		});

		test("cancelProviderLogin rejects pending prompts as cancelled", async () => {
			const { provider, webviewMessages } = await buildLoginProvider({
				login: async (_id: string, _type: string, interaction: any) => {
					await interaction.prompt({
						type: "manual_code",
						message: "Paste the callback URL",
					});
					assert.fail("prompt should be rejected before resolving");
				},
			});

			const done = provider["loginProvider"]("anthropic");
			await new Promise((resolve) => setTimeout(resolve, 0));

			provider["cancelProviderLogin"]("anthropic");
			await done;

			const resultMsg = webviewMessages.find((m: any) => m.type === "provider-login-result");
			assert.ok(resultMsg);
			assert.strictEqual(resultMsg.data.success, false);
			assert.strictEqual(resultMsg.data.cancelled, true);
		});

		test("resolveLoginPrompt ignores unknown prompt ids", async () => {
			const { provider } = await buildLoginProvider({});
			// Must not throw for stale/unknown prompts.
			provider["resolveLoginPrompt"]("anthropic", "no-such-prompt", "x", false);
		});

		test("removeAuth logs out OAuth providers and drops runtime keys for others", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			const logoutCalls: string[] = [];
			const removeCalls: string[] = [];
			(provider as any).modelRuntime = {
				setRuntimeApiKey: async () => {},
				removeRuntimeApiKey: async (id: string) => removeCalls.push(id),
				logout: async (id: string) => logoutCalls.push(id),
				isUsingOAuth: (id: string) => id === "anthropic",
				refresh: async () => ({}),
				getProviders: () => [],
				getRegisteredProviderIds: () => [],
			} as any;
			(provider as any).modelRegistry = {
				getAll: () => [],
				getProviderAuthStatus: () => ({ configured: true }),
				getProviderDisplayName: (id: string) => id,
			} as any;
			(provider as any).modelRegistryHandler = {
				refreshAvailableModels: async () => {},
				getAvailableModels: () => [],
				invalidateCliModelIdsCache: () => {},
			} as any;

			await provider["removeAuth"]("anthropic");
			await provider["removeAuth"]("openai");

			assert.deepStrictEqual(logoutCalls, ["anthropic"], "oauth provider logs out");
			assert.deepStrictEqual(
				removeCalls,
				["openai"],
				"api-key provider keeps removeRuntimeApiKey behavior",
			);
		});

		test("getProviderAuthData flags providers that offer OAuth login", async () => {
			const { provider } = await buildLoginProvider({});
			(provider as any).modelRegistry = {
				getAll: () => [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
				getProviderAuthStatus: () => ({ configured: false }),
				getProviderDisplayName: (id: string) => id,
			} as any;

			const data = await provider["getProviderAuthData"]();
			const anthropic = data.find((p: any) => p.provider === "anthropic");
			const openai = data.find((p: any) => p.provider === "openai");
			assert.ok(anthropic, "oauth provider should be listed");
			assert.strictEqual(anthropic.oauthLogin, true);
			assert.ok(openai);
			assert.strictEqual(openai.oauthLogin, false);
		});
	});

	suite("provider auth data credential type", () => {
		test("getProviderAuthData includes oauth credential type", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRegistry = {
				getAll: () => [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
				getProviderAuthStatus: () => ({
					configured: true,
					source: "configured",
				}),
				getProviderDisplayName: () => "OpenAI",
			} as any;
			(provider as any).modelRuntime = {
				getProviders: () => [],
				isUsingOAuth: () => true,
			} as any;
			(provider as any).getCustomProviderIds = () => new Set<string>();
			const result = await provider["getProviderAuthData"]();
			assert.strictEqual(result[0].credentialType, "oauth");
		});

		test("getProviderAuthData reports null credential type when unconfigured", async () => {
			const provider = buildProvider();
			(provider as any).isInitialized = true;
			(provider as any).modelRegistry = {
				getAll: () => [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
				getProviderAuthStatus: () => ({
					configured: false,
					source: undefined,
				}),
				getProviderDisplayName: () => "OpenAI",
			} as any;
			(provider as any).modelRuntime = {
				getProviders: () => [],
				isUsingOAuth: () => false,
			} as any;
			(provider as any).getCustomProviderIds = () => new Set<string>();
			const result = await provider["getProviderAuthData"]();
			assert.strictEqual(result[0].credentialType, null);
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

	suite("thinking level per-model support", () => {
		function setupProviderWithModel(
			provider: any,
			modelId: string,
			availableThinkingLevels: string[],
		) {
			provider.availableModels = [
				{
					id: modelId,
					provider: modelId.split("/")[0],
					name: modelId,
					availableThinkingLevels,
				},
			];
			provider.currentModelId = modelId;
			const setThinkingCalls: string[] = [];
			provider.session = {
				setThinkingLevel: (l: string) => {
					setThinkingCalls.push(l);
				},
			};
			let persistedLevel: string | undefined;
			provider.settingsManager.getDefaultThinkingLevel = () => "medium";
			provider.settingsManager.setDefaultThinkingLevel = async (l: string) => {
				persistedLevel = l;
			};
			return {
				setThinkingCalls,
				getPersisted: () => persistedLevel,
			};
		}

		test("getAvailableThinkingLevels returns model's list when known", () => {
			const provider = buildProvider();
			(provider as any).availableModels = [
				{
					id: "openai/gpt-4",
					provider: "openai",
					name: "GPT-4",
					availableThinkingLevels: ["off", "low", "high"],
				},
			];
			assert.deepStrictEqual((provider as any).getAvailableThinkingLevels("openai/gpt-4"), [
				"off",
				"low",
				"high",
			]);
		});

		test("getAvailableThinkingLevels falls back to full set for unknown model", () => {
			const provider = buildProvider();
			assert.deepStrictEqual((provider as any).getAvailableThinkingLevels("unknown/model"), [
				"off",
				"minimal",
				"low",
				"medium",
				"high",
				"xhigh",
				"max",
			]);
		});

		test("setThinkingLevel clamps an unsupported level to the nearest supported", async () => {
			const provider = buildProvider();
			const ctx = setupProviderWithModel(provider as any, "openai/gpt-4", [
				"off",
				"low",
				"high",
			]);
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (m: any) => webviewMessages.push(m);

			await (provider as any).setThinkingLevel("max");

			assert.deepStrictEqual(ctx.setThinkingCalls, ["high"]);
			assert.strictEqual(ctx.getPersisted(), "high");
			const changed = webviewMessages.find((m) => m.type === "thinking-level-changed");
			assert.ok(changed, "should notify thinking-level-changed");
			assert.strictEqual(changed.data.level, "high");
		});

		test("setThinkingLevel accepts a supported level unchanged", async () => {
			const provider = buildProvider();
			const ctx = setupProviderWithModel(provider as any, "openai/gpt-4", [
				"off",
				"low",
				"high",
			]);
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (m: any) => webviewMessages.push(m);

			await (provider as any).setThinkingLevel("low");

			assert.deepStrictEqual(ctx.setThinkingCalls, ["low"]);
			assert.strictEqual(ctx.getPersisted(), "low");
			assert.ok(
				!webviewMessages.some((m) => m.type === "thinking-level-changed"),
				"should not notify when level is unchanged",
			);
		});

		test("setModel re-validates thinking level against the new model", async () => {
			const provider = buildProvider();
			await settleInitialize(provider);
			// Mutate in place: modelRegistryHandler captured the array reference at
			// build time, so replacing the property would leave it stale.
			const models: any[] = (provider as any).availableModels;
			models.length = 0;
			models.push({
				id: "anthropic/claude-x",
				provider: "anthropic",
				name: "Claude X",
				availableThinkingLevels: ["off", "low"],
			});
			(provider as any).currentModelId = "openai/gpt-4o-mini";
			(provider as any).session = {
				setModel: async () => {},
				setThinkingLevel: (_l: string) => {},
			};
			(provider as any).modelRegistry.find = () => ({});
			let persistedLevel: string | undefined;
			(provider as any).settingsManager.getDefaultThinkingLevel = () => "medium";
			(provider as any).settingsManager.setDefaultThinkingLevel = async (l: string) => {
				persistedLevel = l;
			};
			const webviewMessages: any[] = [];
			(provider as any).notifyWebview = (m: any) => webviewMessages.push(m);

			await (provider as any).setModel("anthropic/claude-x");

			assert.strictEqual(persistedLevel, "low");
			const changed = webviewMessages.find((m) => m.type === "thinking-level-changed");
			assert.ok(changed, "should notify thinking-level-changed on model switch");
			assert.strictEqual(changed.data.level, "low");
			const modelChanged = webviewMessages.find((m) => m.type === "model-changed");
			assert.ok(modelChanged, "should notify model-changed");
			assert.strictEqual(modelChanged.data.modelId, "anthropic/claude-x");
		});
	});
});
