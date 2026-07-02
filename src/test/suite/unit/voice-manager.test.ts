// ── Unit tests for voice-manager ──────────────────────────────────────────

import * as assert from "node:assert";
import * as events from "node:events";
import * as fs from "node:fs";
import * as vscode from "vscode";
import {
	VoiceManager,
	type VoiceManagerDeps,
	voiceManagerInternals,
} from "../../../voice-manager.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

function createMockDeps(overrides: Partial<VoiceManagerDeps> = {}): VoiceManagerDeps {
	return {
		extensionUri: vscode.Uri.file("/fake/extension"),
		agentDir: "/fake/agent",
		logDebug: () => {},
		logError: () => {},
		notifyWebview: () => {},
		...overrides,
	};
}

function createMockProcess(): any {
	const stdoutHandlers: ((chunk: Buffer) => void)[] = [];
	const stderrHandlers: ((chunk: Buffer) => void)[] = [];
	const errorHandlers: ((err: Error) => void)[] = [];
	const closeHandlers: ((code: number | null) => void)[] = [];

	const mock = {
		stdin: {
			write: () => {},
			end: () => {},
		},
		stdout: new (events.EventEmitter as any)(),
		stderr: new (events.EventEmitter as any)(),
		on: (event: string, handler: (...args: any[]) => void) => {
			if (event === "error") {
				errorHandlers.push(handler as (err: Error) => void);
			}
			if (event === "close") {
				closeHandlers.push(handler as (code: number | null) => void);
			}
			return mock;
		},
		killed: false,
	};

	mock.stdout.on("data", (chunk: Buffer) => {
		for (const h of stdoutHandlers) h(chunk);
	});
	mock.stderr.on("data", (chunk: Buffer) => {
		for (const h of stderrHandlers) h(chunk);
	});

	return {
		...mock,
		emitStdout: (text: string) => mock.stdout.emit("data", Buffer.from(text)),
		emitStderr: (text: string) => mock.stderr.emit("data", Buffer.from(text)),
		emitError: (err: Error) => {
			for (const h of errorHandlers) h(err);
		},
		emitClose: (code: number | null) => {
			for (const h of closeHandlers) h(code);
		},
	};
}

suite("VoiceManager", () => {
	let originalSpawn: typeof voiceManagerInternals.spawn;
	let originalAccessSync: typeof fs.accessSync;
	let originalExistsSync: typeof fs.existsSync;
	let originalStatSync: typeof fs.statSync;
	let notifyCalls: any[];
	let mockProcess: any;

	setup(() => {
		notifyCalls = [];
		mockProcess = createMockProcess();

		originalSpawn = voiceManagerInternals.spawn;
		voiceManagerInternals.spawn = () => mockProcess as any;

		originalAccessSync = (fs as any).accessSync;
		(fs as any).accessSync = () => {};

		originalExistsSync = (fs as any).existsSync;
		(fs as any).existsSync = () => true;

		originalStatSync = (fs as any).statSync;
		(fs as any).statSync = () => ({ size: 10 * 1024 * 1024 } as fs.Stats);

		resetVscodeMocks();
	});

	teardown(() => {
		voiceManagerInternals.spawn = originalSpawn;
		(fs as any).accessSync = originalAccessSync;
		(fs as any).existsSync = originalExistsSync;
		(fs as any).statSync = originalStatSync;
		notifyCalls = [];
		mockProcess = null;
	});

	suite("VoiceManagerDeps", () => {
		test("accepts a conforming deps object", () => {
			const deps: VoiceManagerDeps = createMockDeps();
			const manager = new VoiceManager(deps);
			assert.ok(manager);
		});
	});

	suite("listening getter", () => {
		test("returns false before capture starts", () => {
			const manager = new VoiceManager(
				createMockDeps({
					notifyWebview: (msg: any) => notifyCalls.push(msg),
				}),
			);
			assert.strictEqual(manager.listening, false);
		});
	});

	suite("toggleVoiceCapture", () => {
	test("shows info message and does not spawn when voice is disabled", async () => {
		const infoMessages: string[] = [];
			(vscode.window as any).showInformationMessage = async (msg: string) => {
				infoMessages.push(msg);
				return msg;
			};
			(vscode.workspace as any).getConfiguration = () =>
				({
					get: (_key: string, defaultValue?: any) => {
						if (_key === "voice.enabled") return false;
						return defaultValue;
					},
					update: async () => {},
				}) as unknown as vscode.WorkspaceConfiguration;

			const manager = new VoiceManager(
				createMockDeps({
					notifyWebview: (msg: any) => notifyCalls.push(msg),
				}),
			);

			await manager.toggleVoiceCapture();

			assert.strictEqual(manager.listening, false);
			assert.ok(
				infoMessages.some((m: string) => m.includes("Voice dictation is disabled")),
			);
		});

	test("starts capture when stopped", async () => {
		const spawnArgs: any[][] = [];
			voiceManagerInternals.spawn = (...args: any[]) => {
				spawnArgs.push(args);
				return mockProcess as any;
			};

			const manager = new VoiceManager(
				createMockDeps({
					notifyWebview: (msg: any) => notifyCalls.push(msg),
				}),
			);

			assert.strictEqual(manager.listening, false);
			await manager.toggleVoiceCapture();

			assert.strictEqual(spawnArgs.length, 1);
			assert.strictEqual(spawnArgs[0][1][0], "--model");
			assert.ok(spawnArgs[0][1][1].includes("voice-models"));

			mockProcess.emitStdout(JSON.stringify({ type: "started" }) + "\n");
			assert.strictEqual(manager.listening, true);
			assert.ok(
				notifyCalls.some(
					(c: any) =>
						c.type === "voice-listening-changed" &&
						c.data.listening === true,
				),
			);
		});

		test("stops capture when already listening", async () => {
			const manager = new VoiceManager(
				createMockDeps({
					notifyWebview: (msg: any) => notifyCalls.push(msg),
				}),
			);

			await manager.toggleVoiceCapture();
			mockProcess.emitStdout(JSON.stringify({ type: "started" }) + "\n");
			assert.strictEqual(manager.listening, true);

			notifyCalls.length = 0;
			await manager.toggleVoiceCapture();

			assert.strictEqual(manager.listening, false);
			assert.ok(
				notifyCalls.some(
					(c: any) =>
						c.type === "voice-listening-changed" &&
						c.data.listening === false,
				),
			);
		});
	});

	suite("dispose", () => {
		test("terminates the helper process and resets state", () => {
			let killed = false;
			const processMock = {
				stdin: { write: () => {}, end: () => {} },
				on: () => ({}) as any,
				kill: () => {
					killed = true;
				},
			};

			const manager = new VoiceManager(createMockDeps());
			Object.defineProperty(manager, "voiceHelperProcess", {
				value: processMock,
				writable: true,
			});
			Object.defineProperty(manager, "isListening", {
				value: true,
				writable: true,
			});
			Object.defineProperty(manager, "voiceLineBuffer", {
				value: "partial-transcript",
				writable: true,
			});

			manager.dispose();

			assert.strictEqual(killed, true);
			assert.strictEqual(manager.listening, false);
			assert.strictEqual((manager as any).voiceLineBuffer, "");
			assert.strictEqual((manager as any).voiceHelperProcess, undefined);
		});
	});
});
