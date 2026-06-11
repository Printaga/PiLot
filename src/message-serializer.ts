// ── Message serialization — converts AgentSession messages to webview format ─

/** Serialized message format sent to the webview */
export interface SerializedMessage {
	role: string;
	content: string;
	thinking?: string;
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
	timestamp: number;
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
}

/**
 * Serialize AgentSession messages into a webview-friendly format.
 * Handles user messages (text + images), assistant messages (text + thinking),
 * and tool results.
 */
export function serializeMessages(
	messages: RawAgentMessage[],
): SerializedMessage[] {
	const result: SerializedMessage[] = [];
	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({
					role: "user",
					content: msg.content,
					timestamp: msg.timestamp ?? 0,
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
					timestamp: msg.timestamp ?? 0,
				});
			}
		} else if (msg.role === "assistant") {
			const content = Array.isArray(msg.content)
				? msg.content
						.filter((c): c is TextPart => c.type === "text")
						.map((c) => c.text)
						.join("\n")
				: String(msg.content);
			const thinking = Array.isArray(msg.content)
				? msg.content
						.filter((c): c is ThinkingPart => c.type === "thinking")
						.map((c) => c.thinking)
						.join("\n")
				: undefined;
			result.push({
				role: "assistant",
				content,
				thinking,
				timestamp: msg.timestamp ?? 0,
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
				timestamp: msg.timestamp ?? 0,
			});
		}
	}
	return result;
}
