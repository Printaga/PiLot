// ── Unit tests for update-checker ──────────────────────────────────────────

import * as assert from "node:assert";
import * as vscode from "vscode";
import {
	parsePackageVersion,
	isNewerVersion,
	fetchLatestPiRelease,
	checkForPiUpdate,
	checkForPackageUpdates,
	showUpdateNotification,
	runUpdateCheck,
	startUpdateChecker,
	performCheckWithDeduplication,
	clearKnownUpdates,
} from "../../../update-checker.js";
import { resetVscodeMocks } from "../../mocks/pi-sdk-mocks.js";

let notifyCalls: any[];
let infoMessages: string[];
let terminalCalls: any[];
let globalStateUpdates: Record<string, any>;

function resetMocks() {
	notifyCalls = [];
	infoMessages = [];
	terminalCalls = [];
	globalStateUpdates = {};
}

suite("update-checker: parsePackageVersion", () => {
	test("parses standard semver", () => {
		const result = parsePackageVersion("1.2.3");
		assert.deepStrictEqual(result, {
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: undefined,
		});
	});

	test("parses version with v prefix", () => {
		const result = parsePackageVersion("v1.2.3");
		assert.deepStrictEqual(result, {
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: undefined,
		});
	});

	test("parses prerelease version", () => {
		const result = parsePackageVersion("1.2.3-beta.1");
		assert.deepStrictEqual(result, {
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: "beta.1",
		});
	});

	test("parses version with build metadata", () => {
		const result = parsePackageVersion("1.2.3+build.1");
		assert.deepStrictEqual(result, {
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: undefined,
		});
	});

	test("returns undefined for empty string", () => {
		assert.strictEqual(parsePackageVersion(""), undefined);
	});

	test("returns undefined for invalid string", () => {
		assert.strictEqual(parsePackageVersion("invalid"), undefined);
	});

	test("returns undefined for partial version", () => {
		assert.strictEqual(parsePackageVersion("1.2"), undefined);
	});

	test("returns undefined for malformed prerelease", () => {
		assert.strictEqual(parsePackageVersion("1.2.3-"), undefined);
	});
});

suite("update-checker: isNewerVersion", () => {
	test("returns true when candidate is newer", () => {
		assert.strictEqual(isNewerVersion("2.0.0", "1.0.0"), true);
	});

	test("returns false when versions are equal", () => {
		assert.strictEqual(isNewerVersion("1.2.3", "1.2.3"), false);
	});

	test("returns false when candidate is older", () => {
		assert.strictEqual(isNewerVersion("1.0.0", "1.2.3"), false);
	});

	test("returns true for stable version newer than prerelease", () => {
		assert.strictEqual(isNewerVersion("1.2.3", "1.2.3-beta.1"), true);
	});

	test("returns true when prerelease is newer", () => {
		assert.strictEqual(isNewerVersion("1.2.4-beta.1", "1.2.3"), true);
	});

	test("returns true when prerelease segment is lexicographically greater", () => {
		assert.strictEqual(isNewerVersion("1.2.3-beta.2", "1.2.3-beta.1"), true);
	});

	test("returns false when prerelease is the same", () => {
		assert.strictEqual(isNewerVersion("1.2.3-beta.1", "1.2.3-beta.1"), false);
	});

	test("returns false when candidate prerelease is older", () => {
		assert.strictEqual(isNewerVersion("1.2.3-beta.1", "1.2.3-beta.2"), false);
	});

	test("falls back to string comparison when parsing fails", () => {
		assert.strictEqual(isNewerVersion("unparseable", "1.0.0"), true);
		assert.strictEqual(isNewerVersion("1.0.0", "unparseable"), false);
	});
});

suite("update-checker: fetchLatestPiRelease", () => {
	setup(() => {
		resetMocks();
		resetVscodeMocks();
	});

	teardown(() => {
		resetMocks();
	});

	test("returns undefined when PI_SKIP_VERSION_CHECK is set", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "1";
		try {
			const result = await fetchLatestPiRelease();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
		}
	});

	test("returns undefined when PI_OFFLINE is set", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
		try {
			const result = await fetchLatestPiRelease();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});

	test("returns undefined on network error", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => {
			throw new Error("Network failure");
		};

		try {
			const result = await fetchLatestPiRelease();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns undefined on invalid JSON response", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => "not an object",
		});

		try {
			const result = await fetchLatestPiRelease();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns undefined when version field is missing", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({ note: "no version here" }),
		});

		try {
			const result = await fetchLatestPiRelease();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns release info on successful response", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({
				version: " 1.2.4 ",
				packageName: "pi-cli",
				note: "New features",
			}),
		});

		try {
			const result = await fetchLatestPiRelease();
			assert.ok(result);
			assert.strictEqual(result.version, "1.2.4");
			assert.strictEqual(result.packageName, "pi-cli");
			assert.strictEqual(result.note, "New features");
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});
});

suite("update-checker: checkForPiUpdate", () => {
	test("returns release info when a newer version exists", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({ version: "99.0.0" }),
		});

		try {
			const result = await checkForPiUpdate();
			assert.ok(result);
			assert.strictEqual(result.version, "99.0.0");
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns undefined when version is equal to current", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({ version: "0.78.1" }),
		});

		try {
			const result = await checkForPiUpdate();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns undefined when version is older", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({ version: "0.1.0" }),
		});

		try {
			const result = await checkForPiUpdate();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("returns undefined when fetch fails", async () => {
		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => {
			throw new Error("fail");
		};

		try {
			const result = await checkForPiUpdate();
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});
});

suite("update-checker: checkForPackageUpdates", () => {
	test("returns [] when PI_OFFLINE is set", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
		try {
			const result = await checkForPackageUpdates({} as any);
			assert.deepStrictEqual(result, []);
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});

	test("returns [] when settingsManager is undefined", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";
		try {
			const result = await checkForPackageUpdates(undefined);
			assert.deepStrictEqual(result, []);
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});
});

suite("update-checker: showUpdateNotification", () => {
	setup(() => {
		resetMocks();
		resetVscodeMocks();
	});

	teardown(() => {
		resetMocks();
	});

	test("returns undefined when there are no updates", async () => {
		const result = await showUpdateNotification(undefined, []);
		assert.strictEqual(result, undefined);
	});

	test("returns user choice when PI update is available", async () => {
		(vscode.window as any).showInformationMessage = async () => "Update All";

		const result = await showUpdateNotification(
			{ version: "1.0.0", note: "note" },
			[],
		);
		assert.strictEqual(result, "Update All");
	});

	test("returns user choice when package updates are available", async () => {
		(vscode.window as any).showInformationMessage = async () => "View Details";

		const result = await showUpdateNotification(undefined, [
			{ source: "src1", displayName: "Pkg1", type: "npm" },
		]);
		assert.strictEqual(result, "View Details");
	});

	test("returns user choice when both PI and package updates are available", async () => {
		(vscode.window as any).showInformationMessage = async () => "Update All";

		const result = await showUpdateNotification(
			{ version: "1.0.0" },
			[
				{ source: "src1", displayName: "Pkg1", type: "npm" },
				{ source: "src2", displayName: "Pkg2", type: "npm" },
			],
		);
		assert.strictEqual(result, "Update All");
	});
});

suite("update-checker: runUpdateCheck", () => {
	setup(() => {
		resetMocks();
		resetVscodeMocks();
	});

	teardown(() => {
		resetMocks();
	});

	test("shows up-to-date message when there are no updates", async () => {
		const provider = {
			getSettingsManager: () => null,
			sendUpdatesToWebview: () => {},
		};

		(vscode.window as any).showInformationMessage = async (msg: string) => {
			infoMessages.push(msg);
			return msg;
		};
		(vscode.workspace as any).getConfiguration = () =>
			({
				get: (_key: string, defaultValue?: any) => defaultValue,
				update: async () => {},
			}) as unknown as vscode.WorkspaceConfiguration;

		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => {
			throw new Error("network");
		};

		try {
			await runUpdateCheck(provider as any);
			assert.ok(
				infoMessages.some((m: string) => m.includes("up to date")),
			);
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});

	test("sends update info to webview and shows terminal when PI update is available", async () => {
		const provider = {
			getSettingsManager: () => null,
			sendUpdatesToWebview: (piVersion: string | null, count: number) => {
				notifyCalls.push({ piVersion, count });
			},
		};

		terminalCalls = [];
		(vscode.window as any).createTerminal = () => {
			const term = {
				sendText: (text: string) => terminalCalls.push(text),
				show: () => {},
				dispose: () => {},
			};
			terminalCalls.push("created");
			return term;
		};
		(vscode.workspace as any).getConfiguration = () =>
			({
				get: (key: string, defaultValue?: any) => {
					if (key === "autoUpdate") return false;
					return defaultValue;
				},
				update: async () => {},
			}) as unknown as vscode.WorkspaceConfiguration;
		(vscode.window as any).showInformationMessage = async () => "Update All";

		const prev = process.env.PI_SKIP_VERSION_CHECK;
		process.env.PI_SKIP_VERSION_CHECK = "";
		const prevOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";

		(global as any).fetch = async () => ({
			ok: true,
			json: async () => ({ version: "99.0.0" }),
		});

		try {
			await runUpdateCheck(provider as any);
			assert.ok(
				notifyCalls.some((c: any) => c.piVersion === "99.0.0"),
			);
			assert.ok(terminalCalls.includes("created"));
			// User chose "Update All" so terminal should have "pi update"
			assert.ok(terminalCalls.some((c: string) => c === "pi update"));
		} finally {
			process.env.PI_SKIP_VERSION_CHECK = prev;
			process.env.PI_OFFLINE = prevOffline;
			delete (global as any).fetch;
		}
	});
});

suite("update-checker: startUpdateChecker", () => {
	test("returns a disposable that clears timers", () => {
		const timeouts: any[] = [];
		const intervals: any[] = [];

		const originalSetTimeout = (global as any).setTimeout;
		(global as any).setTimeout = (...args: any[]) => {
			const id = originalSetTimeout(...args);
			timeouts.push({ id, cb: args[0], ms: args[1] });
			return id;
		};

		const originalSetInterval = (global as any).setInterval;
		(global as any).setInterval = (...args: any[]) => {
			const id = originalSetInterval(...args);
			intervals.push({ id, cb: args[0], ms: args[1] });
			return id;
		};
		const originalClearTimeout = (global as any).clearTimeout;
		(global as any).clearTimeout = (id: any) => {
			const index = timeouts.findIndex((entry) => entry.id === id);
			if (index !== -1) {
				timeouts.splice(index, 1);
			}
			return originalClearTimeout(id);
		};
		const originalClearInterval = (global as any).clearInterval;
		(global as any).clearInterval = (id: any) => {
			const index = intervals.findIndex((entry) => entry.id === id);
			if (index !== -1) {
				intervals.splice(index, 1);
			}
			return originalClearInterval(id);
		};

		try {
			const context = createMockContext();
			const provider = createMockProvider();

			const disposable = startUpdateChecker(context, provider);

			assert.strictEqual(timeouts.length, 1);
			assert.strictEqual(intervals.length, 1);
			assert.strictEqual(timeouts[0].ms, 15_000);

			disposable.dispose();

			assert.strictEqual(timeouts.length, 0);
			assert.strictEqual(intervals.length, 0);
		} finally {
			(global as any).setTimeout = originalSetTimeout;
			(global as any).setInterval = originalSetInterval;
			(global as any).clearTimeout = originalClearTimeout;
			(global as any).clearInterval = originalClearInterval;
		}
	});
});

suite("update-checker: performCheckWithDeduplication", () => {
	test("skips when offline mode is active", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
		try {
			const context = createMockContext();
			const provider = createMockProvider();
			const result = await performCheckWithDeduplication(context, provider);
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});

		test("skips when last check was less than 1 hour ago", async () => {
			const prev = process.env.PI_OFFLINE;
			process.env.PI_OFFLINE = "";
			try {
				(vscode.workspace as any).getConfiguration = () =>
					({
						get: (key: string, _defaultValue?: any) => {
							if (key === "offline") return false;
							if (key === "autoUpdate") return false;
							return _defaultValue;
						},
						update: async () => {},
					}) as unknown as vscode.WorkspaceConfiguration;

				const context = createMockContext({
					globalState: {
						get: (key: string, defaultValue: any) => {
							if (key === "updateChecker.lastCheck") return Date.now();
							return defaultValue;
						},
						update: async () => {},
					},
				});

			const provider = createMockProvider();
			provider.sendUpdatesToWebview = () => {};

			const result = await performCheckWithDeduplication(context, provider);
			assert.strictEqual(result, undefined);
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});

	test("notifies when PI update is new, persists known update", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";
		try {
			(vscode.workspace as any).getConfiguration = () =>
				({
					get: (_key: string, _defaultValue?: any) => {
						if (_key === "offline") return false;
						if (_key === "autoUpdate") return false;
						return _defaultValue;
					},
					update: async () => {},
				}) as unknown as vscode.WorkspaceConfiguration;

		const lastCheck = 0;
		const context = {
			globalState: {
				get: (key: string, defaultValue: any) => {
					if (key === "updateChecker.lastCheck") return lastCheck;
					return defaultValue;
				},
				update: async (key: string, value: unknown) => {
					globalStateUpdates[key] = value;
				},
			},
		} as any;
		if ((context as any).subscriptions === undefined) {
			(context as any).subscriptions = [];
		}

			const updateCalls: any[] = [];
			const provider = {
				getSettingsManager: () => null,
				sendUpdatesToWebview: (piVersion: string | null, count: number) => {
					updateCalls.push({ piVersion, count });
				},
			} as any;

			(global as any).fetch = async () => ({
				ok: true,
				json: async () => ({ version: "99.0.0" }),
			});

			try {
				await performCheckWithDeduplication(context, provider);
				assert.ok(
					updateCalls.some((c: any) => c.piVersion === "99.0.0"),
				);
				assert.strictEqual(
					globalStateUpdates["updateChecker.knownPiUpdate"],
					"pi:v99.0.0",
				);
			} finally {
				delete (global as any).fetch;
			}
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});

	test("skips notification when update was already reported", async () => {
		const prev = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "";
		try {
			(vscode.workspace as any).getConfiguration = () =>
				({
					get: (_key: string, _defaultValue?: any) => {
						if (_key === "offline") return false;
						if (_key === "autoUpdate") return false;
						return _defaultValue;
					},
					update: async () => {},
				}) as unknown as vscode.WorkspaceConfiguration;

			const context = {
				globalState: {
					get: <T>(key: string, defaultValue: T): T => {
						if (key === "updateChecker.lastCheck") return (Date.now() - 2 * 60 * 60 * 1000) as T;
						if (key === "updateChecker.knownPiUpdate") return ("pi:v99.0.0") as T;
						return defaultValue;
					},
					update: async () => {},
				},
				subscriptions: [],
		} as any;

		const updateCalls: any[] = [];
		let infoMessageCalls = 0;
		const provider = {
			getSettingsManager: () => null,
			sendUpdatesToWebview: (piVersion: string | null, count: number) => {
				updateCalls.push({ piVersion, count });
			},
		} as any;
		(vscode.window as any).showInformationMessage = async () => {
			infoMessageCalls++;
			return undefined;
		};

			(global as any).fetch = async () => ({
				ok: true,
				json: async () => ({ version: "99.0.0" }),
			});

			try {
				await performCheckWithDeduplication(context, provider);
				assert.ok(
					updateCalls.some((c: any) => c.piVersion === "99.0.0"),
					"should still refresh webview update state",
				);
				assert.strictEqual(
					infoMessageCalls,
					0,
					"should not re-show a user notification for a known update",
				);
			} finally {
				delete (global as any).fetch;
			}
		} finally {
			process.env.PI_OFFLINE = prev;
		}
	});
});

suite("update-checker: clearKnownUpdates", () => {
	test("clears stored update state", async () => {
		const written: Record<string, any> = {};
		const context = {
			globalState: {
				get: <T>(_key: string, defaultValue: T): T => defaultValue,
				update: async (key: string, value: unknown) => {
					written[key] = value;
				},
			},
		} as any;

		await clearKnownUpdates(context);

		assert.strictEqual(written["updateChecker.knownPiUpdate"], "");
		assert.strictEqual(written["updateChecker.knownPackageUpdates"], "");
	});
});

function createMockContext(overrides: any = {}): vscode.ExtensionContext {
	return {
		extensionUri: vscode.Uri.file("/fake/extension"),
		extensionPath: "/fake/extension",
	globalState: {
		get: <T>(_key: string, defaultValue: T): T => defaultValue,
		update: async () => {},
		...overrides.globalState,
	},
		subscriptions: [],
		workspaceState: {
			get: <T>(_key: string, defaultValue: T): T => defaultValue,
			update: async () => {},
		},
		storagePath: "/fake/storage",
		globalStoragePath: "/fake/globalStorage",
		logPath: "/fake/log",
		...overrides,
	};
}

function createMockProvider(): any {
	return {
		getSettingsManager: () => null,
		sendUpdatesToWebview: () => {},
	};
}
