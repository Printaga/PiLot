// ── Unit tests for commands ────────────────────────────────────────────────

import * as assert from "node:assert";
import * as vscode from "vscode";
import { registerCommands } from "../../../commands/index.js";
import {
	logDiagnostics,
	setDiagnosticsEnabled,
	resetDiagnosticsStateForTests,
	getDiagnosticsBuffer,
} from "../../../commands/diagnostics.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

suite("commands: logDiagnostics", () => {
	setup(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	teardown(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	test("is a no-op when diagnostics are disabled", () => {
		resetDiagnosticsStateForTests();
		setDiagnosticsEnabled(false);

		const lenBefore = getDiagnosticsBuffer().length;
		logDiagnostics("test message");
		assert.strictEqual(getDiagnosticsBuffer().length, lenBefore);
	});

	test("appends message to buffer when enabled", () => {
		resetDiagnosticsStateForTests();
		setDiagnosticsEnabled(true);

		const lenBefore = getDiagnosticsBuffer().length;
		logDiagnostics("hello world");

		const buffer = getDiagnosticsBuffer();
		assert.strictEqual(buffer.length, lenBefore + 1);
		assert.ok(buffer[buffer.length - 1].includes("hello world"));
	});

	test("appends arg lines when args are provided", () => {
		resetDiagnosticsStateForTests();
		setDiagnosticsEnabled(true);

		logDiagnostics("with args", 42, { foo: "bar" });

		const buffer = getDiagnosticsBuffer();
		assert.ok(buffer.some((line: string) => line.includes("42")));
		assert.ok(
			buffer.some((line: string) => line.includes('"foo"') || line.includes('foo')),
		);
	});

	test("logs confirmation message when enabled", () => {
		resetDiagnosticsStateForTests();
		setDiagnosticsEnabled(true);

		const buffer = getDiagnosticsBuffer();
		assert.ok(
			buffer.some((line: string) =>
				line.includes("Diagnostics logging enabled"),
			),
		);
	});
});

suite("commands: setDiagnosticsEnabled", () => {
	setup(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	teardown(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	test("enabling logs a confirmation", () => {
		setDiagnosticsEnabled(true);
		const buffer = getDiagnosticsBuffer();
		assert.ok(
			buffer.some((line: string) =>
				line.includes("Diagnostics logging enabled"),
			),
		);
	});

	test("disabling does not add confirmation message", () => {
		setDiagnosticsEnabled(true);
		resetDiagnosticsStateForTests();
		setDiagnosticsEnabled(false);
		const buffer = getDiagnosticsBuffer();
		assert.ok(
			!buffer.some((line: string) =>
				line.includes("Diagnostics logging enabled"),
			),
		);
	});
});

suite("commands: registerCommands", () => {
	setup(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	teardown(() => {
		resetVscodeMocks();
		resetDiagnosticsStateForTests();
	});

	test("registers multiple commands", () => {
		const registeredCommands: string[] = [];
		(vscode.commands as any).registerCommand = (id: string) => {
			registeredCommands.push(id);
			return { dispose: () => {} };
		};

		registerCommands(
			{
				subscriptions: [],
				globalState: {
					get: <T>(_key: string, defaultValue: T): T => defaultValue,
					update: async () => {},
				},
				workspaceState: {
					get: <T>(_key: string, defaultValue: T): T => defaultValue,
					update: async () => {},
				},
				extensionUri: vscode.Uri.file("/fake"),
				storagePath: "",
				globalStoragePath: "",
				logPath: "",
			} as any,
			{
				notifyWebviewFromCommand: () => {},
				prompt: async () => {},
				cycleModel: async () => {},
				cycleThinkingLevel: async () => {},
				openCurrentSessionInEditor: async () => {},
				newChatInEditor: async () => {},
				rebuildNativeAddons: async () => {},
				installPackage: async () => {},
				uninstallPackage: async () => {},
				updatePackages: async () => {},
				deleteSessions: async () => {},
				navigateTree: async () => {},
				getLightMode: () => false,
				setLightMode: async () => {},
			} as any,
		);

		assert.ok(
			registeredCommands.includes("pi-agent.explainCode"),
			"expected explainCode command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.refactorCode"),
			"expected refactorCode command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.analyzeProject"),
			"expected analyzeProject command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.toggleVoiceCapture"),
			"expected toggleVoiceCapture command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.searchChat"),
			"expected searchChat command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.checkForUpdates"),
			"expected checkForUpdates command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.showDiagnosticsLog"),
			"expected showDiagnosticsLog command to be registered",
		);
		assert.ok(
			registeredCommands.includes("pi-agent.exportDiagnosticsLog"),
			"expected exportDiagnosticsLog command to be registered",
		);
	});

	test("initialize diagnostics state from config", () => {
		const configCalls: any[] = [];
		(vscode.workspace as any).getConfiguration = () => ({
			get: (key: string, defaultValue?: any) => {
				configCalls.push(key);
				return defaultValue;
			},
			update: async () => {},
		});

		resetDiagnosticsStateForTests();
		registerCommands(
			{
				subscriptions: [],
				globalState: {
					get: <T>(_key: string, defaultValue: T): T => defaultValue,
					update: async () => {},
				},
				workspaceState: {
					get: <T>(_key: string, defaultValue: T): T => defaultValue,
					update: async () => {},
				},
				extensionUri: vscode.Uri.file("/fake"),
				storagePath: "",
				globalStoragePath: "",
				logPath: "",
			} as any,
			{
				notifyWebviewFromCommand: () => {},
				prompt: async () => {},
				cycleModel: async () => {},
				cycleThinkingLevel: async () => {},
				openCurrentSessionInEditor: async () => {},
				newChatInEditor: async () => {},
				rebuildNativeAddons: async () => {},
				installPackage: async () => {},
				uninstallPackage: async () => {},
				updatePackages: async () => {},
				deleteSessions: async () => {},
				navigateTree: async () => {},
				getLightMode: () => false,
				setLightMode: async () => {},
			} as any,
		);

		assert.ok(
			configCalls.includes("diagnostics.enabled"),
			"expected diagnostics config to be read during registration",
		);
	});
});

suite("commands: light mode toggle & status bar", () => {
	// NOTE: deliberately does NOT call resetVscodeMocks(): that helper
	// reassigns vscode.workspace.fs.createDirectory, which throws under the
	// frozen-module race that breaks other suites' hooks. This suite only
	// overrides what it needs and restores it in teardown.
	let savedCreateStatusBarItem: any;
	const statusItems: any[] = [];
	const registeredCommands = new Map<string, () => void>();
	const configStore = new Map<string, any>([["lightMode", false]]);
	const configEmitter = new (vscode.EventEmitter as any)();

	setup(() => {
		statusItems.length = 0;
		registeredCommands.clear();
		configStore.clear();
		configStore.set("lightMode", false);

		savedCreateStatusBarItem = (vscode.window as any).createStatusBarItem;
		(vscode.window as any).createStatusBarItem = () => {
			const item: any = {
				text: "",
				tooltip: undefined,
				command: undefined,
				shown: false,
				show() {
					this.shown = true;
				},
				hide() {
					this.shown = false;
				},
				dispose() {},
			};
			statusItems.push(item);
			return item;
		};
		(vscode.commands as any).registerCommand = (id: string, fn: () => void) => {
			registeredCommands.set(id, fn);
			return { dispose: () => {} };
		};
		(vscode.workspace as any).getConfiguration = () => ({
			get: (key: string, defaultValue?: any) =>
				configStore.has(key) ? configStore.get(key) : defaultValue,
			update: async (key: string, value: any) => {
				configStore.set(key, value);
				configEmitter.fire({
					affectsConfiguration: (section: string) =>
						section === "pi-agent" ||
						section.startsWith(`pi-agent.${key}`),
				});
			},
		});
		(vscode.workspace as any).onDidChangeConfiguration =
			configEmitter.event;
	});

	teardown(() => {
		(vscode.window as any).createStatusBarItem = savedCreateStatusBarItem;
	});

	function makeProvider(overrides: Record<string, any> = {}) {
		return {
			getLightMode: () => configStore.get("lightMode") ?? false,
			setLightMode: async (enabled: boolean) => {
				const config = (vscode.workspace as any).getConfiguration();
				await config.update("lightMode", enabled);
			},
			...overrides,
		} as any;
	}

	function makeContext() {
		return {
			subscriptions: [] as any[],
			globalState: {
				get: <T>(_key: string, defaultValue: T): T => defaultValue,
				update: async () => {},
			},
			workspaceState: {
				get: <T>(_key: string, defaultValue: T): T => defaultValue,
				update: async () => {},
			},
			extensionUri: vscode.Uri.file("/fake"),
			storagePath: "",
			globalStoragePath: "",
			logPath: "",
		} as any;
	}

	test("registers pi-agent.toggleLightMode", () => {
		registerCommands(makeContext(), makeProvider());

		assert.ok(
			registeredCommands.has("pi-agent.toggleLightMode"),
			"expected toggleLightMode to be registered",
		);
	});

	test("status bar item starts hidden when light mode is off", () => {
		registerCommands(makeContext(), makeProvider());

		assert.strictEqual(statusItems.length, 1);
		assert.strictEqual(statusItems[0].shown, false);
	});

	test("toggling on shows the status item; toggling off hides it", async () => {
		registerCommands(makeContext(), makeProvider());
		const toggle = registeredCommands.get("pi-agent.toggleLightMode")!;
		const item = statusItems[0];

		await toggle();
		assert.strictEqual(configStore.get("lightMode"), true);
		assert.strictEqual(item.shown, true);
		assert.ok(item.text.includes("Light"));

		await toggle();
		assert.strictEqual(configStore.get("lightMode"), false);
		assert.strictEqual(item.shown, false);
	});

	test("status bar re-syncs when light mode changes from the settings UI", async () => {
		registerCommands(makeContext(), makeProvider());
		const item = statusItems[0];

		// Flip the config directly (VS Code settings UI path): the config
		// store fires the change event, which must re-sync the status item.
		await (vscode.workspace as any)
			.getConfiguration()
			.update("lightMode", true);

		assert.strictEqual(item.shown, true);
		assert.ok(item.text.includes("Light"));
	});
});
