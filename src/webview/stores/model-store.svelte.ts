// ── Model state store (Svelte 5 $state rune module) ─────────────────────────

import type { Model } from '../types/index.js';

let availableModels = $state<Model[]>([]);
let favoriteModels = $state<string[]>([]);
let currentModelId = $state<string | null>(null);

export function getAvailableModels(): Model[] {
	return availableModels;
}

export function setAvailableModels(models: Model[]): void {
	availableModels = models;
}

export function getFavoriteModels(): string[] {
	return favoriteModels;
}

export function setFavoriteModels(models: string[]): void {
	favoriteModels = models;
}

export function getCurrentModelId(): string | null {
	return currentModelId;
}

export function setCurrentModelId(id: string | null): void {
	currentModelId = id;
}
