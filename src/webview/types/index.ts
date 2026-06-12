// ── Shared types used across webview components and extension host ──────────

/** Image content block in a message */
export interface ImageContent {
	type: "image";
	data: string;       // base64-encoded image data
	mimeType: string;   // e.g. "image/png"
	name?: string;
}

export interface ToolCallResult {
	content?: string;
	details?: any;
	isError?: boolean;
}

export interface ToolCallMessage {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: ToolCallResult;
	isError?: boolean;
	status: "pending" | "streaming" | "complete";
}

/** A chat message in the webview */
export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
	thinking?: string;
	images?: ImageContent[];
	timestamp: number;
	isStreaming?: boolean;
	toolCalls?: ToolCallMessage[];
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

/** Tool configuration for getSettings/setToolConfig */
export interface ToolConfig {
	toolPreset: string;
	customTools?: string[];
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
