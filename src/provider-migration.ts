/**
 * PI 1.4 renamed the Azure provider from `azure-openai-responses` to `azure`.
 * The API id (`azure-openai-responses`) still exists, so only provider-keyed
 * state moves: auth entries, default provider/model, scoped-model patterns and
 * PiLot's own favorites/current-model id.
 */
export const LEGACY_AZURE_PROVIDER_ID = "azure-openai-responses";
export const AZURE_PROVIDER_ID = "azure";

/** Rewrite a `provider/model` id (or a bare provider id) to the new provider. */
export function migrateAzureModelId(value: string): string {
	if (value === LEGACY_AZURE_PROVIDER_ID) return AZURE_PROVIDER_ID;
	const prefix = `${LEGACY_AZURE_PROVIDER_ID}/`;
	if (value.startsWith(prefix)) {
		return `${AZURE_PROVIDER_ID}/${value.slice(prefix.length)}`;
	}
	return value;
}

/**
 * Rewrite a list of ids/patterns, dropping duplicates that the rename creates
 * (for example a favorite for both the old and new id).
 */
export function migrateAzureModelIds(values: readonly string[]): {
	values: string[];
	changed: boolean;
} {
	const next = [...new Set(values.map(migrateAzureModelId))];
	const changed =
		next.length !== values.length || next.some((value, index) => value !== values[index]);
	return { values: next, changed };
}

/**
 * Move the legacy auth entry to the new provider. Existing `azure` credentials
 * win: a stale legacy entry must never overwrite credentials the user saved
 * under the new id.
 */
export function migrateAzureAuthConfig(config: Record<string, unknown>): {
	config: Record<string, unknown>;
	changed: boolean;
} {
	if (!(LEGACY_AZURE_PROVIDER_ID in config)) return { config, changed: false };
	if (AZURE_PROVIDER_ID in config) return { config, changed: false };
	const next = { ...config };
	next[AZURE_PROVIDER_ID] = next[LEGACY_AZURE_PROVIDER_ID];
	delete next[LEGACY_AZURE_PROVIDER_ID];
	return { config: next, changed: true };
}
