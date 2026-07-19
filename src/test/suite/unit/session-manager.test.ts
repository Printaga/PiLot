import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import * as piModule from "@earendil-works/pi-coding-agent";
import {
    extractTextFromMessage,
    generateSessionName,
    SessionListManager,
} from "../../../session-manager.js";
import type { SessionManagerDeps } from "../../../session-manager.js";

function buildDeps(
    overrides: Partial<SessionManagerDeps> = {},
): SessionManagerDeps {
    const base: SessionManagerDeps = {
        config: {},
        getSession: () => undefined,
        setSession: () => {},
        getSessionManager: () => undefined,
        setSessionManager: () => {},
        getModelRegistry: () => undefined,
        getModelRuntime: () => undefined,
        getSettingsManager: () => undefined,
        notifyWebview: () => {},
        logDebug: () => {},
        logError: () => {},
    };
    return { ...base, ...overrides };
}

function createMockSession(overrides: Record<string, unknown> = {}): any {
    return {
        sessionName: (overrides.sessionName as string | null) ?? null,
        sessionId: overrides.sessionId ?? "test-session-id",
        messages: (overrides.messages as any[]) ?? [],
        dispose: () => {},
        setSessionName: () => {},
        ...overrides,
    };
}

function createMockPiSession(sessions: any[]): any[] {
    return sessions.map((s) => ({
        id: s.id ?? "s-default",
        name: s.name,
        firstMessage: s.firstMessage ?? "Hello world",
        modified: new Date(s.timestamp ?? Date.now()),
        messageCount: s.messageCount ?? 1,
        path: s.path ?? "/tmp/session.json",
        cwd: s.cwd ?? "/tmp",
    }));
}

suite("extractTextFromMessage", () => {
    test("returns string content unchanged", () => {
        assert.strictEqual(
            extractTextFromMessage({ role: "user", content: "hello" }),
            "hello",
        );
    });

    test("returns empty string for null content", () => {
        assert.strictEqual(
            extractTextFromMessage({ role: "user", content: null }),
            "",
        );
    });

    test("joins text blocks and skips non-text blocks", () => {
        assert.strictEqual(
            extractTextFromMessage({
                role: "assistant",
                content: [
                    { type: "text", text: "Debug " },
                    { type: "image" },
                    { type: "text", text: "session titles" },
                ],
            }),
            "Debug  session titles",
        );
    });

    test("skips array items missing text property", () => {
        assert.strictEqual(
            extractTextFromMessage({
                role: "assistant",
                content: [
                    { type: "text", text: "only" },
                    { type: "text" },
                ],
            }),
            "only",
        );
    });
});

suite("generateSessionName", () => {
    test("prefers assistant text over user", () => {
        const name = generateSessionName(
            "Can you fix the login redirect bug?",
            "I'll fix the login redirect bug.",
        );
        assert.strictEqual(name, "Fix the login redirect bug");
    });

    test("strips markdown and polite prefixes", () => {
        const name = generateSessionName(
            "Help me debug session naming.",
            "Here's how to debug session naming in the provider.",
        );
        assert.strictEqual(name, "How to debug session naming in the provider");
    });

    test("falls back to first user message when assistant is empty", () => {
        const name = generateSessionName("debug session naming bug", "");
        assert.strictEqual(name, "Debug session naming bug");
    });

    test("caps length at 60 chars with ellipsis for long text", () => {
        const longText = "a".repeat(100);
        const name = generateSessionName(longText, "");
        assert.ok(name.length <= 60);
    });

    test("returns empty string when both inputs are empty after cleaning", () => {
        const name = generateSessionName("", "");
        assert.strictEqual(name, "");
    });
});

suite("SessionListManager", () => {
    let savedPiList: any;
    let savedFsUnlink: any;
    let oldWorkspaceFolders: any;
    let oldShowErrorMessage: any;

    setup(() => {
        savedPiList = (piModule.SessionManager as any).list;
        savedFsUnlink = (fs as any).unlink;
        oldWorkspaceFolders = (vscode.workspace as any).workspaceFolders;
        oldShowErrorMessage = (vscode.window as any).showErrorMessage;
    });

    teardown(() => {
        if (savedPiList) (piModule.SessionManager as any).list = savedPiList;
        if (savedFsUnlink) (fs as any).unlink = savedFsUnlink;
        (vscode.workspace as any).workspaceFolders = oldWorkspaceFolders;
        (vscode.window as any).showErrorMessage = oldShowErrorMessage;
    });

    suite("autoNamingTriggered getter/setter", () => {
        test("defaults to false", () => {
            const mgr = new SessionListManager(buildDeps());
            assert.strictEqual(mgr.autoNamingTriggered, false);
        });

        test("setter stores true", () => {
            const mgr = new SessionListManager(buildDeps());
            mgr.autoNamingTriggered = true;
            assert.strictEqual(mgr.autoNamingTriggered, true);
        });
    });

    suite("session list cache", () => {
        test("listSessions returns cache within TTL", async () => {
            const sessions = createMockPiSession([{ id: "s1", name: "S1" }]);
            (piModule.SessionManager as any).list = async () => sessions;
            let listCalls = 0;
            (piModule.SessionManager as any).list = async () => {
                listCalls++;
                return sessions;
            };

            const mgr = new SessionListManager(buildDeps());
            await mgr.listSessions();
            assert.strictEqual(listCalls, 1);

            await mgr.listSessions(false);
            assert.strictEqual(listCalls, 1, "should use cache without re-listing");
        });

        test("forces refresh when cache expired", async () => {
            const sessions1 = createMockPiSession([{ id: "s1", name: "S1" }]);
            const sessions2 = createMockPiSession([{ id: "s2", name: "S2" }]);
            let listCalls = 0;
            (piModule.SessionManager as any).list = async () => {
                listCalls++;
                return listCalls === 1 ? sessions1 : sessions2;
            };

            const mgr = new SessionListManager(buildDeps());
            await mgr.listSessions(false);
            assert.strictEqual(listCalls, 1);
            assert.strictEqual(mgr.sessionListCache.length, 1);

            (mgr as any)._sessionListCacheTime = Date.now() - 6001;
            await mgr.listSessions(false);
            assert.strictEqual(listCalls, 2, "should refetch after TTL expiry");
            assert.strictEqual(mgr.sessionListCache.length, 1);
        });

        test("error returns empty list and clears caches", async () => {
            (piModule.SessionManager as any).list = async () => {
                throw new Error("list failed");
            };

            const mgr = new SessionListManager(buildDeps());
            const result = await mgr.listSessions(false);
            assert.deepStrictEqual(result, []);
            assert.deepStrictEqual(mgr.sessionListCache, []);
        });

        test("invalidateSessionListCache clears all caches", async () => {
            const sessions = createMockPiSession([{ id: "s1", name: "S1" }]);
            (piModule.SessionManager as any).list = async () => sessions;

            const mgr = new SessionListManager(buildDeps());
            await mgr.listSessions(false);
            assert.ok(mgr.sessionListCache.length > 0);

            mgr.invalidateSessionListCache();
            assert.deepStrictEqual(mgr.sessionListCache, []);
            assert.deepStrictEqual(mgr.sessionListFullCache, []);
            assert.strictEqual((mgr as any)._sessionListCacheTime, 0);
        });
    });

    suite("refreshSessionList", () => {
        test("sends sessions-list to webview", async () => {
            const sessions = createMockPiSession([{ id: "s1", name: "S1" }]);
            (piModule.SessionManager as any).list = async () => sessions;

            const sentMessages: any[] = [];
            const mgr = new SessionListManager(
                buildDeps({
                    notifyWebview: (msg: any) => sentMessages.push(msg),
                }),
            );

            await mgr.refreshSessionList(true);
            assert.ok(
                sentMessages.some((m) => m.type === "sessions-list"),
                "expected sessions-list notification",
            );
            assert.deepStrictEqual(
                (mgr as any)._sessionListCache,
                sentMessages.find((m) => m.type === "sessions-list").data,
            );
        });
    });

    suite("tryAutoSessionName", () => {
        test("returns false when no session", () => {
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => undefined }),
            );
            assert.strictEqual(mgr.tryAutoSessionName(), false);
        });

        test("returns false when session already named", () => {
            const session = createMockSession({ sessionName: "Existing Name" });
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => session }),
            );
            assert.strictEqual(mgr.tryAutoSessionName(), false);
        });

        test("returns false when only user message present", () => {
            const session = createMockSession({
                sessionName: null,
                messages: [{ role: "user", content: "Hello" }],
            });
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => session }),
            );
            assert.strictEqual(mgr.tryAutoSessionName(), false);
        });

        test("returns false when only assistant message present", () => {
            const session = createMockSession({
                sessionName: null,
                messages: [{ role: "assistant", content: "Hi there" }],
            });
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => session }),
            );
            assert.strictEqual(mgr.tryAutoSessionName(), false);
        });

        test("successfully generates and sets session name", () => {
            let capturedName: string | undefined;
            const session = createMockSession({
                sessionName: null,
                messages: [
                    { role: "user", content: "Fix the login bug" },
                    {
                        role: "assistant",
                        content: "I will fix the login bug right now.",
                    },
                ],
            });
            Object.defineProperty(session, "setSessionName", {
                value: (name: string) => {
                    capturedName = name;
                    session.sessionName = name;
                },
            });

            const mgr = new SessionListManager(
                buildDeps({
                    getSession: () => session,
                    logDebug: () => {},
                }),
            );

            const result = mgr.tryAutoSessionName();
            assert.strictEqual(result, true);
            assert.ok(capturedName, "expected session name to be set");
        });
    });

    suite("tryAutoSessionNameFromUserMessage", () => {
        test("returns false without session", () => {
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => undefined }),
            );
            assert.strictEqual(
                mgr.tryAutoSessionNameFromUserMessage({
                    role: "user",
                    content: "Hello",
                }),
                false,
            );
        });

        test("returns false when session already named", () => {
            const session = createMockSession({ sessionName: "Existing" });
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => session }),
            );
            assert.strictEqual(
                mgr.tryAutoSessionNameFromUserMessage({
                    role: "user",
                    content: "Hello",
                }),
                false,
            );
        });

        test("returns false on empty user text", () => {
            const session = createMockSession({ sessionName: null });
            const mgr = new SessionListManager(
                buildDeps({ getSession: () => session }),
            );
            assert.strictEqual(
                mgr.tryAutoSessionNameFromUserMessage({
                    role: "user",
                    content: "",
                }),
                false,
            );
        });

        test("generates name from user message", () => {
            let capturedName: string | undefined;
            const session = createMockSession({ sessionName: null });
            Object.defineProperty(session, "setSessionName", {
                value: (name: string) => {
                    capturedName = name;
                    session.sessionName = name;
                },
            });

            const mgr = new SessionListManager(
                buildDeps({
                    getSession: () => session,
                    logDebug: () => {},
                }),
            );

            const result = mgr.tryAutoSessionNameFromUserMessage({
                role: "user",
                content: "Refactor the auth module",
            });
            assert.strictEqual(result, true);
            assert.ok(capturedName, "expected session name to be set");
        });
    });

    suite("deleteSessions", () => {
        test("deletes session files and disposes active session", async () => {
            const allSessions = createMockPiSession([
                { id: "s1", name: "S1", path: "/tmp/s1.json" },
                { id: "s2", name: "S2", path: "/tmp/s2.json" },
            ]);
            (piModule.SessionManager as any).list = async () => allSessions;

            const unlinked: string[] = [];
            let disposed = false;
            const activeSession = createMockSession({ sessionId: "s1" });
            activeSession.dispose = () => {
                disposed = true;
            };

            const mgr = new SessionListManager(
                buildDeps({
                    config: { sessionDir: undefined },
                    getSession: () => activeSession,
                    setSession: (s?: any) => {
                        assert.strictEqual(s, undefined, "active session should be cleared");
                    },
                    logDebug: () => {},
                }),
            );

            (fs as any).unlink = async (p: string) => {
                unlinked.push(p);
            };

            await mgr.deleteSessions(["s1"]);

            assert.ok(unlinked.includes("/tmp/s1.json"), "expected s1 to be unlinked");
            assert.ok(disposed, "expected active session to be disposed");
        });

        test("refreshes session list after successful deletion", async () => {
            const allSessions = createMockPiSession([
                { id: "s1", path: "/tmp/s1.json" },
            ]);
            (piModule.SessionManager as any).list = async () => allSessions;

            let notifyPayload: any;
            const mgr = new SessionListManager(
                buildDeps({
                    config: { sessionDir: undefined },
                    notifyWebview: (msg: any) => {
                        notifyPayload = msg;
                    },
                }),
            );

            (fs as any).unlink = async () => {};

            await mgr.deleteSessions(["s1"]);

            assert.ok(
                notifyPayload?.type === "sessions-list",
                "expected sessions-list notification after delete",
            );
        });

        test("calls onSessionDeleted callback when active session removed", async () => {
            const allSessions = createMockPiSession([
                { id: "s1", path: "/tmp/s1.json" },
            ]);
            (piModule.SessionManager as any).list = async () => allSessions;

            let deletedIds: string[] | undefined;
            const activeSession = createMockSession({ sessionId: "s1" });

            const mgr = new SessionListManager(
                buildDeps({
                    config: { sessionDir: undefined },
                    getSession: () => activeSession,
                    setSession: undefined as any,
                    onSessionDeleted: async (ids: string[]) => {
                        deletedIds = ids;
                    },
                }),
            );

            (fs as any).unlink = async () => {};

            await mgr.deleteSessions(["s1"]);
            assert.deepStrictEqual(deletedIds, ["s1"]);
        });

        test("propagates error after logging and showing error message", async () => {
            let errorShown = "";
            const logErrors: any[] = [];
            const allSessions = createMockPiSession([
                { id: "s1", path: "/tmp/s1.json" },
            ]);
            (piModule.SessionManager as any).list = async () => allSessions;

            (vscode.window as any).showErrorMessage = (msg: string) => {
                errorShown = msg;
                return msg;
            };

            const mgr = new SessionListManager(
                buildDeps({
                    config: { sessionDir: undefined },
                    logError: (msg: string, err?: unknown) => {
                        logErrors.push({ msg, err });
                    },
                }),
            );

            (fs as any).unlink = async () => {
                throw new Error("disk full");
            };

            let caught: Error | undefined;
            try {
                await mgr.deleteSessions(["s1"]);
            } catch (err) {
                caught = err as Error;
            }

            assert.ok(caught, "expected error to be re-thrown");
            assert.strictEqual(caught.message, "disk full");
            assert.ok(logErrors.length > 0, "expected logError to be called");
            assert.ok(errorShown.includes("Failed to delete sessions"), "expected vscode error message");
        });

        test("skips unlink when session path is not found", async () => {
            const allSessions = createMockPiSession([
                { id: "s1", path: "/tmp/s1.json" },
            ]);
            (piModule.SessionManager as any).list = async () => allSessions;

            const unlinked: string[] = [];
            (fs as any).unlink = async (p: string) => {
                unlinked.push(p);
            };

            const mgr = new SessionListManager(
                buildDeps({
                    config: { sessionDir: undefined },
                }),
            );

            await mgr.deleteSessions(["nonexistent-id"]);
            assert.deepStrictEqual(unlinked, [], "should not unlink missing sessions");
        });
    });
});
