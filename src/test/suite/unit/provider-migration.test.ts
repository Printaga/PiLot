import * as assert from "node:assert";
import {
	AZURE_PROVIDER_ID,
	LEGACY_AZURE_PROVIDER_ID,
	migrateAzureAuthConfig,
	migrateAzureModelId,
	migrateAzureModelIds,
} from "../../../provider-migration.js";

suite("provider-migration", () => {
	suite("migrateAzureModelId", () => {
		test("rewrites the bare provider id", () => {
			assert.strictEqual(migrateAzureModelId(LEGACY_AZURE_PROVIDER_ID), AZURE_PROVIDER_ID);
		});

		test("rewrites provider/model ids and keeps the model", () => {
			assert.strictEqual(
				migrateAzureModelId(`${LEGACY_AZURE_PROVIDER_ID}/gpt-5.6`),
				`${AZURE_PROVIDER_ID}/gpt-5.6`,
			);
			assert.strictEqual(
				migrateAzureModelId(`${LEGACY_AZURE_PROVIDER_ID}/*`),
				`${AZURE_PROVIDER_ID}/*`,
			);
		});

		test("leaves other providers and partial matches alone", () => {
			assert.strictEqual(
				migrateAzureModelId("anthropic/claude-sonnet-4-5"),
				"anthropic/claude-sonnet-4-5",
			);
			assert.strictEqual(
				migrateAzureModelId(`${LEGACY_AZURE_PROVIDER_ID}-extra/model`),
				`${LEGACY_AZURE_PROVIDER_ID}-extra/model`,
			);
			assert.strictEqual(migrateAzureModelId("azure/gpt-5.6"), "azure/gpt-5.6");
		});
	});

	suite("migrateAzureModelIds", () => {
		test("rewrites and de-duplicates while preserving order", () => {
			const result = migrateAzureModelIds([
				"openai/gpt-5.6",
				`${LEGACY_AZURE_PROVIDER_ID}/gpt-5.6`,
				`${AZURE_PROVIDER_ID}/gpt-5.6`,
			]);
			assert.deepStrictEqual(result, {
				values: ["openai/gpt-5.6", `${AZURE_PROVIDER_ID}/gpt-5.6`],
				changed: true,
			});
		});

		test("reports no change when nothing references the legacy id", () => {
			const input = ["openai/gpt-5.6", `${AZURE_PROVIDER_ID}/*`];
			assert.deepStrictEqual(migrateAzureModelIds(input), { values: input, changed: false });
		});
	});

	suite("migrateAzureAuthConfig", () => {
		test("moves the legacy entry and preserves everything else", () => {
			const input = {
				[LEGACY_AZURE_PROVIDER_ID]: { type: "api_key", key: "azure-key" },
				openai: { type: "api_key", key: "openai-key" },
				cloudflare: { type: "api_key", key: "cf", env: { ACCOUNT_ID: "x" } },
			};
			const result = migrateAzureAuthConfig(input);
			assert.strictEqual(result.changed, true);
			assert.deepStrictEqual(result.config, {
				[AZURE_PROVIDER_ID]: { type: "api_key", key: "azure-key" },
				openai: { type: "api_key", key: "openai-key" },
				cloudflare: { type: "api_key", key: "cf", env: { ACCOUNT_ID: "x" } },
			});
			assert.ok(!(LEGACY_AZURE_PROVIDER_ID in result.config));
			// The input is not mutated.
			assert.ok(LEGACY_AZURE_PROVIDER_ID in input);
		});

		test("does not overwrite credentials already stored under the new id", () => {
			const input = {
				[LEGACY_AZURE_PROVIDER_ID]: { type: "api_key", key: "old" },
				[AZURE_PROVIDER_ID]: { type: "api_key", key: "new" },
			};
			const result = migrateAzureAuthConfig(input);
			assert.strictEqual(result.changed, false);
			assert.deepStrictEqual(result.config, input);
		});

		test("is a no-op without a legacy entry", () => {
			const input = { openai: { type: "api_key", key: "openai-key" } };
			assert.deepStrictEqual(migrateAzureAuthConfig(input), {
				config: input,
				changed: false,
			});
		});
	});
});
