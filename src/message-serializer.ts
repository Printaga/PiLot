// ── Message serialization — converts AgentSession messages to webview format ─

/** Serialized message format sent to the webview */
export interface SerializedMessage {
	role: string;
	content: string;
	thinking?: string;
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
	timestamp: number;
}

/**
 * Serialize AgentSession messages into a webview-friendly format.
 * Handles user messages (text + images), assistant messages (text + thinking),
 * and tool results.
 */
export function serializeMessages(messages: any[]): SerializedMessage[] {
	const result: SerializedMessage[] = [];
	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({ role: "user", content: msg.content, timestamp: msg.timestamp });
			} else if (Array.isArray(msg.content)) {
				const textParts: string[] = [];
				const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
				for (const c of msg.content) {
					if (c.type === "text") {
						textParts.push(c.text || "");
					} else if (c.type === "image" && c.data && c.mimeType) {
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
					timestamp: msg.timestamp,
				});
			}
		} else if (msg.role === "assistant") {
			const content = Array.isArray(msg.content)
				? msg.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n")
				: "";
			const thinking = Array.isArray(msg.content)
				? msg.content
						.filter((c: any) => c.type === "thinking")
						.map((c: any) => c.thinking)
						.join("\n")
				: undefined;
			result.push({
				role: "assistant",
				content,
				thinking,
				timestamp: msg.timestamp,
			});
		} else if (msg.role === "toolResult") {
			const content = Array.isArray(msg.content)
				? msg.content.map((c: any) => c.text || "").join("\n")
				: "";
			result.push({
				role: "system",
				content: `[Tool: ${msg.toolName}] ${content.slice(0, 200)}`,
				timestamp: msg.timestamp,
			});
		}
	}
	return result;
}
