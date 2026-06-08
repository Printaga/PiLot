// ── Shared types used across webview components and extension host ──────────

/** Image content block in a message */
export interface ImageContent {
	type: "image";
	data: string;       // base64-encoded image data
	mimeType: string;   // e.g. "image/png"
}

/** A tool call message displayed in the UI */
export interface ToolCallMessage {
	tool: string;
	args: Record<string, unknown>;
	result?: string;
	status: "running" | "success" | "error";
	expandable: boolean;
	expanded: boolean;
}

/** A chat message in the webview */
export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	thinking?: string;
	images?: ImageContent[];
	timestamp: number;
	toolCalls?: ToolCallMessage[];
	isStreaming?: boolean;
	messageIndex?: number;
}

/** Model definition sent from extension to webview */
export interface Model {
	id: string;        // "provider/id"
	provider: string;
	name: string;
}

/** Session list item */
export interface SessionItem {
	id: string;
	label: string;
	timestamp: number;
	messageCount: number;
}

/** Session tree node (for tree view) */
export interface SessionNode {
	id: string;
	label: string;
	timestamp: number;
	children: SessionNode[];
	parent: string | null;
}

/** Voice helper message from the native process */
export interface VoiceHelperMessage {
	type: string;
	message?: string;
	text?: string;
	error?: string;
	code?: string;
	level?: number;
	speechActive?: boolean;
}

/** Voice model definition */
export interface VoiceModelDef {
	label: string;
	remoteFilename: string;
	cacheFilename: string;
	expectedSizeMb: number;
	englishOnly: boolean;
}

/** Thinking level enumeration */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Pi agent configuration */
export interface PiAgentConfig {
	defaultModel: string;
	defaultProvider: string;
	autoContext: boolean;
	maxTokens: number;
	thinkingLevel: ThinkingLevel;
	sessionDir?: string;
}
