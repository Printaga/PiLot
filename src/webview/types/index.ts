// ── Shared types used across webview components and extension host ──────────

/** Image payload as produced by the agent/host (no display metadata).
 * Host sites re-declare this shape inline (message-serializer, provider,
 * session-resources) — keep those in sync when changing it. */
export interface ImagePayload {
  type: "image";
  data: string; // base64-encoded image data
  mimeType: string; // e.g. "image/png"
}

/** Image content block in a message (webview-side, may carry a display name) */
export interface ImageContent extends ImagePayload {
  name?: string;
}

/** Tool-specific payload rendered by MessageBubble; shape varies per tool.
 * Produced by the agent process across the host↔webview trust boundary, so it
 * is typed as loosely-known fields plus an index signature. */
export interface ToolCallDetails {
  entries?: unknown[];
  edits?: unknown[];
  output?: string;
  exitCode?: number;
  matches?: unknown[];
  files?: unknown[];
  bytes?: number;
  path?: string;
  [key: string]: unknown;
}

export interface ToolCallResult {
  content?: string;
  details?: ToolCallDetails;
  isError?: boolean;
}

export interface ToolCallMessage {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: ToolCallResult;
  /** Truthiness on the call itself takes precedence over `result.isError`. */
  isError?: boolean;
  status: "pending" | "streaming" | "complete";
}

/** A chat message in the webview.
 *
 * `provider` is used for extension/package injected messages (PI CLI custom
 * messages, i.e. `pi.sendMessage({ display: true })`). These render like the
 * PI CLI's CustomMessageComponent with markdown and a source label. */
export interface Message {
  role: "user" | "assistant" | "system" | "provider";
  content: string;
  thinking?: string;
  images?: ImageContent[];
  timestamp: number;
  entryId?: string;
  parentId?: string | null;
  isStreaming?: boolean;
  toolCalls?: ToolCallMessage[];
  /** Optional source label (e.g. custom message `customType`) shown in the header. */
  label?: string;
}

/** Model definition sent from extension to webview */
export interface Model {
  id: string; // "provider/id"
  provider: string;
  name: string;
  /** Thinking levels this model supports; absent when unknown (full set assumed). */
  availableThinkingLevels?: ThinkingLevel[];
}

/** Session list item. Mirrored by src/session-manager.ts and re-declared
 * locally in SessionTree.svelte (which keeps its runtime validator) — keep the
 * three shapes in sync. */
export interface SessionItem {
  id: string;
  label: string;
  timestamp: number;
  messageCount: number;
}

/** Tool configuration for getSettings/setToolConfig */
export interface ToolConfig {
  toolPreset: string;
  customTools?: string[];
}

/** Voice helper message from the native process. Known event names are
 * enumerated for compile-time coverage of the host switch; the `string & {}`
 * tail keeps the union open for forward-compatible helper versions. */
export interface VoiceHelperMessage {
  type:
    | "ready"
    | "prepared"
    | "started"
    | "permission"
    | "transcript"
    | "transcription"
    | "error"
    | "level"
    | (string & {});
  message?: string;
  text?: string;
  error?: string;
  code?: string;
  level?: number;
}

/** Voice model definition */
export interface VoiceModelDef {
  label: string;
  remoteFilename: string;
  cacheFilename: string;
  expectedSizeMb: number;
  englishOnly: boolean;
}

/** Keys for openConfigFile — webview mirror of the host's ConfigFileKey.
 * To add a key: extend the host's ConfigFileKey in src/protocol/types.ts AND
 * the host's OPEN_CONFIG_FILES allowlist in src/message-handler.ts; this union
 * must stay identical or the webview cannot open the new file. */
export type OpenConfigFileKey =
  "auth" | "models" | "settings" | "system-prompt" | "append-system-prompt";

/**
 * Thinking level enumeration.
 *
 * Single shared definition: this is THE type both the webview and the host
 * import (the host re-exports it from model-registry-handler, and the ordered
 * list lives in THINKING_LEVELS). Previously an identical union was repeated
 * inline in protocol/types.ts and drifted from this one.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Pi agent configuration.
 *
 * Single shared definition: the host (pi-agent-provider.ts) imports this from
 * here instead of declaring its own structurally-identical duplicate that could
 * drift from the webview's copy.
 */
export interface PiAgentConfig {
  defaultModel: string;
  defaultProvider: string;
  autoContext: boolean;
  maxTokens: number;
  thinkingLevel: ThinkingLevel;
  sessionDir?: string;
}
