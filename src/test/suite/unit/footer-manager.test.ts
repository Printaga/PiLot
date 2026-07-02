import * as assert from "assert";
import { FooterManager } from "../../../footer-manager.js";
import type { FooterData } from "../../../footer-manager.js";

interface MockNotify {
    (msg: { type: string; data: FooterData }): void;
    messages: any[];
}

function createMockNotify(): MockNotify {
    const messages: any[] = [];
    const fn = (msg: { type: string; data: FooterData }) => {
        messages.push(msg);
    };
    Object.assign(fn, { messages });
    return fn as unknown as MockNotify;
}

function createBinaryService(
    overrides: Record<string, unknown> = {},
): { resolveGitBranch: (cwd: string) => string | null; logDebug: () => void; logError: () => void } {
    return {
        resolveGitBranch: (cwd: string): string | null =>
            (typeof overrides.resolveGitBranch === "function"
                ? overrides.resolveGitBranch.bind(overrides)
                : () => null)(cwd) ?? null,
        logDebug: () => {},
        logError: () => {},
    };
}

function createSessionCwd(
    overrides: Record<string, unknown> = {},
): any {
    const cwd = overrides.getCwd;
    return {
        getCwd: () =>
            typeof cwd === "function"
                ? cwd()
                : ((cwd as string | undefined) ?? "/tmp"),
        sessionName: overrides.sessionName ?? null,
    };
}

suite("FooterManager", () => {
    let notify: MockNotify;
    let binaryService: ReturnType<typeof createBinaryService>;

    setup(() => {
        notify = createMockNotify();
        binaryService = createBinaryService();
    });

    suite("sendFooterData", () => {
        test("is no-op when session is null", () => {
            const manager = new FooterManager(binaryService, notify);
            manager.sendFooterData(null);
            manager.sendFooterData(undefined);
            assert.deepStrictEqual(notify.messages, []);
        });

        test("shortens cwd using home directory", () => {
            const originalHome = process.env.HOME;
            process.env.HOME = "/home/user";

            const manager = new FooterManager(binaryService, notify);
            manager.sendFooterData(
                createSessionCwd({ getCwd: () => "/home/user/projects/my-app" }),
            );

            assert.ok(
                notify.messages.some(
                    (m: any) =>
                        m.type === "footer-data" &&
                        m.data.cwd === "~/projects/my-app",
                ),
                "expected cwd to be shortened to ~/projects/my-app",
            );

            process.env.HOME = originalHome;
        });

        test("resolves to ~ when cwd is exactly home", () => {
            const originalHome = process.env.HOME;
            process.env.HOME = "/home/user";

            const manager = new FooterManager(binaryService, notify);
            manager.sendFooterData(
                createSessionCwd({ getCwd: () => "/home/user" }),
            );

            assert.ok(
                notify.messages.some(
                    (m: any) => m.data.cwd === "~",
                ),
                "expected cwd to be shortened to ~",
            );

            process.env.HOME = originalHome;
        });

        test("includes git branch", () => {
            const manager = new FooterManager(
                createBinaryService({ resolveGitBranch: () => "feature/add-api" }),
                notify,
            );
            manager.sendFooterData(
                createSessionCwd({ getCwd: "/tmp" }),
            );

            assert.ok(
                notify.messages.some(
                    (m: any) => m.data.gitBranch === "feature/add-api",
                ),
                "expected git branch to be included",
            );
        });

        test("includes session name", () => {
            const manager = new FooterManager(binaryService, notify);
            manager.sendFooterData(
                createSessionCwd({ getCwd: "/tmp", sessionName: "My Session" }),
            );

            assert.ok(
                notify.messages.some(
                    (m: any) => m.data.sessionName === "My Session",
                ),
                "expected session name to be included",
            );
        });

        test("deduplicates when values unchanged", () => {
            const manager = new FooterManager(binaryService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });
            manager.sendFooterData(session);
            const firstCount = notify.messages.length;

            manager.sendFooterData(session);
            assert.strictEqual(
                notify.messages.length,
                firstCount,
                "expected no additional notification when values are unchanged",
            );
        });

        test("notifies when values change", () => {
            const branchService = createBinaryService({ resolveGitBranch: (cwd: string) => cwd === "/tmp" ? "main" : "dev" });
            const manager = new FooterManager(branchService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });

            manager.sendFooterData(session);
            const firstCount = notify.messages.length;

            // simulate directory change by changing cwd
            manager.sendFooterData(createSessionCwd({ getCwd: "/other", sessionName: "S1" }));
            assert.strictEqual(
                notify.messages.length,
                firstCount + 1,
                "expected new notification when values change",
            );
        });
    });

    suite("start", () => {
        test("sends initial footer data", () => {
            const manager = new FooterManager(binaryService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });

            manager.start(session);

            assert.ok(
                notify.messages.some(
                    (m: any) => m.type === "footer-data" && m.data.cwd === "/tmp",
                ),
                "expected initial footer data to be sent",
            );
        });

        test("returns early with null session", () => {
            const manager = new FooterManager(binaryService, notify);
            manager.start(null);
            manager.start(undefined);
            assert.deepStrictEqual(notify.messages, []);
        });

        test("sets up an interval for polling git branch", () => {
            const manager = new FooterManager(binaryService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });

            const intervalIds: any[] = [];
            const originalSetInterval = global.setInterval;
            (global as any).setInterval = (cb: () => void, ms: number) => {
                const id = originalSetInterval(cb, ms);
                intervalIds.push(id);
                return id;
            };

            try {
                manager.start(session);
                assert.ok(
                    intervalIds.length === 1,
                    "expected exactly one interval to be scheduled",
                );
            } finally {
                manager.stop();
                (global as any).setInterval = originalSetInterval;
            }
        });
    });

    suite("stop", () => {
        test("clears interval", () => {
            const manager = new FooterManager(binaryService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });

            const intervalIds: any[] = [];
            const originalSetInterval = global.setInterval;
            const originalClearInterval = global.clearInterval;
            (global as any).setInterval = (cb: () => void, ms: number) => {
                const id = originalSetInterval(cb, ms);
                intervalIds.push(id);
                return id;
            };
            (global as any).clearInterval = (id: any) => {
                originalClearInterval(id);
                const idx = intervalIds.indexOf(id);
                if (idx !== -1) intervalIds.splice(idx, 1);
            };

            try {
                manager.start(session);
                assert.ok(intervalIds.length > 0, "expected interval to be set");

                manager.stop();
                assert.ok(
                    intervalIds.length === 0,
                    "expected interval to be cleared",
                );
            } finally {
                (global as any).setInterval = originalSetInterval;
                (global as any).clearInterval = originalClearInterval;
            }
        });

        test("is a no-op when interval is not running", () => {
            const manager = new FooterManager(binaryService, notify);
            assert.doesNotThrow(() => manager.stop());
        });
    });

    suite("dispose", () => {
        test("calls stop", () => {
            const manager = new FooterManager(binaryService, notify);
            const session = createSessionCwd({ getCwd: "/tmp", sessionName: "S1" });

            const intervalIds: any[] = [];
            const originalSetInterval = global.setInterval;
            const originalClearInterval = global.clearInterval;
            (global as any).setInterval = (cb: () => void, ms: number) => {
                const id = originalSetInterval(cb, ms);
                intervalIds.push(id);
                return id;
            };
            (global as any).clearInterval = (id: any) => {
                originalClearInterval(id);
                const idx = intervalIds.indexOf(id);
                if (idx !== -1) intervalIds.splice(idx, 1);
            };

            try {
                manager.start(session);
                manager.dispose();
                assert.ok(
                    intervalIds.length === 0,
                    "expected interval to be cleared after dispose",
                );
            } finally {
                (global as any).setInterval = originalSetInterval;
                (global as any).clearInterval = originalClearInterval;
            }
        });
    });
});
