// ── Unit tests for commands ────────────────────────────────────────────────

import * as assert from "node:assert";
import * as vscode from "vscode";
import {
	logDiagnostics,
	setDiagnosticsEnabled,
	registerCommands,
	resetDiagnosticsStateForTests,
	getDiagnosticsBuffer,
} from "../../../commands/index.js";
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
			} as any,
		);

		assert.ok(
			configCalls.includes("diagnostics.enabled"),
			"expected diagnostics config to be read during registration",
		);
	});
});
