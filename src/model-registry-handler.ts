import * as vscode from "vscode";
import {
	type ModelRegistry,
	type AuthStorage,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type BinaryService } from "./binary-service.js";
import { execFileAsync } from "./utils/shell.js";

type RegistryModel = { provider: string; id: string; name?: string };

export interface ModelItem {
	id: string;
	provider: string;
	name: string;
}

export interface ModelRegistryHandlerDeps {
	getModelRegistry: () => ModelRegistry | undefined;
	getAuthStorage: () => AuthStorage | undefined;
	getSettingsManager: () => SettingsManager | undefined;
	binaryService: BinaryService;
	availableModels: ModelItem[];
	favoriteModels: string[];
	currentModelId: string | null;
	globalState: vscode.Memento;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logError: (msg: string, error?: unknown) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
}

export class ModelRegistryHandler {
	private cliModelIdsCache: Set<string> | null = null;
	private cliModelIdsPromise: Promise<Set<string>> | null = null;

	constructor(private readonly deps: ModelRegistryHandlerDeps) {}

	getAvailableModels(): ModelItem[] {
		return this.deps.availableModels;
	}

	getCurrentModelId(): string | null {
		return this.deps.currentModelId;
	}

	getFavorites(): string[] {
		return this.deps.favoriteModels;
	}

	async getMergedModels(): Promise<RegistryModel[]> {
		const modelRegistry = this.deps.getModelRegistry();
		if (!modelRegistry) return [];
		const available = await modelRegistry.getAvailable();
		const all = modelRegistry.getAll();
		const merged = new Map<string, RegistryModel>();

		for (const m of all) {
			merged.set(m.provider + "/" + m.id, m);
		}

		for (const m of available) {
			merged.set(m.provider + "/" + m.id, m);
		}

		return [...merged.values()];
	}

	buildModelList(models: RegistryModel[]): ModelItem[] {
		return models
			.map((m) => ({
				id: m.provider + "/" + m.id,
				provider: m.provider,
				name: m.name || m.id,
			}))
			.sort(
				(a, b) =>
					a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
			);
	}

	async refreshAvailableModels(): Promise<void> {
		const modelRegistry = this.deps.getModelRegistry();
		if (!modelRegistry) return;
		// Reload models from disk (re-reads models.json and re-applies registered providers).
		// Without this, getMergedModels() returns stale data from initial construction.
		modelRegistry.refresh();
		const models = await this.getMergedModels();
		this.deps.availableModels = this.buildModelList(models);
		this.deps.notifyWebview({
			type: "models-updated",
			data: { models: this.deps.availableModels },
		});
	}

	/**
	 * Get the set of model IDs known to the user's PI CLI.
	 * Runs `pi --list-models` and parses the output.
	 * Cached for the session lifetime; invalidated on auth changes.
	 */
	async getCliModelIds(): Promise<Set<string>> {
		if (this.cliModelIdsCache) return this.cliModelIdsCache;
		if (!this.cliModelIdsPromise) {
			this.cliModelIdsPromise = this.resolveCliModelIds()
				.then((ids) => {
					this.cliModelIdsCache = ids;
					return ids;
				})
				.catch(() => {
					this.cliModelIdsCache = new Set();
					return this.cliModelIdsCache;
				});
		}
		return this.cliModelIdsPromise;
	}

	private resolveCliModelIds(): Promise<Set<string>> {
		const binaryPath = this.deps.binaryService.getBinaryPath();
		return execFileAsync(binaryPath, ["--list-models"])
			.then(({ stdout, stderr }) => {
				const output = (stderr || "") + "\n" + (stdout || "");
				const models = new Set<string>();

				for (const line of output.split("\n")) {
					// Match: "provider  modelId  context  max-out  thinking  images"
					const match = line.match(/^(\S+)\s+(\S+)\s+\S/);
					if (
						match &&
						match[1] !== "provider" &&
						!match[0].startsWith("Warning")
					) {
						models.add(`${match[1]}/${match[2]}`);
					}
				}

				return models;
			})
			.catch(() => {
				this.deps.logError(
					"[PI] Failed to list CLI models - is 'pi' installed and on PATH?",
				);
				return new Set<string>();
			});
	}

	/**
	 * Sync favorites to PI CLI's settings.json (enabledModels).
	 * Only writes patterns that the PI CLI actually knows about,
	 * preventing warnings from version mismatches.
	 */
	async syncFavoritesToSettings(): Promise<void> {
		const settingsManager = this.deps.getSettingsManager();
		if (!settingsManager) return;

		const cliModels = await this.getCliModelIds();

		// If CLI not available or not yet resolved, skip sync
		if (cliModels.size === 0) return;

		// Only write patterns that the CLI actually knows about
		const validPatterns = this.deps.favoriteModels.filter((pattern) =>
			cliModels.has(pattern),
		);

		settingsManager.setEnabledModels(validPatterns);
		await settingsManager.flush();
	}

	/**
	 * Merge PI CLI's scoped models into extension favorites.
	 * Picks up models set outside the extension (e.g., via Ctrl+P in PI CLI).
	 */
	async syncFromCliModels(): Promise<void> {
		const cliModels = await this.getCliModelIds();
		if (cliModels.size === 0) return;

		const settingsManager = this.deps.getSettingsManager();
		const settingsModels = settingsManager?.getEnabledModels() || [];
		if (settingsModels.length === 0) return;

		// Add CLI models that the extension also knows about
		const newModels = settingsModels.filter(
			(pattern) =>
				cliModels.has(pattern) &&
				this.deps.availableModels.some((m) => m.id === pattern) &&
				!this.deps.favoriteModels.includes(pattern),
		);

		if (newModels.length > 0) {
			this.deps.favoriteModels = [...this.deps.favoriteModels, ...newModels];
			await this.deps.globalState.update(
				"favoriteModels",
				this.deps.favoriteModels,
			);
			this.deps.notifyWebview({
				type: "favorites-updated",
				data: { favorites: this.deps.favoriteModels },
			});
		}
	}

	async toggleFavorite(
		modelId: string,
		isFavorite: boolean,
	): Promise<string[]> {
		if (isFavorite && !this.deps.favoriteModels.includes(modelId)) {
			// Guard: only add models that exist in the current registry
			if (!this.deps.availableModels.some((m) => m.id === modelId)) {
				return this.deps.favoriteModels;
			}
			this.deps.favoriteModels = [...this.deps.favoriteModels, modelId];
		} else if (!isFavorite) {
			this.deps.favoriteModels = this.deps.favoriteModels.filter(
				(m) => m !== modelId,
			);
		}
		await this.deps.globalState.update(
			"favoriteModels",
			this.deps.favoriteModels,
		);

		// Sync to PI CLI settings.json (validates against CLI model list)
		await this.syncFavoritesToSettings();

		return this.deps.favoriteModels;
	}

	async cycleModel(): Promise<void> {
		const models = this.deps.availableModels;
		if (models.length === 0) return;

		const currentIndex = models.findIndex(
			(m) => m.id === this.deps.currentModelId,
		);
		const nextModel = models[(currentIndex + 1) % models.length];
		if (nextModel) {
			this.deps.currentModelId = nextModel.id;
			await this.deps.globalState.update("currentModelId", nextModel.id);
			this.deps.notifyWebview({
				type: "model-changed",
				data: { modelId: nextModel.id },
			});
		}
	}

	/** Invalidate CLI model IDs cache (call after auth changes). */
	invalidateCliModelIdsCache(): void {
		this.cliModelIdsCache = null;
		this.cliModelIdsPromise = null;
	}
}
