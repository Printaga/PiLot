// ── UI state store (Svelte 5 $state rune module) ────────────────────────────

import type { ThinkingLevel } from '../types/index.js';

type Tab = 'chat' | 'sessions' | 'models' | 'packages' | 'settings' | 'tools';

let activeTab = $state<Tab>('chat');
let isListening = $state(false);
let draftInputText = $state('');
let thinkingLevel = $state<ThinkingLevel>('medium');
let autoCompactionEnabled = $state(true);

// ── Tab management ──────────────────────────────────────────────────────

export function getActiveTab(): Tab {
	return activeTab;
}

export function setActiveTab(tab: Tab): void {
	activeTab = tab;
}

// ── Voice ────────────────────────────────────────────────────────────────

export function getIsListening(): boolean {
	return isListening;
}

export function setIsListening(listening: boolean): void {
	isListening = listening;
}

// ── Input ────────────────────────────────────────────────────────────────

export function getDraftInputText(): string {
	return draftInputText;
}

export function setDraftInputText(text: string): void {
	draftInputText = text;
}

// ── Thinking level ──────────────────────────────────────────────────────

export function getThinkingLevel(): ThinkingLevel {
	return thinkingLevel;
}

export function setThinkingLevel(level: ThinkingLevel): void {
	thinkingLevel = level;
}

// ── Auto-compaction ─────────────────────────────────────────────────────

export function getAutoCompactionEnabled(): boolean {
	return autoCompactionEnabled;
}

export function setAutoCompactionEnabled(enabled: boolean): void {
	autoCompactionEnabled = enabled;
}
