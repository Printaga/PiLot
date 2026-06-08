// ── Session state store (Svelte 5 $state rune module) ──────────────────────

import type { Message, SessionItem } from '../types/index.js';

// ── Messages ─────────────────────────────────────────────────────────────

let messages = $state<Message[]>([]);
let isStreaming = $state(false);
let sessionId = $state<string | null>(null);
let sessionName = $state<string | null>(null);

export function getMessages(): Message[] {
	return messages;
}

export function setMessages(newMessages: Message[]): void {
	messages = newMessages;
}

export function addMessage(msg: Message): void {
	messages = [...messages, msg];
}

export function updateLastMessage(updater: (msg: Message) => Message): void {
	if (messages.length === 0) return;
	const updated = [...messages];
	updated[updated.length - 1] = updater(updated[updated.length - 1]!);
	messages = updated;
}

export function clearMessages(): void {
	messages = [];
}

export function getIsStreaming(): boolean {
	return isStreaming;
}

export function setIsStreaming(streaming: boolean): void {
	isStreaming = streaming;
}

export function getSessionId(): string | null {
	return sessionId;
}

export function setSessionId(id: string | null): void {
	sessionId = id;
}

export function getSessionName(): string | null {
	return sessionName;
}

export function setSessionName(name: string | null): void {
	sessionName = name;
}

// ── Session list ─────────────────────────────────────────────────────────

let sessions = $state<SessionItem[]>([]);

export function getSessions(): SessionItem[] {
	return sessions;
}

export function setSessions(newSessions: SessionItem[]): void {
	sessions = newSessions;
}

// ── Context / stats ──────────────────────────────────────────────────────

interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
	autoCompactionEnabled?: boolean;
}

let contextUsage = $state<ContextUsage | null>(null);

export function getContextUsage(): ContextUsage | null {
	return contextUsage;
}

export function setContextUsage(usage: ContextUsage | null): void {
	contextUsage = usage;
}

interface TokenStats {
	input: number;
	output: number;
	total: number;
	cacheRead?: number;
	cacheWrite?: number;
}

let tokenStats = $state<TokenStats | null>(null);

export function getTokenStats(): TokenStats | null {
	return tokenStats;
}

export function setTokenStats(stats: TokenStats | null): void {
	tokenStats = stats;
}
