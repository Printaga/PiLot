import * as assert from "assert";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
    ModelRegistryHandler,
    ModelRegistryHandlerDeps,
    type ModelItem,
} from "../../../model-registry-handler.js";
import type {
    ModelRegistry,
    ModelRuntime,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { BinaryService } from "../../../binary-service.js";
import { createMockMemento } from "../../mocks/pi-sdk-mocks.js";

const TMP_PREFIX = path.join(os.tmpdir(), "pilot-cli-mock-");
let scriptCounter = 0;
let currentNotifyMessages: any[] = [];

function buildDeps(
    overrides: Partial<ModelRegistryHandlerDeps> = {},
): ModelRegistryHandlerDeps {
    const base: ModelRegistryHandlerDeps = {
        getModelRegistry: () => undefined,
        getModelRuntime: () => undefined,
        getSettingsManager: () => undefined,
        binaryService: { getBinaryPath: () => "/fake/pi" } as unknown as BinaryService,
        availableModels: [],
        favoriteModels: [],
        currentModelId: null,
        globalState: createMockMemento() as any,
        notifyWebview: (message: { type: string; data?: unknown }) => {
            currentNotifyMessages.push(message);
        },
        logError: () => {},
        logDebug: () => {},
    };
    return { ...base, ...overrides };
}

function createCliScript(models: string[]): string {
    const filePath = `${TMP_PREFIX}${++scriptCounter}.sh`;
    const content = models
        .map((m) => {
            const [prov, id] = m.split("/") as [string, string];
            return `${prov}  ${id}  123  456  off  false`;
        })
        .join("\n");
    fs.writeFileSync(filePath, "#!/bin/sh\n" + content + "\n");
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

async function cleanupCliScript(filePath: string): Promise<void> {
    try {
        await fsp.unlink(filePath);
    } catch {
        // best-effort cleanup
    }
}

suite("ModelRegistryHandler", () => {
    let handler: ModelRegistryHandler;
    let notifyMessages: any[];
    let deps: any;

    setup(() => {
        notifyMessages = [];
        currentNotifyMessages = notifyMessages;
    });

    teardown(() => {
        handler = undefined as any;
        deps = undefined as any;
        notifyMessages = [];
        currentNotifyMessages = [];
    });

    suite("getAvailableModels / getCurrentModelId / getFavorites", () => {
        test("getAvailableModels returns availableModels", () => {
            const models: ModelItem[] = [{ id: "p/m1", provider: "p", name: "M1" }];
            handler = new ModelRegistryHandler(buildDeps({ availableModels: models }));
            assert.deepStrictEqual(handler.getAvailableModels(), models);
        });

        test("getCurrentModelId returns set id", () => {
            handler = new ModelRegistryHandler(buildDeps({ currentModelId: "p/m1" }));
            assert.strictEqual(handler.getCurrentModelId(), "p/m1");
        });

        test("getCurrentModelId returns null when unset", () => {
            handler = new ModelRegistryHandler(buildDeps({ currentModelId: null }));
            assert.strictEqual(handler.getCurrentModelId(), null);
        });

        test("getFavorites returns favoriteModels", () => {
            const favorites = ["a/b", "c/d"];
            handler = new ModelRegistryHandler(buildDeps({ favoriteModels: favorites }));
            assert.deepStrictEqual(handler.getFavorites(), favorites);
        });
    });

    suite("getMergedModels", () => {
        test("returns empty array when registry unavailable", async () => {
            handler = new ModelRegistryHandler(
                buildDeps({ getModelRegistry: () => undefined }),
            );
            const result = await handler.getMergedModels();
            assert.deepStrictEqual(result, []);
        });

        test("merges all and available models", async () => {
            const all = [
                { provider: "p1", id: "m1", name: "M1-all" },
                { provider: "p2", id: "m2", name: "M2" },
            ];
            const available = [
                { provider: "p1", id: "m1", name: "M1-avail" },
                { provider: "p3", id: "m3" },
            ];
            const registry: ModelRegistry = {
                getAvailable: async () => available,
                getAll: () => all,
            } as any;

            handler = new ModelRegistryHandler(buildDeps({ getModelRegistry: () => registry }));
            const result = await handler.getMergedModels();

            assert.strictEqual(result.length, 3);
            const m1 = result.find((m: any) => m.provider === "p1" && m.id === "m1");
            assert.ok(m1, "expected p1/m1 to exist");
            assert.strictEqual(m1.name, "M1-avail");
        });

        test("available entry overrides all with same key", async () => {
            const all = [{ provider: "p1", id: "m1", name: "M1-all" }];
            const available = [{ provider: "p1", id: "m1", name: "M1-avail" }];
            const registry: ModelRegistry = {
                getAvailable: async () => available,
                getAll: () => all,
            } as any;

            handler = new ModelRegistryHandler(buildDeps({ getModelRegistry: () => registry }));
            const result = await handler.getMergedModels();

            assert.strictEqual(result.length, 1);
            assert.strictEqual((result[0] as any).name, "M1-avail");
        });

        test("returns empty when both lists are empty", async () => {
            const registry: ModelRegistry = {
                getAvailable: async () => [],
                getAll: () => [],
            } as any;

            handler = new ModelRegistryHandler(buildDeps({ getModelRegistry: () => registry }));
            const result = await handler.getMergedModels();
            assert.deepStrictEqual(result, []);
        });
    });

    suite("buildModelList", () => {
        test("returns empty array for empty input", () => {
            handler = new ModelRegistryHandler(buildDeps());
            assert.deepStrictEqual(handler.buildModelList([]), []);
        });

        test("maps a single model correctly", () => {
            handler = new ModelRegistryHandler(buildDeps());
            const result = handler.buildModelList([
                { provider: "openai", id: "gpt-4", name: "GPT-4" },
            ]);
            assert.deepStrictEqual(result, [
                { id: "openai/gpt-4", provider: "openai", name: "GPT-4" },
            ]);
        });

        test("falls back to id when name is missing", () => {
            handler = new ModelRegistryHandler(buildDeps());
            const result = handler.buildModelList([
                { provider: "openai", id: "gpt-4" },
            ]);
            assert.strictEqual(result[0].name, "gpt-4");
        });

        test("sorts by provider then name", () => {
            handler = new ModelRegistryHandler(buildDeps());
            const result = handler.buildModelList([
                { provider: "z", id: "m3", name: "M3" },
                { provider: "a", id: "m2", name: "M2" },
                { provider: "a", id: "m1", name: "M1" },
            ]);
            assert.deepStrictEqual(result.map((m: any) => m.provider), ["a", "a", "z"]);
            assert.deepStrictEqual(result.map((m: any) => m.name), ["M1", "M2", "M3"]);
        });
    });

    suite("refreshAvailableModels", () => {
        test("no-op when registry unavailable", async () => {
            deps = buildDeps({ getModelRegistry: () => undefined });
            handler = new ModelRegistryHandler(deps);
            await handler.refreshAvailableModels();
            assert.deepStrictEqual(deps.availableModels, []);
            assert.ok(
                !notifyMessages.some((m: any) => m.type === "models-updated"),
                "should not notify when registry unavailable",
            );
        });

        test("updates list and sends models-updated", async () => {
            const registryModels = [
                { provider: "openai", id: "gpt-4", name: "GPT-4" },
            ];
            const registry: ModelRegistry = {
                getAvailable: async () => registryModels,
                getAll: () => [],
            } as any;

            deps = buildDeps({ getModelRegistry: () => registry });
            handler = new ModelRegistryHandler(deps);

            await handler.refreshAvailableModels();

            assert.ok(deps.availableModels.length > 0);
            assert.ok(
                notifyMessages.some((m: any) => m.type === "models-updated"),
                "expected models-updated notification",
            );
        });
    });

    suite("getCliModelIds", () => {
        test("cache hit on second call after resolution", async () => {
            const models = ["openai/gpt-4"];
            const scriptPath = createCliScript(models);
            try {
                handler = new ModelRegistryHandler(
                    buildDeps({
                        binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                    }),
                );

                const first = await handler.getCliModelIds();
                assert.ok(first.has("openai/gpt-4"));

                const second = await handler.getCliModelIds();
                assert.strictEqual(first, second, "should return same cached instance");
                assert.ok(second.has("openai/gpt-4"));
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });

        test("concurrent calls share the same promise", async () => {
            const models = ["openai/gpt-4", "anthropic/claude-3"];
            const scriptPath = createCliScript(models);
            try {
                handler = new ModelRegistryHandler(
                    buildDeps({
                        binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                    }),
                );

                const [first, second] = await Promise.all([
                    handler.getCliModelIds(),
                    handler.getCliModelIds(),
                ]);
                assert.ok(first.has("openai/gpt-4"));
                assert.ok(first.has("anthropic/claude-3"));
                assert.strictEqual(first, second);
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });

        test("returns empty set when binary is missing or fails", async () => {
            handler = new ModelRegistryHandler(
                buildDeps({
                    binaryService: { getBinaryPath: () => "/nonexistent/binary" } as unknown as BinaryService,
                }),
            );
            const ids = await handler.getCliModelIds();
            assert.ok(ids instanceof Set);
            assert.strictEqual(ids.size, 0);
        });
    });

    suite("invalidateCliModelIdsCache", () => {
        test("resets cache and promise", async () => {
            const models = ["openai/gpt-4"];
            const scriptPath = createCliScript(models);
            try {
                handler = new ModelRegistryHandler(
                    buildDeps({
                        binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                    }),
                );

                await handler.getCliModelIds();
                assert.ok((handler as any).cliModelIdsCache, "cache should be set after resolution");

                handler.invalidateCliModelIdsCache();
                assert.strictEqual((handler as any).cliModelIdsCache, null);
                assert.strictEqual((handler as any).cliModelIdsPromise, null);
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });
    });

    suite("syncFavoritesToSettings", () => {
        test("no-op when no settingsManager", async () => {
            // eslint-disable-next-line prefer-const
            let flushed = false;

            handler = new ModelRegistryHandler(
                buildDeps({ getSettingsManager: () => undefined }),
            );
            await handler.syncFavoritesToSettings();
            assert.ok(!flushed, "should not write when settingsManager is missing");
        });

        test("no-op when CLI models is empty", async () => {
            let flushed = false;
            const settingsManager = {
                getEnabledModels: () => [],
                setEnabledModels: async () => {
                    flushed = true;
                },
                flush: async () => {
                    flushed = true;
                },
            } as unknown as SettingsManager;

            handler = new ModelRegistryHandler(
                buildDeps({
                    getSettingsManager: () => settingsManager,
                    binaryService: { getBinaryPath: () => "/nonexistent" } as unknown as BinaryService,
                    favoriteModels: ["openai/gpt-4"],
                }),
            );
            await handler.syncFavoritesToSettings();
            assert.ok(!flushed, "should not write when CLI models empty");
        });

        test("writes only known CLI models to settings", async () => {
            const written: string[] = [];
            let flushed = false;
            const settingsManager = {
                getEnabledModels: () => [],
                setEnabledModels: async (m: string[]) => {
                    written.push(...m);
                },
                flush: async () => {
                    flushed = true;
                },
            } as unknown as SettingsManager;
            const scriptPath = createCliScript(["openai/gpt-4", "anthropic/claude-3"]);
            try {
                handler = new ModelRegistryHandler(
                    buildDeps({
                        getSettingsManager: () => settingsManager,
                        binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                        favoriteModels: ["openai/gpt-4", "unknown/model"],
                    }),
                );

                await handler.syncFavoritesToSettings();
                assert.deepStrictEqual(written, ["openai/gpt-4"]);
                assert.ok(flushed, "should flush after setting enabled models");
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });
    });

    suite("syncFromCliModels", () => {
        test("no-op when CLI models is empty", async () => {
            let notified = false;
            const settingsManager = {
                getEnabledModels: () => [],
                setEnabledModels: async () => {},
            } as unknown as SettingsManager;

            deps = buildDeps({
                getSettingsManager: () => settingsManager,
                availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                binaryService: { getBinaryPath: () => "/nonexistent" } as unknown as BinaryService,
            });
            handler = new ModelRegistryHandler({ ...deps, notifyWebview: () => { notified = true; } });
            await handler.syncFromCliModels();
            assert.ok(!notified);
        });

        test("no-op when no settingsManager", async () => {
            const scriptPath = createCliScript(["openai/gpt-4"]);
            try {
                deps = buildDeps({
                    availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                    binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                    favoriteModels: [],
                });
                handler = new ModelRegistryHandler({
                    ...deps,
                    getSettingsManager: () => undefined,
                    notifyWebview: () => {},
                });
                await handler.syncFromCliModels();
                assert.deepStrictEqual(deps.favoriteModels, []);
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });

        test("adds new CLI models to favorites", async () => {
            let updated = false;
            const settingsManager = {
                getEnabledModels: () => ["openai/gpt-4"],
                setEnabledModels: async () => {},
            } as unknown as SettingsManager;
            const scriptPath = createCliScript(["openai/gpt-4"]);
            try {
                deps = buildDeps({
                    getSettingsManager: () => settingsManager,
                    availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                    favoriteModels: [],
                    notifyWebview: () => {
                        updated = true;
                    },
                });
                handler = new ModelRegistryHandler({
                    ...deps,
                    binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                });

                await handler.syncFromCliModels();
                assert.ok(deps.favoriteModels.includes("openai/gpt-4"));
                assert.ok(updated, "should notify webview of favorites update");
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });

        test("does not add duplicates", async () => {
            const settingsManager = {
                getEnabledModels: () => ["openai/gpt-4"],
                setEnabledModels: async () => {},
            } as unknown as SettingsManager;
            const scriptPath = createCliScript(["openai/gpt-4"]);
            try {
                deps = buildDeps({
                    getSettingsManager: () => settingsManager,
                    availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                    favoriteModels: ["openai/gpt-4"],
                });
                handler = new ModelRegistryHandler({
                    ...deps,
                    binaryService: { getBinaryPath: () => scriptPath } as unknown as BinaryService,
                });
                await handler.syncFromCliModels();
                assert.deepStrictEqual(deps.favoriteModels, ["openai/gpt-4"]);
            } finally {
                await cleanupCliScript(scriptPath);
            }
        });
    });

    suite("toggleFavorite", () => {
        test("skips adding unknown model id", async () => {
            const settingsManager = {
                getEnabledModels: () => [],
                setEnabledModels: async () => {},
                flush: async () => {},
            } as unknown as SettingsManager;
            deps = buildDeps({
                getSettingsManager: () => settingsManager,
                availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                favoriteModels: [],
            });
            handler = new ModelRegistryHandler(deps);
            const result = await handler.toggleFavorite("unknown/model", true);
            assert.ok(!result.includes("unknown/model"));
        });

        test("adds known model to favorites", async () => {
            let written: string[] | undefined;
            const settingsManager = {
                getEnabledModels: () => [],
                setEnabledModels: async (models: string[]) => {
                    written = models;
                },
                flush: async () => {},
            } as unknown as SettingsManager;
            deps = buildDeps({
                getSettingsManager: () => settingsManager,
                availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                favoriteModels: [],
            });
            handler = new ModelRegistryHandler(deps);
            const result = await handler.toggleFavorite("openai/gpt-4", true);
            assert.ok(result.includes("openai/gpt-4"));
            assert.ok(written?.includes("openai/gpt-4"), "expected settingsManager to be updated");
        });

        test("removes model from favorites without guard", async () => {
            deps = buildDeps({
                availableModels: [{ id: "openai/gpt-4", provider: "openai", name: "GPT-4" }],
                favoriteModels: ["openai/gpt-4"],
            });
            handler = new ModelRegistryHandler(deps);
            const result = await handler.toggleFavorite("openai/gpt-4", false);
            assert.ok(!result.includes("openai/gpt-4"));
        });
    });

    suite("cycleModel", () => {
        test("no-op when no available models", async () => {
            deps = buildDeps({ availableModels: [], currentModelId: null });
            handler = new ModelRegistryHandler({
                ...deps,
                notifyWebview: () => {
                    assert.fail("should not notify when models are empty");
                },
            });
            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, null);
        });

        test("wraps to itself when currentId matches the only model", async () => {
            const models: ModelItem[] = [
                { id: "p/m1", provider: "p", name: "M1" },
            ];
            deps = buildDeps({
                availableModels: models,
                currentModelId: "p/m1",
                notifyWebview: () => {},
            });
            handler = new ModelRegistryHandler(deps);
            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, "p/m1");
        });

        test("cycles through multiple models", async () => {
            const models: ModelItem[] = [
                { id: "p/m1", provider: "p", name: "M1" },
                { id: "p/m2", provider: "p", name: "M2" },
                { id: "p/m3", provider: "p", name: "M3" },
            ];
            deps = buildDeps({
                availableModels: models,
                currentModelId: "p/m1",
                notifyWebview: () => {},
            });
            handler = new ModelRegistryHandler(deps);

            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, "p/m2");

            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, "p/m3");

            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, "p/m1");
        });

        test("wraps to first model when currentId is unset", async () => {
            const models: ModelItem[] = [
                { id: "p/m1", provider: "p", name: "M1" },
                { id: "p/m2", provider: "p", name: "M2" },
            ];
            deps = buildDeps({
                availableModels: models,
                currentModelId: null,
                notifyWebview: () => {},
            });
            handler = new ModelRegistryHandler(deps);
            await handler.cycleModel();
            assert.strictEqual(deps.currentModelId, "p/m1");
        });
    });
});
