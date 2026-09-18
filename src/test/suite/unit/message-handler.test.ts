import * as assert from "node:assert";
import * as vscode from "vscode";
import { MessageHandler } from "../../../message-handler.js";
import type { ProviderApi } from "../../../protocol/types.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

// MessageHandler.handle() reports failures by returning `{ error }` (and
// posting to the webview) rather than re-throwing. Capture both shapes so
// error-path tests can assert either outcome uniformly.
async function catchError(fn: () => Promise<any>): Promise<{ caught?: Error; result?: any }> {
	let caught: Error | undefined;
	let result: any;
	try {
		result = await fn();
	} catch (e) {
		caught = e as Error;
	}
	return { caught, result };
}

function createMockProvider(): {
	provider: ProviderApi & { calls: Record<string, unknown[][]> };
	webviewMessages: any[];
} {
	const calls: Record<string, unknown[][]> = {};
	const webviewMessages: any[] = [];

	const webview = {
		postMessage: (msg: any) => {
			webviewMessages.push(msg);
		},
	};

	const base: any = {
		webview,
		hasSession: false,
		getSession: () => undefined as { sessionName: string | undefined } | undefined,
		prompt: () => undefined,
		newSession: () => undefined,
		switchSession: () => undefined,
		forkSession: () => undefined,
		navigateTree: () => undefined,
		setSessionName: () => undefined,
		setModel: () => undefined,
		setThinkingLevel: () => undefined,
		steer: () => undefined,
		followUp: () => undefined,
		abort: () => undefined,
		compact: () => undefined,
		getContextUsage: () => undefined,
		getSessionStats: () => undefined,
		getAutoCompactionEnabled: () => false,
		setAutoCompactionEnabled: () => undefined,
		getAutoContext: () => false,
		setAutoContext: () => undefined,
		getAvailableModels: async () => [{ id: "model-a", provider: "prov", name: "Model A" }],
		getCurrentModelId: () => "model-a",
		getExtensionVersion: () => "1.0.0",
		getPiCliVersion: async () => "0.1.0",
		isBinaryAvailable: () => true,
		getThinkingLevel: () => "medium",
		getFavorites: () => [],
		getProviderAuthData: async () => [],
		setApiKey: () => undefined,
		removeAuth: () => undefined,
		loginProvider: async () => {},
		cancelProviderLogin: () => undefined,
		resolveLoginPrompt: () => undefined,
		openExternalUrl: async () => {},
		addProvider: () => undefined,
		removeProvider: () => undefined,
		openConfigFile: () => undefined,
		toggleFavorite: async () => [],
		listSessions: async () => [],
		getSettings: async () => ({
			toolPreset: "default",
			customTools: [],
		}),
		setToolConfig: () => undefined,
		listPackages: async () => [],
		installPackage: () => undefined,
		uninstallPackage: () => undefined,
		updatePackages: () => undefined,
		toggleVoiceCapture: () => undefined,
		sendSessionResources: () => undefined,
		logDebug: () => undefined,
		logError: () => undefined,
		deleteSessions: () => undefined,
		editMessage: () => undefined,
		getSkillDiscovery: () => false,
		setSkillDiscovery: () => undefined,
		getSystemPromptOverrides: () => ({
			systemPrompt: false,
			appendSystemPrompts: false,
		}),
		setExtraSkillPaths: () => undefined,
		getExtraSkillPaths: () => [],
		sendSkillsList: () => undefined,
		getLightMode: () => false,
		setLightMode: () => Promise.resolve(),
		getCommitMessageModel: () => "",
		setCommitMessageModel: () => Promise.resolve(),
		restartSessionPreservingHistory: () => Promise.resolve(),
	};

	// Tests override provider methods with plain functions and still assert on
	// `provider.calls.<name>`. Record every method call through a proxy so the
	// call log stays populated regardless of how the method was replaced.
	const provider: any = new Proxy(base, {
		get(target, prop, _receiver) {
			const value = Reflect.get(target, prop, target);
			if (typeof prop === "string" && typeof value === "function" && prop !== "postMessage") {
				return (...args: unknown[]) => {
					calls[prop] = calls[prop] || [];
					calls[prop].push(args);
					return value.apply(target, args);
				};
			}
			return value;
		},
		set(target, prop, value) {
			Reflect.set(target, prop, value);
			return true;
		},
	});

	// Tests assert on `provider.calls.<name>`; expose the shared call log.
	base.calls = calls;

	return { provider, webviewMessages };
}

suite("MessageHandler", () => {
	let handler: MessageHandler;
	let provider: any;
	let webviewMessages: any[];

	setup(() => {
		const mocks = createMockProvider();
		provider = mocks.provider;
		webviewMessages = mocks.webviewMessages;
		handler = new MessageHandler(provider);
	});

	teardown(() => {
		webviewMessages = [];
	});

	test("ready - calls handleReady and sends ready response", async () => {
		resetVscodeMocks();
		const result = await handler.handle({ type: "ready" });
		assert.ok(provider.calls.getAvailableModels.length > 0);
		assert.ok(provider.calls.listSessions.length > 0);
		const readyMsg = webviewMessages.find((m: any) => m.type === "ready");
		assert.ok(readyMsg, "expected ready message to webview");
		assert.strictEqual(result.appVersion, "1.0.0");
		assert.strictEqual(result.models.length, 1);
	});

	test("prompt success - calls provider.prompt and returns success", async () => {
		provider.prompt = () => Promise.resolve();
		const result = await handler.handle({
			type: "prompt",
			id: "msg-1",
			data: { text: "hello" },
		});
		assert.strictEqual(provider.calls.prompt.length, 1);
		assert.deepStrictEqual(provider.calls.prompt[0], ["hello", undefined]);
		const response = webviewMessages.find((m: any) => m.id === "msg-1");
		assert.ok(response, "expected response with matching id");
		assert.strictEqual(result.success, true);
	});

	test("prompt error - posts error to webview and re-throws", async () => {
		const err = new Error("prompt failed");
		provider.prompt = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "prompt",
				id: "msg-1",
				data: { text: "hello" },
			}),
		);
		const message = caught?.message ?? result?.error;
		assert.ok(message, "expected error to be surfaced");
		assert.strictEqual(message, "prompt failed");
		const errorMsg = webviewMessages.find((m: any) => m.type === "error");
		assert.ok(errorMsg, "expected error message to webview");
		assert.strictEqual(errorMsg.data.message, "prompt failed");
	});

	test("newSession success", async () => {
		provider.newSession = () => Promise.resolve();
		const result = await handler.handle({ type: "newSession", data: {} });
		assert.strictEqual(provider.calls.newSession.length, 1);
		assert.strictEqual(result.success, true);
	});

	test("newSession error - posts error and re-throws", async () => {
		const err = new Error("new session failed");
		provider.newSession = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "newSession", data: {} }),
		);
		assert.ok(caught || result?.error);
		assert.strictEqual(caught?.message ?? result?.error, "new session failed");
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("exportSession html", async () => {
		provider.prompt = () => Promise.resolve();
		const result = await handler.handle({
			type: "exportSession",
			data: { format: "html" },
		});
		assert.deepStrictEqual(provider.calls.prompt[0], ["/export .html"]);
		assert.strictEqual(result.success, true);
		const exportMsg = webviewMessages.find((m: any) => m.type === "exportResult");
		assert.ok(exportMsg);
		assert.strictEqual(exportMsg.data.success, true);
	});

	test("exportSession jsonl", async () => {
		provider.prompt = () => Promise.resolve();
		await handler.handle({ type: "exportSession", data: { format: "jsonl" } });
		assert.deepStrictEqual(provider.calls.prompt[0], ["/export .jsonl"]);
	});

	test("exportSession markdown", async () => {
		provider.prompt = () => Promise.resolve();
		await handler.handle({
			type: "exportSession",
			data: { format: "markdown" },
		});
		assert.deepStrictEqual(provider.calls.prompt[0], ["/export .md"]);
	});

	test("exportSession error - sends error exportResult", async () => {
		const err = new Error("export failed");
		provider.prompt = () => Promise.reject(err);
		const result = await handler.handle({
			type: "exportSession",
			data: { format: "html" },
		});
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("export failed"));
		const exportMsg = webviewMessages.find((m: any) => m.type === "exportResult");
		assert.ok(exportMsg);
		assert.strictEqual(exportMsg.data.success, false);
	});

	test("switchSession success", async () => {
		provider.switchSession = () => Promise.resolve();
		const result = await handler.handle({
			type: "switchSession",
			data: { sessionId: "s1" },
		});
		assert.deepStrictEqual(provider.calls.switchSession[0], ["s1"]);
		assert.strictEqual(result.success, true);
	});

	test("switchSession error - posts error and re-throws", async () => {
		const err = new Error("switch failed");
		provider.switchSession = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "switchSession",
				data: { sessionId: "s1" },
			}),
		);
		assert.ok(caught || result?.error);
		assert.strictEqual(caught?.message ?? result?.error, "switch failed");
	});

	test("setSessionName success", async () => {
		provider.setSessionName = () => Promise.resolve();
		const result = await handler.handle({
			type: "setSessionName",
			data: { name: "new-name" },
		});
		assert.deepStrictEqual(provider.calls.setSessionName[0], ["new-name"]);
		assert.strictEqual(result.success, true);
	});

	test("setSessionName error - posts error and re-throws", async () => {
		const err = new Error("rename failed");
		provider.setSessionName = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "setSessionName", data: { name: "x" } }),
		);
		assert.ok(caught || result?.error);
	});

	test("switchModel success", async () => {
		provider.setModel = () => Promise.resolve();
		const result = await handler.handle({
			type: "switchModel",
			data: { modelId: "m1" },
		});
		assert.deepStrictEqual(provider.calls.setModel[0], ["m1"]);
		assert.strictEqual(result.success, true);
	});

	test("switchModel error - posts error and re-throws", async () => {
		const err = new Error("model failed");
		provider.setModel = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "switchModel", data: { modelId: "m1" } }),
		);
		assert.ok(caught || result?.error);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("setThinkingLevel success", async () => {
		provider.setThinkingLevel = () => Promise.resolve();
		const result = await handler.handle({
			type: "setThinkingLevel",
			data: { level: "high" },
		});
		assert.deepStrictEqual(provider.calls.setThinkingLevel[0], ["high"]);
		assert.strictEqual(result.success, true);
	});

	test("setThinkingLevel error - posts error and re-throws", async () => {
		const err = new Error("thinking level failed");
		provider.setThinkingLevel = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "setThinkingLevel",
				data: { level: "low" },
			}),
		);
		assert.ok(caught || result?.error);
	});

	test("steer success", async () => {
		provider.steer = () => Promise.resolve();
		const result = await handler.handle({
			type: "steer",
			data: { text: "be concise" },
		});
		assert.deepStrictEqual(provider.calls.steer[0], ["be concise"]);
		assert.strictEqual(result.success, true);
	});

	test("steer error - posts error and re-throws", async () => {
		const err = new Error("steer failed");
		provider.steer = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "steer", data: { text: "x" } }),
		);
		assert.ok(caught || result?.error);
	});

	test("followUp success", async () => {
		provider.followUp = () => Promise.resolve();
		const result = await handler.handle({
			type: "followUp",
			data: { text: "more" },
		});
		assert.deepStrictEqual(provider.calls.followUp[0], ["more"]);
		assert.strictEqual(result.success, true);
	});

	test("followUp error - posts error and re-throws", async () => {
		const err = new Error("follow up failed");
		provider.followUp = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "followUp", data: { text: "x" } }),
		);
		assert.ok(caught || result?.error);
	});

	test("abort success", async () => {
		provider.abort = () => Promise.resolve();
		const result = await handler.handle({ type: "abort", data: {} });
		assert.ok(provider.calls.abort.length > 0);
		assert.strictEqual(result.success, true);
	});

	test("abort error - posts error and re-throws", async () => {
		const err = new Error("abort failed");
		provider.abort = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "abort", data: {} }),
		);
		assert.ok(caught || result?.error);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("compact success", async () => {
		provider.compact = () => Promise.resolve({ ok: true });
		const result = await handler.handle({ type: "compact", data: {} });
		assert.deepStrictEqual(result, { ok: true });
	});

	test("compact error - posts error and re-throws", async () => {
		const err = new Error("compact failed");
		provider.compact = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "compact", data: {} }),
		);
		assert.ok(caught || result?.error);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("edit-message success", async () => {
		provider.editMessage = () => Promise.resolve();
		const result = await handler.handle({
			type: "edit-message",
			data: { index: 2, text: "new text" },
		});
		assert.deepStrictEqual(provider.calls.editMessage[0], [2, "new text"]);
		assert.strictEqual(result.success, true);
	});

	test("edit-message error - posts error and re-throws", async () => {
		const err = new Error("edit failed");
		provider.editMessage = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "edit-message",
				data: { index: 0, text: "x" },
			}),
		);
		assert.ok(caught || result?.error);
	});

	test("forkSession success", async () => {
		provider.forkSession = () => Promise.resolve();
		const result = await handler.handle({
			type: "forkSession",
			data: { entryId: "entry-1" },
		});
		assert.deepStrictEqual(provider.calls.forkSession[0], ["entry-1"]);
		assert.strictEqual(result.success, true);
	});

	test("forkSession error - posts error and re-throws", async () => {
		const err = new Error("fork failed");
		provider.forkSession = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "forkSession",
				data: { entryId: "entry-1" },
			}),
		);
		assert.ok(caught || result?.error);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("setToolConfig success", async () => {
		provider.setToolConfig = () => Promise.resolve();
		const result = await handler.handle({
			type: "setToolConfig",
			data: { toolPreset: "custom", customTools: ["bash"] },
		});
		assert.deepStrictEqual(provider.calls.setToolConfig[0], [
			{ toolPreset: "custom", customTools: ["bash"] },
		]);
		assert.strictEqual(result.success, true);
		const settingsMsg = webviewMessages.find((m: any) => m.type === "settings-response");
		assert.ok(settingsMsg);
		assert.strictEqual(settingsMsg.data.toolPreset, "custom");
	});

	test("setToolConfig error - posts error and re-throws", async () => {
		const err = new Error("set tool failed");
		provider.setToolConfig = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "setToolConfig",
				data: { toolPreset: "custom", customTools: [] },
			}),
		);
		assert.ok(caught || result?.error);
	});

	test("getPiUISettings success", async () => {
		provider.getPiUISettings = () => Promise.resolve({ showCacheMissNotices: true });
		const result = await handler.handle({ type: "getPiUISettings" });
		assert.strictEqual(result.success, true);
		const msg = webviewMessages.find((m: any) => m.type === "pi-settings-changed");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data, { showCacheMissNotices: true });
	});

	test("getPiUISettings error - posts error and re-throws", async () => {
		const err = new Error("get pi settings failed");
		provider.getPiUISettings = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "getPiUISettings" }),
		);
		assert.ok(caught || result?.error);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("setPiUISetting success", async () => {
		provider.setPiUISetting = () => Promise.resolve();
		const result = await handler.handle({
			type: "setPiUISetting",
			data: { key: "showCacheMissNotices", value: true },
		});
		assert.deepStrictEqual(provider.calls.setPiUISetting[0], ["showCacheMissNotices", true]);
		assert.strictEqual(result.success, true);
	});

	test("setPiUISetting rejects invalid payload", async () => {
		provider.setPiUISetting = () => Promise.resolve();
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "setPiUISetting",
				data: { key: "showCacheMissNotices" },
			}),
		);
		assert.ok(caught || result?.error);
		assert.strictEqual(provider.calls.setPiUISetting?.length ?? 0, 0);
	});

	test("checkProviderAuth success", async () => {
		provider.checkProviderAuth = () =>
			Promise.resolve({
				provider: "openai",
				configured: true,
				credentialType: "api_key",
			});
		const result = await handler.handle({
			type: "checkProviderAuth",
			data: { provider: "openai" },
		});
		assert.deepStrictEqual(provider.calls.checkProviderAuth[0], ["openai"]);
		assert.strictEqual(result.success, true);
		const msg = webviewMessages.find((m: any) => m.type === "provider-auth-check-result");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data, {
			provider: "openai",
			configured: true,
			credentialType: "api_key",
		});
	});

	test("checkProviderAuth error - posts error and re-throws", async () => {
		const err = new Error("check auth failed");
		provider.checkProviderAuth = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "checkProviderAuth",
				data: { provider: "openai" },
			}),
		);
		assert.ok(caught || result?.error);
		const resultMsg = webviewMessages.find((m: any) => m.type === "provider-auth-check-result");
		assert.ok(!resultMsg, "no result message on failure");
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("installPackage success", async () => {
		provider.installPackage = () => Promise.resolve();
		provider.listPackages = () => Promise.resolve([{ source: "skill-a" }]);
		const result = await handler.handle({
			type: "installPackage",
			data: { source: "skill-a" },
		});
		assert.deepStrictEqual(provider.calls.installPackage[0], ["skill-a"]);
		assert.strictEqual(result.success, true);
		assert.ok(
			webviewMessages.some((m: any) => m.type === "installed"),
			"expected packages list refresh",
		);
	});

	test("installPackage error - posts error and re-throws", async () => {
		const err = new Error("install failed");
		provider.installPackage = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "installPackage",
				data: { source: "skill-a" },
			}),
		);
		assert.ok(caught || result?.error);
	});

	test("uninstallPackage success", async () => {
		provider.uninstallPackage = () => Promise.resolve();
		provider.listPackages = () => Promise.resolve([]);
		const result = await handler.handle({
			type: "uninstallPackage",
			data: { source: "skill-a" },
		});
		assert.deepStrictEqual(provider.calls.uninstallPackage[0], ["skill-a"]);
		assert.strictEqual(result.success, true);
	});

	test("uninstallPackage error - posts error and re-throws", async () => {
		const err = new Error("uninstall failed");
		provider.uninstallPackage = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({
				type: "uninstallPackage",
				data: { source: "skill-a" },
			}),
		);
		assert.ok(caught || result?.error);
	});

	test("updateResources success", async () => {
		provider.updatePackages = () => Promise.resolve();
		provider.listPackages = () => Promise.resolve([]);
		const result = await handler.handle({ type: "updateResources", data: {} });
		assert.ok(provider.calls.updatePackages.length > 0);
		assert.strictEqual(result.success, true);
	});

	test("updateResources error - posts error and re-throws", async () => {
		const err = new Error("update failed");
		provider.updatePackages = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "updateResources", data: {} }),
		);
		assert.ok(caught || result?.error);
	});

	test("toggle-voice-capture success", async () => {
		provider.toggleVoiceCapture = () => Promise.resolve();
		const result = await handler.handle({
			type: "toggle-voice-capture",
			data: {},
		});
		assert.ok(provider.calls.toggleVoiceCapture.length > 0);
		assert.strictEqual(result.success, true);
	});

	test("toggle-voice-capture error - posts error and re-throws", async () => {
		const err = new Error("voice failed");
		provider.toggleVoiceCapture = () => Promise.reject(err);
		const { caught, result } = await catchError(() =>
			handler.handle({ type: "toggle-voice-capture", data: {} }),
		);
		assert.ok(caught || result?.error);
	});

	test("getModels - fetches models and posts models-updated", async () => {
		provider.getAvailableModels = () =>
			Promise.resolve([{ id: "m1", provider: "p", name: "M1" }]);
		const result = await handler.handle({ type: "getModels", data: {} });
		assert.deepStrictEqual(result, [{ id: "m1", provider: "p", name: "M1" }]);
		const msg = webviewMessages.find((m: any) => m.type === "models-updated");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.models, [{ id: "m1", provider: "p", name: "M1" }]);
	});

	test("getProviderAuth - returns auth and sends provider-auth", async () => {
		provider.getProviderAuthData = () =>
			Promise.resolve([{ provider: "openai", configured: true }]);
		const result = await handler.handle({ type: "getProviderAuth", data: {} });
		assert.deepStrictEqual(result, [{ provider: "openai", configured: true }]);
		const msg = webviewMessages.find((m: any) => m.type === "provider-auth");
		assert.ok(msg);
		assert.strictEqual(msg.data[0].provider, "openai");
	});

	test("toggleFavorite success", async () => {
		provider.toggleFavorite = () => Promise.resolve(["model-a"]);
		const result = await handler.handle({
			type: "toggleFavorite",
			data: { modelId: "m1", isFavorite: true },
		});
		assert.deepStrictEqual(provider.calls.toggleFavorite[0], ["m1", true]);
		assert.deepStrictEqual(result, ["model-a"]);
	});

	test("listSessions - sends sessions-list", async () => {
		provider.listSessions = () => Promise.resolve([{ id: "s1", label: "S1" }]);
		const result = await handler.handle({ type: "listSessions", data: {} });
		assert.deepStrictEqual(result, [{ id: "s1", label: "S1" }]);
		const msg = webviewMessages.find((m: any) => m.type === "sessions-list");
		assert.ok(msg);
		assert.strictEqual(msg.data.length, 1);
	});

	test("getSessions - returns []", async () => {
		const result = await handler.handle({ type: "getSessions", data: {} });
		assert.deepStrictEqual(result, []);
	});

	test("getContextUsage - pushes immediately via sendContextUsage", async () => {
		provider.getContextUsage = () => ({ used: 10, total: 100 });
		const result = await handler.handle({ type: "getContextUsage", data: {} });
		assert.deepStrictEqual(result, { used: 10, total: 100 });
		const msg = webviewMessages.find((m: any) => m.type === "context-usage");
		assert.ok(msg);
		assert.strictEqual(msg.data.used, 10);
	});

	test("getSessionStats - pushes immediately via sendSessionStats", async () => {
		provider.getSessionStats = () => ({ tokens: 50 });
		const result = await handler.handle({ type: "getSessionStats", data: {} });
		assert.deepStrictEqual(result, { tokens: 50 });
		const msg = webviewMessages.find((m: any) => m.type === "session-stats");
		assert.ok(msg);
		assert.strictEqual(msg.data.tokens, 50);
	});

	test("getSessionStats falsy - does not push", async () => {
		provider.getSessionStats = () => null;
		const result = await handler.handle({ type: "getSessionStats", data: {} });
		assert.strictEqual(result, null);
		assert.ok(!webviewMessages.some((m: any) => m.type === "session-stats"));
	});

	test("getSessionResources - calls provider.sendSessionResources", async () => {
		provider.sendSessionResources = () => Promise.resolve();
		const result = await handler.handle({
			type: "getSessionResources",
			data: {},
		});
		assert.ok(provider.calls.sendSessionResources.length > 0);
		assert.strictEqual(result, undefined);
	});

	test("getSkills - calls provider.sendSkillsList", async () => {
		provider.sendSkillsList = () => Promise.resolve();
		const result = await handler.handle({ type: "getSkills", data: {} });
		assert.ok(provider.calls.sendSkillsList.length > 0);
		assert.strictEqual(result, undefined);
	});

	test("getSkillDiscovery - sends skill-discovery-changed", async () => {
		provider.getSkillDiscovery = () => true;
		const result = await handler.handle({
			type: "getSkillDiscovery",
			data: {},
		});
		assert.strictEqual(result, true);
		const msg = webviewMessages.find((m: any) => m.type === "skill-discovery-changed");
		assert.ok(msg);
		assert.strictEqual(msg.data.enabled, true);
	});

	test("getSystemPromptOverrides - sends system-prompt-overrides-changed", async () => {
		provider.getSystemPromptOverrides = () => ({
			systemPrompt: true,
			appendSystemPrompts: false,
		});
		const result = await handler.handle({
			type: "getSystemPromptOverrides",
			data: {},
		});
		assert.deepStrictEqual(result, {
			systemPrompt: true,
			appendSystemPrompts: false,
		});
		const msg = webviewMessages.find((m: any) => m.type === "system-prompt-overrides-changed");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data, {
			systemPrompt: true,
			appendSystemPrompts: false,
		});
	});

	test("setSkillDiscovery - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setSkillDiscovery = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({
			type: "setSkillDiscovery",
			data: { enabled: true },
		});
		assert.strictEqual(lastEnabled, true);
		assert.strictEqual(result.success, true);
	});

	test("getLightMode - sends light-mode-changed", async () => {
		provider.getLightMode = () => true;
		const result = await handler.handle({
			type: "getLightMode",
			data: {},
		});
		assert.strictEqual(result, true);
		const msg = webviewMessages.find((m: any) => m.type === "light-mode-changed");
		assert.ok(msg);
		assert.strictEqual(msg.data.enabled, true);
	});

	test("setLightMode - calls provider and returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setLightMode = (enabled: boolean) => {
			lastEnabled = enabled;
			return Promise.resolve();
		};
		const result = await handler.handle({
			type: "setLightMode",
			data: { enabled: true },
		});
		assert.strictEqual(lastEnabled, true);
		assert.strictEqual(result.success, true);
	});

	test("setExtraSkillPaths - returns success", async () => {
		provider.setExtraSkillPaths = () => Promise.resolve();
		const result = await handler.handle({
			type: "setExtraSkillPaths",
			data: { paths: ["/skills"] },
		});
		assert.deepStrictEqual(provider.calls.setExtraSkillPaths[0], [["/skills"]]);
		assert.strictEqual(result.success, true);
	});

	test("getExtraSkillPaths - sends extra-skill-paths", async () => {
		provider.getExtraSkillPaths = () => ["/skill-a"];
		const result = await handler.handle({
			type: "getExtraSkillPaths",
			data: {},
		});
		assert.deepStrictEqual(result, ["/skill-a"]);
		const msg = webviewMessages.find((m: any) => m.type === "extra-skill-paths");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.paths, ["/skill-a"]);
	});

	test("getAutoCompactionStatus - returns value", async () => {
		provider.getAutoCompactionEnabled = () => true;
		const result = await handler.handle({
			type: "getAutoCompactionStatus",
			data: {},
		});
		assert.strictEqual(result, true);
	});

	test("setAutoCompaction - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setAutoCompactionEnabled = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({
			type: "setAutoCompaction",
			data: { enabled: true },
		});
		assert.strictEqual(lastEnabled, true);
		assert.strictEqual(result.success, true);
	});

	test("setAutoContext - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setAutoContext = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({
			type: "setAutoContext",
			data: { enabled: false },
		});
		assert.strictEqual(lastEnabled, false);
		assert.strictEqual(result.success, true);
	});

	test("deleteSessions with empty ids - returns skipped", async () => {
		const result = await handler.handle({
			type: "deleteSessions",
			data: { sessionIds: [] },
		});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.skipped, true);
	});

	test("deleteSessions cancelled by user - returns cancelled", async () => {
		resetVscodeMocks();
		(vscode.window.showWarningMessage as any) = async () => "Cancel";
		const result = await handler.handle({
			type: "deleteSessions",
			data: { sessionIds: ["s1"] },
		});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.cancelled, true);
		assert.ok(!provider.calls.deleteSessions?.length, "deleteSessions should not be called");
	});

	test("deleteSessions success", async () => {
		resetVscodeMocks();
		(vscode.window.showWarningMessage as any) = async () => "Delete";
		provider.deleteSessions = () => Promise.resolve();
		const result = await handler.handle({
			type: "deleteSessions",
			data: { sessionIds: ["s1"] },
		});
		assert.strictEqual(result.success, true);
		assert.ok(provider.calls.deleteSessions.length > 0);
	});

	test("showRenameSessionDialog cancelled", async () => {
		resetVscodeMocks();
		(vscode.window.showInputBox as any) = async () => null;
		const result = await handler.handle({
			type: "showRenameSessionDialog",
			data: {},
		});
		assert.strictEqual(result.cancelled, true);
		assert.ok(!provider.calls.setSessionName?.length, "setSessionName should not be called");
	});

	test("showRenameSessionDialog success", async () => {
		resetVscodeMocks();
		(vscode.window.showInputBox as any) = async (opts: any) => {
			// Verify current session name is pre-filled
			assert.strictEqual(opts.value, "Current Name");
			return "new-name";
		};
		provider.setSessionName = () => Promise.resolve();
		provider.getSession = () => ({ sessionName: "Current Name" });
		const result = await handler.handle({
			type: "showRenameSessionDialog",
			data: {},
		});
		assert.deepStrictEqual(provider.calls.setSessionName[0], ["new-name"]);
		assert.strictEqual(result.success, true);
	});

	test("checkForUpdates - executes command", async () => {
		resetVscodeMocks();
		let executedCmd: string | undefined;
		(vscode.commands.executeCommand as any) = async (cmd: string) => {
			executedCmd = cmd;
		};
		const result = await handler.handle({ type: "checkForUpdates", data: {} });
		assert.strictEqual(executedCmd, "pi-agent.checkForUpdates");
		assert.strictEqual(result.success, true);
	});

	test("message.id present - calls sendResponse", async () => {
		provider.prompt = () => Promise.resolve();
		await handler.handle({
			type: "prompt",
			id: "req-123",
			data: { text: "hi" },
		});
		const response = webviewMessages.find((m: any) => m.id === "req-123");
		assert.ok(response, "expected response with id");
	});

	test("message.id absent - does NOT call sendResponse", async () => {
		provider.prompt = () => Promise.resolve();
		// ready sends ready message, not response
		await handler.handle({ type: "ready" });
		assert.ok(!webviewMessages.some((m: any) => m.id), "no response id expected");
	});

	test("default unknown type - returns error and logs debug", async () => {
		const result = await handler.handle({ type: "unknown-type", id: "req-1" });
		assert.ok(result.error?.includes("Unknown message type"));
		assert.ok(provider.calls.logDebug.length > 0, "expected logDebug call");
		const response = webviewMessages.find((m: any) => m.id === "req-1");
		assert.ok(response);
		assert.strictEqual(response.isError, true);
	});

	test("top-level catch - posts error response and returns error object", async () => {
		provider.getAvailableModels = () => {
			throw new Error("fatal");
		};
		// handleReady is called from ready; it triggers a throw inside the switch,
		// but since it's already inside the switch, it hits the inner try/catch if any.
		// Let's craft a message where provider throws in a way that escapes the switch.
		provider.listSessions = () => Promise.reject(new Error("fatal list"));
		// listSessions is called inside handleReady, not directly in switch-with-try.
		// handleReady has no inner try/catch, so it will propagate to outer catch.
		const result = await handler.handle({ type: "ready", id: "req-fatal" });
		assert.ok(result.error?.includes("fatal"));
		const response = webviewMessages.find((m: any) => m.id === "req-fatal");
		assert.ok(response);
		assert.strictEqual(response.isError, true);
		assert.ok(provider.calls.logError.length > 0, "expected logError call");
	});

	// ── getSessionInfo ────────────────────────────────────────────────────

	test("getSessionInfo returns resource info when session exists", async () => {
		const rl = {
			getAgentsFiles: () => ({ agentsFiles: [{ path: "ctx.ts" }] }),
			getSkills: () => ({ skills: [{ name: "s1", description: "skill one" }] }),
			getExtensions: () => ({ extensions: [{ path: "/ext" }] }),
			getPrompts: () => ({
				prompts: [{ name: "p1", description: "prompt one" }],
			}),
		};
		provider.session = { sessionId: "s1", resourceLoader: rl };
		provider.hasSession = true;

		const result = await handler.handle({ type: "getSessionInfo" });
		assert.ok(result);
		assert.strictEqual(result.skillCount, 1);
		assert.strictEqual(result.skills[0].name, "s1");
		assert.strictEqual(result.extensionCount, 1);
		assert.strictEqual(result.contextFileCount, 1);
		assert.strictEqual(result.promptCount, 1);
	});

	test("getSessionInfo returns null when no session", async () => {
		provider.session = undefined;
		provider.hasSession = false;

		const result = await handler.handle({ type: "getSessionInfo" });
		assert.strictEqual(result, null);
	});

	test("getSessionInfo handles resource loader errors gracefully", async () => {
		const rl = {
			getAgentsFiles: () => {
				throw new Error("loader broken");
			},
			getSkills: () => {
				throw new Error("loader broken");
			},
			getExtensions: () => {
				throw new Error("loader broken");
			},
			getPrompts: () => {
				throw new Error("loader broken");
			},
		};
		provider.session = { sessionId: "s1", resourceLoader: rl };
		provider.hasSession = true;

		const result = await handler.handle({ type: "getSessionInfo" });
		// Loader errors degrade to empty resource lists, not a hard failure.
		assert.ok(result && typeof result === "object");
		assert.strictEqual(result.skillCount, 0);
		assert.strictEqual(result.extensionCount, 0);
	});

	// ── getContext ─────────────────────────────────────────────────────────

	test("getContext returns project info", async () => {
		resetVscodeMocks();
		const vscode = (globalThis as any).vscode;
		vscode.workspace.fs.readFile = async () =>
			Buffer.from(JSON.stringify({ name: "proj", version: "2.0" }));

		const result = await handler.handle({ type: "getContext" });
		assert.ok(result);
		assert.strictEqual(result.name, "proj");
		assert.strictEqual(result.version, "2.0");
	});

	test("getContext returns null when no workspace folders", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.workspace.workspaceFolders = undefined;

		const result = await handler.handle({ type: "getContext" });
		assert.strictEqual(result, null);
	});

	// ── get-workspace-files ────────────────────────────────────────────────

	test("get-workspace-files sends sorted file list", async () => {
		resetVscodeMocks();
		const vscode = (globalThis as any).vscode;
		vscode.workspace.findFiles = async () => [
			{ fsPath: "/ws/src/b.ts" },
			{ fsPath: "/ws/src/a.ts" },
			{ fsPath: "/ws/node_modules/x.js" },
		];

		await handler.handle({ type: "get-workspace-files" });
		const msg = webviewMessages.find((m: any) => m.type === "workspace-files");
		assert.ok(msg);
		// node_modules should be filtered out
		assert.ok(!msg.data.files.some((f: string) => f.includes("node_modules")));
		// Should be sorted
		const files = msg.data.files;
		for (let i = 1; i < files.length; i++) {
			assert.ok(files[i] >= files[i - 1], "files should be sorted");
		}
	});

	test("get-workspace-files handles no workspace folders", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.workspace.workspaceFolders = undefined;

		await handler.handle({ type: "get-workspace-files" });
		const msg = webviewMessages.find((m: any) => m.type === "workspace-files");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.files, []);
	});

	// ── openFileAttachmentDialog ───────────────────────────────────────────

	test("openFileAttachmentDialog sends selected file paths", async () => {
		resetVscodeMocks();
		const vscode = (globalThis as any).vscode;
		vscode.window.showOpenDialog = async () => [{ fsPath: "/ws/src/main.ts" }];

		await handler.handle({ type: "openFileAttachmentDialog" });
		const msg = webviewMessages.find((m: any) => m.type === "files-attached");
		assert.ok(msg);
		assert.ok(msg.data.paths.length > 0);
	});

	test("openFileAttachmentDialog returns empty when cancelled", async () => {
		resetVscodeMocks();
		const vscode = (globalThis as any).vscode;
		vscode.window.showOpenDialog = async () => undefined;

		await handler.handle({ type: "openFileAttachmentDialog" });
		const msg = webviewMessages.find((m: any) => m.type === "files-attached");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.paths, []);
	});

	// ── apply-code ─────────────────────────────────────────────────────────

	test("apply-code replaces selection when selection exists", async () => {
		resetVscodeMocks();
		const replacedWith: string[] = [];
		(globalThis as any).vscode.window.activeTextEditor = {
			selection: {
				isEmpty: false,
				start: { line: 0, character: 0 },
				end: { line: 0, character: 5 },
			},
			edit: async (cb: any) => {
				const builder = {
					replace: (_sel: any, text: string) => replacedWith.push(text),
					insert: () => {},
				};
				cb(builder);
			},
			document: { languageId: "typescript" },
		};

		const result = await handler.handle({
			type: "apply-code",
			data: { code: "new code" },
		});
		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(replacedWith, ["new code"]);
	});

	test("apply-code inserts at cursor when no selection", async () => {
		resetVscodeMocks();
		const inserted: string[] = [];
		(globalThis as any).vscode.window.activeTextEditor = {
			selection: { isEmpty: true, active: { line: 1, character: 3 } },
			edit: async (cb: any) => {
				const builder = {
					replace: () => {},
					insert: (_pos: any, text: string) => inserted.push(text),
				};
				cb(builder);
			},
			document: { languageId: "typescript" },
		};

		const result = await handler.handle({
			type: "apply-code",
			data: { code: "inserted" },
		});
		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(inserted, ["inserted"]);
	});

	test("apply-code returns error when no editor", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.window.activeTextEditor = undefined;

		const result = await handler.handle({
			type: "apply-code",
			data: { code: "x" },
		});
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("No active editor"));
	});

	test("apply-code returns error when no code provided", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.window.activeTextEditor = {
			selection: { isEmpty: true },
			edit: async () => {},
			document: {},
		};

		const result = await handler.handle({
			type: "apply-code",
			data: { code: "" },
		});
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("No code provided"));
	});

	// ── preview-diff ───────────────────────────────────────────────────────

	test("preview-diff returns error when no editor", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.window.activeTextEditor = undefined;

		const result = await handler.handle({
			type: "preview-diff",
			data: { code: "x" },
		});
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("No active editor"));
	});

	test("preview-diff returns error when no code provided", async () => {
		resetVscodeMocks();
		(globalThis as any).vscode.window.activeTextEditor = {
			selection: { isEmpty: true },
			document: { getText: () => "original", fileName: "/test.ts" },
		};

		const result = await handler.handle({
			type: "preview-diff",
			data: { code: "" },
		});
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("No code provided"));
	});

	test("preview-diff creates temp file and opens diff", async () => {
		resetVscodeMocks();
		let diffCmd: string | undefined;
		let diffArgs: any[] = [];
		const vscode = (globalThis as any).vscode;
		vscode.commands.executeCommand = async (cmd: string, ...args: any[]) => {
			diffCmd = cmd;
			diffArgs = args;
		};
		vscode.workspace.fs.createDirectory = async () => {};
		vscode.workspace.fs.writeFile = async () => {};

		(globalThis as any).vscode.window.activeTextEditor = {
			selection: { isEmpty: true, active: { line: 0, character: 0 } },
			document: {
				getText: () => "old code",
				fileName: "/test.ts",
				offsetAt: (pos: any) => pos.line * 10 + pos.character,
			},
		};

		const result = await handler.handle({
			type: "preview-diff",
			data: { code: "new code" },
		});
		assert.strictEqual(result.success, true);
		assert.strictEqual(diffCmd, "vscode.diff");
		assert.ok(diffArgs.length >= 2, "diff command should have file URIs");
	});

	// ── ready sessionId ────────────────────────────────────────────────────

	test("ready includes sessionId when session exists", async () => {
		provider.session = { sessionId: "abc-123" };
		provider.hasSession = true;

		const result = await handler.handle({ type: "ready" });
		assert.strictEqual(result.sessionId, "abc-123");
	});

	test("ready includes undefined sessionId when no session", async () => {
		provider.session = undefined;
		provider.hasSession = false;

		const result = await handler.handle({ type: "ready" });
		assert.strictEqual(result.sessionId, undefined);
	});

	// ── setApiKey / removeAuth / getCurrentModel / getFavorites / open-in-editor ─

	test("setApiKey calls provider.setApiKey", async () => {
		const result = await handler.handle({
			type: "setApiKey",
			data: { provider: "openai", apiKey: "sk-test" },
		});
		assert.deepStrictEqual(provider.calls.setApiKey[0], ["openai", "sk-test"]);
		assert.strictEqual(result.success, true);
	});

	test("removeAuth calls provider.removeAuth", async () => {
		const result = await handler.handle({
			type: "removeAuth",
			data: { provider: "openai" },
		});
		assert.deepStrictEqual(provider.calls.removeAuth[0], ["openai"]);
		assert.strictEqual(result.success, true);
	});

	test("loginProvider routes to provider.loginProvider", async () => {
		const result = await handler.handle({
			type: "loginProvider",
			data: { provider: "anthropic" },
		});
		assert.deepStrictEqual(provider.calls.loginProvider[0], ["anthropic"]);
		assert.strictEqual(result.success, true);
	});

	test("loginProvider validates the provider payload", async () => {
		const result = await handler.handle({
			type: "loginProvider",
			data: {},
		});
		assert.ok(result.error, "missing provider should be rejected");
		assert.strictEqual(provider.calls.loginProvider, undefined);
	});

	test("loginProvider failure posts a string error to the webview", async () => {
		provider.loginProvider = () => Promise.reject(new Error("OAuth not supported"));
		const result = await handler.handle({
			type: "loginProvider",
			data: { provider: "anthropic" },
		});
		assert.strictEqual(result.success, true);
		await new Promise((r) => setImmediate(r));
		const msg = webviewMessages.find((m: any) => m.type === "provider-login-result");
		assert.ok(msg, "expected a provider-login-result message");
		assert.strictEqual(msg.data.success, false);
		assert.strictEqual(msg.data.error, "OAuth not supported");
	});

	test("cancelProviderLogin routes to provider.cancelProviderLogin", async () => {
		const result = await handler.handle({
			type: "cancelProviderLogin",
			data: { provider: "anthropic" },
		});
		assert.deepStrictEqual(provider.calls.cancelProviderLogin[0], ["anthropic"]);
		assert.strictEqual(result.success, true);
	});

	test("providerLoginPromptResponse routes value answers", async () => {
		const result = await handler.handle({
			type: "providerLoginPromptResponse",
			data: {
				provider: "anthropic",
				promptId: "login-prompt-1",
				value: "123-456",
			},
		});
		assert.deepStrictEqual(provider.calls.resolveLoginPrompt[0], [
			"anthropic",
			"login-prompt-1",
			"123-456",
			false,
		]);
		assert.strictEqual(result.success, true);
	});

	test("providerLoginPromptResponse routes cancellations", async () => {
		await handler.handle({
			type: "providerLoginPromptResponse",
			data: {
				provider: "anthropic",
				promptId: "login-prompt-2",
				cancelled: true,
			},
		});
		assert.deepStrictEqual(provider.calls.resolveLoginPrompt[0], [
			"anthropic",
			"login-prompt-2",
			undefined,
			true,
		]);
	});

	test("openLoginUrl routes http(s) URLs to provider.openExternalUrl", async () => {
		const result = await handler.handle({
			type: "openLoginUrl",
			data: { url: "https://auth.example/start" },
		});
		assert.deepStrictEqual(provider.calls.openExternalUrl[0], ["https://auth.example/start"]);
		assert.strictEqual(result.success, true);
	});

	test("openLoginUrl rejects non-http URLs", async () => {
		const result = await handler.handle({
			type: "openLoginUrl",
			data: { url: "file:///etc/passwd" },
		});
		assert.ok(result.error, "non-http URLs should be rejected");
		assert.strictEqual(provider.calls.openExternalUrl, undefined);
	});

	test("addProvider routes to provider.addProvider with config", async () => {
		const result = await handler.handle({
			type: "addProvider",
			data: { provider: "kilocode", name: "Kilo Code", baseUrl: "https://x" },
		});
		assert.deepStrictEqual(provider.calls.addProvider[0], [
			{
				provider: "kilocode",
				name: "Kilo Code",
				baseUrl: "https://x",
				apiKey: undefined,
				api: undefined,
				headers: undefined,
				models: undefined,
			},
		]);
		assert.strictEqual(result.success, true);
	});

	test("addProvider forwards models to provider.addProvider", async () => {
		const models = [{ id: "m1" }, { id: "m2", name: "M2" }];
		await handler.handle({
			type: "addProvider",
			data: { provider: "kilocode", models },
		});
		assert.deepStrictEqual(provider.calls.addProvider[0], [
			{
				provider: "kilocode",
				name: undefined,
				baseUrl: undefined,
				apiKey: undefined,
				api: undefined,
				headers: undefined,
				models,
			},
		]);
	});

	test("removeProvider routes to provider.removeProvider", async () => {
		const result = await handler.handle({
			type: "removeProvider",
			data: { provider: "kilocode" },
		});
		assert.deepStrictEqual(provider.calls.removeProvider[0], ["kilocode"]);
		assert.strictEqual(result.success, true);
	});

	test("fetchProviderModels routes to provider and posts correlated provider-models", async () => {
		provider.fetchProviderModels = async () => [{ id: "m1" }, { id: "m2", name: "M2" }];
		const result = await handler.handle({
			type: "fetchProviderModels",
			id: "req-fetch-1",
			data: { baseUrl: "https://x/v1", api: "openai-completions", apiKey: "k" },
		});
		assert.deepStrictEqual(provider.calls.fetchProviderModels[0], [
			{
				baseUrl: "https://x/v1",
				api: "openai-completions",
				apiKey: "k",
			},
		]);
		const posted = webviewMessages.find((m: any) => m.type === "provider-models");
		assert.ok(posted, "provider-models message posted to webview");
		assert.deepStrictEqual(posted.data.models, [{ id: "m1" }, { id: "m2", name: "M2" }]);
		assert.strictEqual(posted.data.requestId, "req-fetch-1");
		assert.strictEqual(result.success, true);
	});

	test("fetchProviderModels failure posts correlated error to webview", async () => {
		provider.fetchProviderModels = async () => {
			throw new Error("boom");
		};
		const result = await handler.handle({
			type: "fetchProviderModels",
			id: "req-fetch-2",
			data: { baseUrl: "https://x/v1" },
		});
		assert.strictEqual(result.error, "boom");
		const posted = webviewMessages.find(
			(m: any) => m.type === "error" && m.data?.requestId === "req-fetch-2",
		);
		assert.ok(posted, "correlated error posted to webview");
		assert.strictEqual(posted.data.message, "boom");
	});

	test("openConfigFile routes to provider.openConfigFile with file", async () => {
		const result = await handler.handle({
			type: "openConfigFile",
			data: { file: "models" },
		});
		assert.deepStrictEqual(provider.calls.openConfigFile[0], ["models"]);
		assert.strictEqual(result.success, true);
	});

	test("openConfigFile routes system-prompt file", async () => {
		const result = await handler.handle({
			type: "openConfigFile",
			data: { file: "system-prompt" },
		});
		assert.deepStrictEqual(provider.calls.openConfigFile[0], ["system-prompt"]);
		assert.strictEqual(result.success, true);
	});

	test("openConfigFile rejects invalid file", async () => {
		const result = await handler.handle({
			type: "openConfigFile",
			data: { file: "not-a-file" },
		});
		assert.ok(result.error, "expected error for invalid file");
		assert.strictEqual(provider.calls.openConfigFile, undefined);
	});

	test("getCurrentModel returns current model id", async () => {
		const result = await handler.handle({ type: "getCurrentModel" });
		assert.strictEqual(result, "model-a");
	});

	test("getFavorites returns favorites list", async () => {
		const result = await handler.handle({ type: "getFavorites" });
		assert.deepStrictEqual(result, []);
	});

	test("open-in-editor opens document when content provided", async () => {
		resetVscodeMocks();
		const vscode = (globalThis as any).vscode;
		vscode.workspace.openTextDocument = async (opts: any) => ({
			content: opts.content,
		});
		vscode.window.showTextDocument = async () => {};

		const result = await handler.handle({
			type: "open-in-editor",
			data: { content: "hello", language: "typescript" },
		});
		assert.strictEqual(result.success, true);
	});

	test("open-in-editor does nothing when no content", async () => {
		resetVscodeMocks();
		const result = await handler.handle({
			type: "open-in-editor",
			data: { content: "" },
		});
		assert.strictEqual(result.success, true);
	});

	// ── deleteSessions single session ──────────────────────────────────────

	test("deleteSessions single session shows single message", async () => {
		resetVscodeMocks();
		let warningMsg: string | undefined;
		const vscode = (globalThis as any).vscode;
		vscode.window.showWarningMessage = async (msg: string) => {
			warningMsg = msg;
			return "Delete";
		};

		await handler.handle({
			type: "deleteSessions",
			data: { sessionIds: ["s1"] },
		});
		assert.ok(warningMsg?.includes("this session"));
		assert.ok(provider.calls.deleteSessions.length > 0);
	});

	// ── commit-message model chooser contract ────────────────────────────────

	test("getCommitMessageModelState replies with the pin and the reported models in one message", async () => {
		provider.getCommitMessageModel = () => "anthropic/claude-haiku-4-5";

		await handler.handle({ type: "getCommitMessageModelState" });

		const reply = webviewMessages.find((m) => m.type === "commit-message-model-state");
		assert.ok(reply, "the settings tab needs a reply before it can render the chooser");
		assert.strictEqual(reply.data.model, "anthropic/claude-haiku-4-5");
		assert.deepStrictEqual(
			reply.data.models,
			[{ id: "model-a", provider: "prov", name: "Model A" }],
			"the chooser options come from the same round trip",
		);
	});

	test("the replied model list keeps only models that drafting can hand to the CLI", async () => {
		// The chooser must not offer an identifier that would be ignored at draft
		// time. On a POSIX host that means almost everything survives — including
		// the spaced ids the CLI actually reports — and only over-long values are
		// dropped. The Windows-unquotable characters are covered by the guard suite.
		provider.getAvailableModels = async () => [
			{ id: "model-a", provider: "prov", name: "Model A" },
			{ id: "vendor/model+build", provider: "prov", name: "Plussed" },
			{ id: "Bitfrost/Kilo Code/aion-2.0", provider: "prov", name: "Spaced" },
			{ id: "a".repeat(220), provider: "prov", name: "Oversized" },
		];

		await handler.handle({ type: "getCommitMessageModelState" });

		const reply = webviewMessages.find((m) => m.type === "commit-message-model-state");
		assert.deepStrictEqual(
			reply.data.models.map((m: { id: string }) => m.id),
			["model-a", "vendor/model+build", "Bitfrost/Kilo Code/aion-2.0"],
		);
	});

	test("setCommitMessageModel persists a plain provider/id", async () => {
		const result = await handler.handle({
			type: "setCommitMessageModel",
			data: { model: "anthropic/claude-haiku-4-5" },
		});

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(provider.calls.setCommitMessageModel, [
			["anthropic/claude-haiku-4-5"],
		]);
	});

	test("setCommitMessageModel clears the pin when given the empty string", async () => {
		await handler.handle({ type: "setCommitMessageModel", data: { model: "" } });

		assert.deepStrictEqual(provider.calls.setCommitMessageModel, [[""]]);
	});

	// The persisted value reaches a `shell: true` child as a `--model` argument,
	// and the setting can be supplied by a repository. Values that cannot be made a
	// literal argument on this platform are refused at the boundary rather than
	// stored and validated later, if at all; the unconditionally unpresentable case
	// is an over-long value.
	test("setCommitMessageModel refuses an unquotable value and does not persist it", async () => {
		const result = await handler.handle({
			type: "setCommitMessageModel",
			data: { model: "anthropic/" + "a".repeat(220) },
		});

		assert.ok(result.error);
		assert.strictEqual(provider.calls.setCommitMessageModel, undefined);
	});

	// A value carrying shell syntax is no longer refused for that reason alone: it
	// is quoted at the drafting call, which makes it literal text. Rejecting it here
	// would also reject the spaced identifiers the CLI reports, which is what an
	// earlier character allowlist did — and that emptied the chooser.
	test("setCommitMessageModel accepts a value the drafting call can quote, including shell syntax", async () => {
		for (const value of [
			"anthropic/claude-haiku-4-5",
			"Bitfrost/Kilo Code/aion-labs/aion-2.0",
			"anthropic/x; touch /tmp/INJECTED",
		]) {
			provider.calls.setCommitMessageModel = undefined;
			const result = await handler.handle({
				type: "setCommitMessageModel",
				data: { model: value },
			});

			assert.strictEqual(result.success, true, `must accept: ${value}`);
			assert.deepStrictEqual(provider.calls.setCommitMessageModel, [[value]]);
		}
	});

	test("setCommitMessageModel refuses non-string values", async () => {
		const result = await handler.handle({
			type: "setCommitMessageModel",
			data: { model: { toString: () => "anthropic/x" } },
		});

		assert.ok(result.error);
		assert.strictEqual(provider.calls.setCommitMessageModel, undefined);
	});
});
