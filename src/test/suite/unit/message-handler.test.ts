import * as assert from "node:assert";
import * as vscode from "vscode";
import { MessageHandler } from "../../../message-handler.js";
import type { ProviderApi } from "../../../protocol/types.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

function createMockProvider(): {
	provider: ProviderApi & { calls: Record<string, unknown[][]> };
	webviewMessages: any[];
} {
	const calls: Record<string, unknown[][]> = {};
	const webviewMessages: any[] = [];

	const makeSpy = (name: string, impl: (...args: unknown[]) => unknown = () => undefined) => {
		return (...args: unknown[]) => {
			calls[name] = calls[name] || [];
			calls[name].push(args);
			return impl(...args);
		};
	};

	const webview = {
		postMessage: (msg: any) => {
			webviewMessages.push(msg);
		},
	};

	const provider: any = {
		webview,
		hasSession: false,
		prompt: makeSpy("prompt"),
		newSession: makeSpy("newSession"),
		switchSession: makeSpy("switchSession"),
		forkSession: makeSpy("forkSession"),
		navigateTree: makeSpy("navigateTree"),
		setSessionName: makeSpy("setSessionName"),
		setModel: makeSpy("setModel"),
		setThinkingLevel: makeSpy("setThinkingLevel"),
		steer: makeSpy("steer"),
		followUp: makeSpy("followUp"),
		abort: makeSpy("abort"),
		compact: makeSpy("compact"),
		getContextUsage: makeSpy("getContextUsage"),
		getSessionStats: makeSpy("getSessionStats"),
		getAutoCompactionEnabled: makeSpy("getAutoCompactionEnabled", () => false),
		setAutoCompactionEnabled: makeSpy("setAutoCompactionEnabled"),
		getAutoContext: makeSpy("getAutoContext", () => false),
		setAutoContext: makeSpy("setAutoContext"),
		getAvailableModels: makeSpy("getAvailableModels", async () => [
			{ id: "model-a", provider: "prov", name: "Model A" },
		]),
		getCurrentModelId: makeSpy("getCurrentModelId", () => "model-a"),
		getExtensionVersion: makeSpy("getExtensionVersion", () => "1.0.0"),
		getPiCliVersion: makeSpy("getPiCliVersion", async () => "0.1.0"),
		isBinaryAvailable: makeSpy("isBinaryAvailable", () => true),
		getThinkingLevel: makeSpy("getThinkingLevel", () => "medium"),
		getFavorites: makeSpy("getFavorites", () => []),
		getProviderAuthData: makeSpy("getProviderAuthData", async () => []),
		setApiKey: makeSpy("setApiKey"),
		removeAuth: makeSpy("removeAuth"),
		toggleFavorite: makeSpy("toggleFavorite", async () => []),
		listSessions: makeSpy("listSessions", async () => []),
		getSettings: makeSpy("getSettings", async () => ({ toolPreset: "default", customTools: [] })),
		setToolConfig: makeSpy("setToolConfig"),
		listPackages: makeSpy("listPackages", async () => []),
		installPackage: makeSpy("installPackage"),
		uninstallPackage: makeSpy("uninstallPackage"),
		updatePackages: makeSpy("updatePackages"),
		toggleVoiceCapture: makeSpy("toggleVoiceCapture"),
		sendSessionResources: makeSpy("sendSessionResources"),
		logDebug: makeSpy("logDebug"),
		logError: makeSpy("logError"),
		deleteSessions: makeSpy("deleteSessions"),
		editMessage: makeSpy("editMessage"),
		getSkillDiscovery: makeSpy("getSkillDiscovery", () => false),
		setSkillDiscovery: makeSpy("setSkillDiscovery"),
		setExtraSkillPaths: makeSpy("setExtraSkillPaths"),
		getExtraSkillPaths: makeSpy("getExtraSkillPaths", () => []),
		sendSkillsList: makeSpy("sendSkillsList"),
	};

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
		const result = await handler.handle({ type: "prompt", id: "msg-1", data: { text: "hello" } });
		assert.strictEqual(provider.calls.prompt.length, 1);
		assert.deepStrictEqual(provider.calls.prompt[0], ["hello", undefined]);
		const response = webviewMessages.find((m: any) => m.id === "msg-1");
		assert.ok(response, "expected response with matching id");
		assert.strictEqual(result.success, true);
	});

	test("prompt error - posts error to webview and re-throws", async () => {
		const err = new Error("prompt failed");
		provider.prompt = () => Promise.reject(err);
		let caught: any;
		try {
			await handler.handle({ type: "prompt", id: "msg-1", data: { text: "hello" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught, "expected error to be re-thrown");
		assert.strictEqual(caught.message, "prompt failed");
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "newSession", data: {} });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
		assert.strictEqual(caught.message, "new session failed");
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("exportSession html", async () => {
		provider.prompt = () => Promise.resolve();
		const result = await handler.handle({ type: "exportSession", data: { format: "html" } });
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
		await handler.handle({ type: "exportSession", data: { format: "markdown" } });
		assert.deepStrictEqual(provider.calls.prompt[0], ["/export .md"]);
	});

	test("exportSession error - sends error exportResult", async () => {
		const err = new Error("export failed");
		provider.prompt = () => Promise.reject(err);
		const result = await handler.handle({ type: "exportSession", data: { format: "html" } });
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("export failed"));
		const exportMsg = webviewMessages.find((m: any) => m.type === "exportResult");
		assert.ok(exportMsg);
		assert.strictEqual(exportMsg.data.success, false);
	});

	test("switchSession success", async () => {
		provider.switchSession = () => Promise.resolve();
		const result = await handler.handle({ type: "switchSession", data: { sessionId: "s1" } });
		assert.deepStrictEqual(provider.calls.switchSession[0], ["s1"]);
		assert.strictEqual(result.success, true);
	});

	test("switchSession error - posts error and re-throws", async () => {
		const err = new Error("switch failed");
		provider.switchSession = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "switchSession", data: { sessionId: "s1" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
		assert.strictEqual(caught.message, "switch failed");
	});

	test("setSessionName success", async () => {
		provider.setSessionName = () => Promise.resolve();
		const result = await handler.handle({ type: "setSessionName", data: { name: "new-name" } });
		assert.deepStrictEqual(provider.calls.setSessionName[0], ["new-name"]);
		assert.strictEqual(result.success, true);
	});

	test("setSessionName error - posts error and re-throws", async () => {
		const err = new Error("rename failed");
		provider.setSessionName = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "setSessionName", data: { name: "x" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("switchModel success", async () => {
		provider.setModel = () => Promise.resolve();
		const result = await handler.handle({ type: "switchModel", data: { modelId: "m1" } });
		assert.deepStrictEqual(provider.calls.setModel[0], ["m1"]);
		assert.strictEqual(result.success, true);
	});

	test("switchModel error - posts error and re-throws", async () => {
		const err = new Error("model failed");
		provider.setModel = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "switchModel", data: { modelId: "m1" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
		assert.ok(webviewMessages.some((m: any) => m.type === "error"));
	});

	test("setThinkingLevel success", async () => {
		provider.setThinkingLevel = () => Promise.resolve();
		const result = await handler.handle({ type: "setThinkingLevel", data: { level: "high" } });
		assert.deepStrictEqual(provider.calls.setThinkingLevel[0], ["high"]);
		assert.strictEqual(result.success, true);
	});

	test("setThinkingLevel error - posts error and re-throws", async () => {
		const err = new Error("thinking level failed");
		provider.setThinkingLevel = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "setThinkingLevel", data: { level: "low" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("steer success", async () => {
		provider.steer = () => Promise.resolve();
		const result = await handler.handle({ type: "steer", data: { text: "be concise" } });
		assert.deepStrictEqual(provider.calls.steer[0], ["be concise"]);
		assert.strictEqual(result.success, true);
	});

	test("steer error - posts error and re-throws", async () => {
		const err = new Error("steer failed");
		provider.steer = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "steer", data: { text: "x" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("followUp success", async () => {
		provider.followUp = () => Promise.resolve();
		const result = await handler.handle({ type: "followUp", data: { text: "more" } });
		assert.deepStrictEqual(provider.calls.followUp[0], ["more"]);
		assert.strictEqual(result.success, true);
	});

	test("followUp error - posts error and re-throws", async () => {
		const err = new Error("follow up failed");
		provider.followUp = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "followUp", data: { text: "x" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "abort", data: {} });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "compact", data: {} });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "edit-message", data: { index: 0, text: "x" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({
				type: "forkSession",
				data: { entryId: "entry-1" },
			});
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({
				type: "setToolConfig",
				data: { toolPreset: "custom", customTools: [] },
			});
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("installPackage success", async () => {
		provider.installPackage = () => Promise.resolve();
		provider.listPackages = () => Promise.resolve([{ source: "skill-a" }]);
		const result = await handler.handle({ type: "installPackage", data: { source: "skill-a" } });
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "installPackage", data: { source: "skill-a" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("uninstallPackage success", async () => {
		provider.uninstallPackage = () => Promise.resolve();
		provider.listPackages = () => Promise.resolve([]);
		const result = await handler.handle({ type: "uninstallPackage", data: { source: "skill-a" } });
		assert.deepStrictEqual(provider.calls.uninstallPackage[0], ["skill-a"]);
		assert.strictEqual(result.success, true);
	});

	test("uninstallPackage error - posts error and re-throws", async () => {
		const err = new Error("uninstall failed");
		provider.uninstallPackage = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "uninstallPackage", data: { source: "skill-a" } });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
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
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "updateResources", data: {} });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("toggle-voice-capture success", async () => {
		provider.toggleVoiceCapture = () => Promise.resolve();
		const result = await handler.handle({ type: "toggle-voice-capture", data: {} });
		assert.ok(provider.calls.toggleVoiceCapture.length > 0);
		assert.strictEqual(result.success, true);
	});

	test("toggle-voice-capture error - posts error and re-throws", async () => {
		const err = new Error("voice failed");
		provider.toggleVoiceCapture = () => Promise.reject(err);
		let caught: Error | undefined;
		try {
			await handler.handle({ type: "toggle-voice-capture", data: {} });
		} catch (e) {
			caught = e as Error;
		}
		assert.ok(caught);
	});

	test("getModels - fetches models and posts models-updated", async () => {
		provider.getAvailableModels = () => Promise.resolve([{ id: "m1", provider: "p", name: "M1" }]);
		const result = await handler.handle({ type: "getModels", data: {} });
		assert.deepStrictEqual(result, [{ id: "m1", provider: "p", name: "M1" }]);
		const msg = webviewMessages.find((m: any) => m.type === "models-updated");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.models, [{ id: "m1", provider: "p", name: "M1" }]);
	});

	test("getProviderAuth - returns auth and sends provider-auth", async () => {
		provider.getProviderAuthData = () => Promise.resolve([{ provider: "openai", configured: true }]);
		const result = await handler.handle({ type: "getProviderAuth", data: {} });
		assert.deepStrictEqual(result, [{ provider: "openai", configured: true }]);
		const msg = webviewMessages.find((m: any) => m.type === "provider-auth");
		assert.ok(msg);
		assert.strictEqual(msg.data[0].provider, "openai");
	});

	test("toggleFavorite success", async () => {
		provider.toggleFavorite = () => Promise.resolve(["model-a"]);
		const result = await handler.handle({ type: "toggleFavorite", data: { modelId: "m1", isFavorite: true } });
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
		const result = await handler.handle({ type: "getSessionResources", data: {} });
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
		const result = await handler.handle({ type: "getSkillDiscovery", data: {} });
		assert.strictEqual(result, true);
		const msg = webviewMessages.find((m: any) => m.type === "skill-discovery-changed");
		assert.ok(msg);
		assert.strictEqual(msg.data.enabled, true);
	});

	test("setSkillDiscovery - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setSkillDiscovery = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({ type: "setSkillDiscovery", data: { enabled: true } });
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
		const result = await handler.handle({ type: "getExtraSkillPaths", data: {} });
		assert.deepStrictEqual(result, ["/skill-a"]);
		const msg = webviewMessages.find((m: any) => m.type === "extra-skill-paths");
		assert.ok(msg);
		assert.deepStrictEqual(msg.data.paths, ["/skill-a"]);
	});

	test("getAutoCompactionStatus - returns value", async () => {
		provider.getAutoCompactionEnabled = () => true;
		const result = await handler.handle({ type: "getAutoCompactionStatus", data: {} });
		assert.strictEqual(result, true);
	});

	test("setAutoCompaction - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setAutoCompactionEnabled = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({ type: "setAutoCompaction", data: { enabled: true } });
		assert.strictEqual(lastEnabled, true);
		assert.strictEqual(result.success, true);
	});

	test("setAutoContext - returns success", async () => {
		let lastEnabled: boolean | undefined;
		provider.setAutoContext = (enabled: boolean) => {
			lastEnabled = enabled;
		};
		const result = await handler.handle({ type: "setAutoContext", data: { enabled: false } });
		assert.strictEqual(lastEnabled, false);
		assert.strictEqual(result.success, true);
	});

	test("deleteSessions with empty ids - returns skipped", async () => {
		const result = await handler.handle({ type: "deleteSessions", data: { sessionIds: [] } });
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.skipped, true);
	});

	test("deleteSessions cancelled by user - returns cancelled", async () => {
		resetVscodeMocks();
		(vscode.window.showWarningMessage as any) = async () => "Cancel";
		const result = await handler.handle({ type: "deleteSessions", data: { sessionIds: ["s1"] } });
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.cancelled, true);
		assert.ok(!provider.calls.deleteSessions.length, "deleteSessions should not be called");
	});

	test("deleteSessions success", async () => {
		resetVscodeMocks();
		(vscode.window.showWarningMessage as any) = async () => "Delete";
		provider.deleteSessions = () => Promise.resolve();
		const result = await handler.handle({ type: "deleteSessions", data: { sessionIds: ["s1"] } });
		assert.strictEqual(result.success, true);
		assert.ok(provider.calls.deleteSessions.length > 0);
	});

	test("showRenameSessionDialog cancelled", async () => {
		resetVscodeMocks();
		(vscode.window.showInputBox as any) = async () => null;
		const result = await handler.handle({ type: "showRenameSessionDialog", data: {} });
		assert.strictEqual(result.cancelled, true);
		assert.ok(!provider.calls.setSessionName.length, "setSessionName should not be called");
	});

	test("showRenameSessionDialog success", async () => {
		resetVscodeMocks();
		(vscode.window.showInputBox as any) = async () => "new-name";
		provider.setSessionName = () => Promise.resolve();
		const result = await handler.handle({ type: "showRenameSessionDialog", data: {} });
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
		await handler.handle({ type: "prompt", id: "req-123", data: { text: "hi" } });
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
});
