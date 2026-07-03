import * as assert from "node:assert";
import {
	ExtensionUIContext,
	type ExtensionUIContextDeps,
} from "../../../extension-ui-context.js";
import {
	createSessionMock,
	createExtensionRunnerMock,
} from "../../mocks/session-mock.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockDeps(
	overrides?: Partial<ExtensionUIContextDeps>,
): ExtensionUIContextDeps & {
	_webviewMessages: Array<{ type: string; data?: unknown }>;
	_debugLogs: string[];
	_errorLogs: unknown[];
} {
	const extensionStatuses = new Map<string, string>();
	const webviewMessages: Array<{ type: string; data?: unknown }> = [];
	const debugLogs: string[] = [];
	const errorLogs: unknown[] = [];

	const deps: ExtensionUIContextDeps = {
		getSession: () => undefined,
		extensionStatuses,
		notifyWebview: (msg) => webviewMessages.push(msg),
		logDebug: (...args) => debugLogs.push(args.join(" ")),
		logError: (...args) => errorLogs.push(args),
		...overrides,
	};

	return Object.assign(deps, {
		_webviewMessages: webviewMessages,
		_debugLogs: debugLogs,
		_errorLogs: errorLogs,
	});
}

// ── Tests ────────────────────────────────────────────────────────────────

suite("ExtensionUIContext", () => {
	suite("bindExtensionUI()", () => {
		test("early return when no session", async () => {
			const deps = createMockDeps();
			const ctx = new ExtensionUIContext(deps);
			await ctx.bindExtensionUI();
			assert.strictEqual(deps._webviewMessages.length, 0);
			assert.strictEqual(deps._errorLogs.length, 0);
		});

		test("early return when session has no extension runner", async () => {
			const session = createSessionMock({
				extensionRunner: undefined as any,
			});
			const deps = createMockDeps({ getSession: () => session as any });
			const ctx = new ExtensionUIContext(deps);
			await ctx.bindExtensionUI();
			assert.ok(
				deps._debugLogs.some((l: string) =>
					l.includes("No extension runner found"),
				),
			);
		});

		test("full success path: binds UI, emits session_start, sends statuses", async () => {
			const emitCalls: unknown[] = [];
			const runner = createExtensionRunnerMock({
				extensionPaths: ["/ext/path/a", "/ext/path/b"],
			});
			runner.emit = async (event: unknown) => {
				emitCalls.push(event);
			};

			// Build extensions array with handlers Map
			const handlers = new Map<
				string,
				Array<(...args: unknown[]) => unknown>
			>();
			handlers.set("session_start", [() => {}]);
			(runner as any).extensions = [{ path: "/ext/a", handlers }];

			const session = createSessionMock({ extensionRunner: runner });
			const extensionStatuses = new Map<string, string>();
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			await ctx.bindExtensionUI();

			// session_start was emitted
			assert.strictEqual(emitCalls.length, 1);
			assert.strictEqual((emitCalls[0] as any).type, "session_start");

			// session._extensionUIContext was set
			assert.ok((session as any)._extensionUIContext);
		});
	});

	suite("createUIContext()", () => {
		// Helper to get the UI context object from the runner
		function getCapturedUI(
			deps: ReturnType<typeof createMockDeps>,
		): Promise<any> {
			const session = createSessionMock();
			(deps as any).getSession = () => session;

			const runner = session.extensionRunner!;
			let capturedUI: any;
			const origSetUI = runner.setUIContext;
			runner.setUIContext = (ui: any) => {
				capturedUI = ui;
				origSetUI(ui);
			};

			const ctx = new ExtensionUIContext(deps);
			return ctx.bindExtensionUI().then(() => capturedUI);
		}

		test("setStatus adds entry and notifies webview", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.setStatus("my-key", "my-text");
			assert.strictEqual(deps.extensionStatuses.get("my-key"), "my-text");

			const statusMsg = deps._webviewMessages.find(
				(m: any) => m.type === "extension-status" && m.data?.key === "my-key",
			) as { type: string; data: { key: string; text: string } } | undefined;
			assert.ok(statusMsg);
			assert.strictEqual(statusMsg.data.text, "my-text");
		});

		test("setStatus with undefined text removes entry", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.setStatus("key1", "text1");
			assert.strictEqual(deps.extensionStatuses.has("key1"), true);

			ui.setStatus("key1", undefined);
			assert.strictEqual(deps.extensionStatuses.has("key1"), false);
		});

		test("setWorkingMessage sends activity-start when message provided", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.setWorkingMessage("Processing...");

			const activityMsg = deps._webviewMessages.find(
				(m: any) => m.type === "activity-start" && m.data?.key === "_working",
			) as { type: string; data: { key: string; text: string } } | undefined;
			assert.ok(activityMsg);
			assert.strictEqual(activityMsg.data.text, "Processing...");
		});

		test("setWorkingMessage sends activity-end when no message", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.setWorkingMessage();

			const endMsg = deps._webviewMessages.find(
				(m: any) => m.type === "activity-end" && m.data?.key === "_working",
			);
			assert.ok(endMsg);
		});

		test("notify sends extension-notify with provided type", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.notify("Hello from extension", "warning");

			const notifyMsg = deps._webviewMessages.find(
				(m: any) => m.type === "extension-notify",
			) as
				| { type: string; data: { message: string; type: string } }
				| undefined;
			assert.ok(notifyMsg);
			assert.strictEqual(notifyMsg.data.message, "Hello from extension");
			assert.strictEqual(notifyMsg.data.type, "warning");
		});

		test("notify defaults type to info", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			ui.notify("msg");

			const notifyMsg = deps._webviewMessages.find(
				(m: any) => m.type === "extension-notify",
			) as
				| { type: string; data: { message: string; type: string } }
				| undefined;
			assert.ok(notifyMsg);
			assert.strictEqual(notifyMsg.data.type, "info");
		});

		test("custom() calls done() and resolves", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			const result = await ui.custom(
				(_tui: any, _theme: any, _kb: any, done: (r: string) => void) => {
					done("hello");
				},
			);

			assert.strictEqual(result, "hello");
		});

		test("custom() resolves undefined when factory throws", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			const result = await ui.custom(() => {
				throw new Error("boom");
			});

			assert.strictEqual(result, undefined);
		});

		test("custom() handles async component factory", async () => {
			const deps = createMockDeps();
			const ui = await getCapturedUI(deps);

			const result = await ui.custom(
				(_tui: any, _theme: any, _kb: any, done: (r: number) => void) => {
					return new Promise<void>((resolve) => {
						setTimeout(() => {
							done(42);
							resolve();
						}, 5);
					});
				},
			);

			assert.strictEqual(result, 42);
		});
	});

	suite("startStatusPoller / stopStatusPoller", () => {
		test("start sets interval, stop clears it", () => {
			const deps = createMockDeps();
			const ctx = new ExtensionUIContext(deps);
			ctx.startStatusPoller();
			ctx.stopStatusPoller();
		});

		test("double stop is safe", () => {
			const deps = createMockDeps();
			const ctx = new ExtensionUIContext(deps);
			ctx.startStatusPoller();
			ctx.stopStatusPoller();
			ctx.stopStatusPoller();
		});
	});

	suite("pollExtensionStatuses()", () => {
		test("sends extension-statuses-full when statuses exist and runner has UI", () => {
			const runner = createExtensionRunnerMock();
			runner.hasUI = () => true;
			const session = createSessionMock({ extensionRunner: runner });
			const extensionStatuses = new Map([["ext:a", "running"]]);
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).pollExtensionStatuses();

			const fullMsg = deps._webviewMessages.find(
				(m: any) => m.type === "extension-statuses-full",
			);
			assert.ok(fullMsg);
			assert.deepStrictEqual(fullMsg.data, { "ext:a": "running" });
		});

		test("does not send when no session", () => {
			const deps = createMockDeps({ getSession: () => undefined });
			const ctx = new ExtensionUIContext(deps);
			(ctx as any).pollExtensionStatuses();
			assert.strictEqual(deps._webviewMessages.length, 0);
		});

		test("does not send when runner has no UI", () => {
			const runner = createExtensionRunnerMock();
			runner.hasUI = () => false;
			const session = createSessionMock({ extensionRunner: runner });
			const extensionStatuses = new Map([["key", "val"]]);
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).pollExtensionStatuses();
			assert.strictEqual(deps._webviewMessages.length, 0);
		});
	});

	suite("forwardExtensionLoadingErrors()", () => {
		test("forwards errors from resource loader as status entries", () => {
			const session = createSessionMock({
				resourceLoader: {
					getExtensions: () => ({
						extensions: [],
						errors: [{ path: "/bad/ext", error: new Error("ABI mismatch") }],
					}),
				} as any,
			});

			const extensionStatuses = new Map<string, string>();
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).forwardExtensionLoadingErrors();

			const errKey = "ext:error:/bad/ext";
			assert.ok(extensionStatuses.has(errKey));
			assert.ok(extensionStatuses.get(errKey)!.includes("ABI mismatch"));

			assert.ok(
				deps._webviewMessages.some(
					(m: any) => m.type === "extension-status" && m.data?.key === errKey,
				),
			);
		});

		test("skips errors without path or error", () => {
			const session = createSessionMock({
				resourceLoader: {
					getExtensions: () => ({
						extensions: [],
						errors: [{ path: null, error: null }],
					}),
				} as any,
			});

			const deps = createMockDeps({
				getSession: () => session as any,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).forwardExtensionLoadingErrors();
			assert.strictEqual(deps.extensionStatuses.size, 0);
		});

		test("does not duplicate existing error keys", () => {
			const session = createSessionMock({
				resourceLoader: {
					getExtensions: () => ({
						extensions: [],
						errors: [{ path: "/ext1", error: "err1" }],
					}),
				} as any,
			});

			const extensionStatuses = new Map([["ext:error:/ext1", "prev"]]);
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).forwardExtensionLoadingErrors();
			assert.strictEqual(extensionStatuses.get("ext:error:/ext1"), "prev");
		});

		test("truncates long error messages to 200 chars", () => {
			const longError = "x".repeat(300);
			const session = createSessionMock({
				resourceLoader: {
					getExtensions: () => ({
						extensions: [],
						errors: [{ path: "/ext", error: longError }],
					}),
				} as any,
			});

			const extensionStatuses = new Map<string, string>();
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).forwardExtensionLoadingErrors();

			const text = extensionStatuses.get("ext:error:/ext")!;
			assert.ok(text.length <= 201);
			assert.ok(text.endsWith("…"));
		});

		test("handles string errors (not Error instances)", () => {
			const session = createSessionMock({
				resourceLoader: {
					getExtensions: () => ({
						extensions: [],
						errors: [{ path: "/ext2", error: "plain string error" }],
					}),
				} as any,
			});

			const extensionStatuses = new Map<string, string>();
			const deps = createMockDeps({
				getSession: () => session as any,
				extensionStatuses,
			});

			const ctx = new ExtensionUIContext(deps);
			(ctx as any).forwardExtensionLoadingErrors();
			assert.strictEqual(
				extensionStatuses.get("ext:error:/ext2"),
				"plain string error",
			);
		});
	});

	suite("dispose()", () => {
		test("stops poller on dispose", () => {
			const deps = createMockDeps();
			const ctx = new ExtensionUIContext(deps);
			ctx.startStatusPoller();
			ctx.dispose();
		});
	});
});
