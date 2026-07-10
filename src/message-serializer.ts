// ── Message serialization — converts AgentSession messages to webview format ─

/** Serialized message format sent to the webview */
export interface SerializedMessage {
	role: string;
	content: string;
	thinking?: string;
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
	timestamp: number;
	entryId?: string;
	parentId?: string | null;
	/** Source label for provider/custom messages (the custom message `customType`). */
	label?: string;
}

/** Content part types from AgentSession messages */
interface TextPart {
	type: "text";
	text?: string;
}

interface ThinkingPart {
	type: "thinking";
	thinking?: string;
}

/** Raw message from AgentSession before serialization.
 * Content is `any` to remain compatible with SDK's AgentMessage union
 * (which includes ToolCall parts we filter out at runtime). */
interface RawAgentMessage {
	role: string;
	content?: string | any[];
	timestamp?: number;
	toolName?: string;
	/** Custom (extension/package injected) message fields. */
	customType?: string;
	display?: boolean;
}

/** Extract joined text and images from a content value that is either a plain
 * string or an array of content blocks (text/image). */
function extractTextAndImages(content: string | any[] | undefined): {
	text: string;
	images: Array<{ type: "image"; data: string; mimeType: string }>;
} {
	if (typeof content === "string") return { text: content, images: [] };
	if (!Array.isArray(content)) return { text: "", images: [] };
	const textParts: string[] = [];
	const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	for (const c of content) {
		if (c.type === "text" && "text" in c) {
			textParts.push(c.text || "");
		} else if (c.type === "image" && "data" in c && "mimeType" in c) {
			images.push({ type: "image", data: c.data, mimeType: c.mimeType });
		}
	}
	return { text: textParts.join("\n"), images };
}

interface RawSessionEntry {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string | number;
	message?: RawAgentMessage;
}

function normalizeMessage(
	entryOrMessage: RawAgentMessage | RawSessionEntry,
): {
	message: RawAgentMessage;
	entryId?: string;
	parentId?: string | null;
	timestamp?: number;
} | null {
	if (
		"type" in entryOrMessage &&
		entryOrMessage.type === "message" &&
		entryOrMessage.message
	) {
		const timestamp =
			typeof entryOrMessage.timestamp === "string"
				? Date.parse(entryOrMessage.timestamp)
				: entryOrMessage.timestamp;
		return {
			message: entryOrMessage.message,
			entryId: entryOrMessage.id,
			parentId: entryOrMessage.parentId,
			timestamp,
		};
	}

	if ("role" in entryOrMessage) {
		return {
			message: entryOrMessage,
			timestamp: entryOrMessage.timestamp,
		};
	}

	return null;
}

/**
 * Serialize AgentSession messages into a webview-friendly format.
 * Handles user messages (text + images), assistant messages (text + thinking),
 * extension/package "custom" messages (surfaced as `provider` messages), and
 * tool results.
 */
export function serializeMessages(
	messages: Array<RawAgentMessage | RawSessionEntry>,
): SerializedMessage[] {
	const result: SerializedMessage[] = [];
	for (const item of messages) {
		const normalized = normalizeMessage(item);
		if (!normalized) continue;
		const { message: msg, entryId, parentId, timestamp } = normalized;

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({
					role: "user",
					content: msg.content,
					timestamp: timestamp ?? 0,
					entryId,
					parentId,
				});
			} else if (Array.isArray(msg.content)) {
				const textParts: string[] = [];
				const images: Array<{ type: "image"; data: string; mimeType: string }> =
					[];
				for (const c of msg.content) {
					if (c.type === "text" && "text" in c) {
						textParts.push(c.text || "");
					} else if (c.type === "image" && "data" in c && "mimeType" in c) {
						images.push({
							type: "image",
							data: c.data,
							mimeType: c.mimeType,
						});
					}
				}
				result.push({
					role: "user",
					content: textParts.join("\n"),
					images: images.length > 0 ? images : undefined,
					timestamp: timestamp ?? 0,
					entryId,
					parentId,
				});
			}
		} else if (msg.role === "assistant") {
			const content = Array.isArray(msg.content)
				? msg.content
						.filter((c): c is TextPart => c.type === "text")
						.map((c) => c.text)
						.join("\n")
				: String(msg.content ?? "");
			const thinkingParts = Array.isArray(msg.content)
				? msg.content
						.filter(
							(c): c is ThinkingPart =>
								c.type === "thinking" &&
								typeof c.thinking === "string" &&
								c.thinking.trim().length > 0,
						)
						.map((c) => c.thinking)
				: [];
			const thinking =
				thinkingParts.length > 0 ? thinkingParts.join("\n") : undefined;
			// Skip assistant messages that carry no renderable content (e.g. tool-call
			// only turns or redacted/empty thinking). The PI CLI renders these as tool
			// executions or nothing at all — emitting them here produced empty bubbles.
			if (!content.trim() && !thinking) {
				continue;
			}
			result.push({
				role: "assistant",
				content,
				thinking,
				timestamp: timestamp ?? 0,
				entryId,
				parentId,
			});
		} else if (msg.role === "custom") {
			// Extension/package injected messages (pi.sendMessage). The PI CLI renders
			// these via CustomMessageComponent when `display` is true; hidden ones
			// (display === false) are context-only and never surfaced in the UI.
			if (msg.display === false) continue;
			const { text, images } = extractTextAndImages(msg.content);
			if (!text.trim() && images.length === 0) continue;
			result.push({
				role: "provider",
				content: text,
				images: images.length > 0 ? images : undefined,
				label: msg.customType,
				timestamp: timestamp ?? 0,
				entryId,
				parentId,
			});
		} else if (msg.role === "toolResult") {
			const content = Array.isArray(msg.content)
				? msg.content
						.map((c) => (c.type === "text" && "text" in c ? c.text : "") || "")
						.join("\n")
				: "";
			result.push({
				role: "system",
				content: `[Tool: ${msg.toolName}] ${content.slice(0, 200)}`,
				timestamp: timestamp ?? 0,
				entryId,
				parentId,
			});
		}
	}
	return result;
}
