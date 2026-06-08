// ── Slash command handler — processes /commands in chat input ──────────────

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { serializeMessages } from "./message-serializer.js";

/** Context provided to slash command handlers */
export interface SlashCommandContext {
	notifyWebview(message: { type: string; data?: unknown }): void;
	logError(msg: string, error?: unknown): void;
	session: {
		sessionName: string | undefined;
		sessionId: string;
		setSessionName(name: string): void;
		compact(topic?: string): Promise<any>;
		getSessionStats(): any;
		exportToJsonl(filePath?: string): string;
		exportToHtml(filePath?: string): Promise<string>;
		getLastAssistantText(): string | undefined;
		messages: any[];
	} | undefined;
	forkSession(fromNodeId?: string): Promise<void>;
	sendSessionResources(): Promise<void>;
}

/**
 * Try to handle a slash command locally. Returns true if handled,
 * false if the command should be forwarded to the session as a prompt.
 */
export async function tryHandleSlashCommand(
	text: string,
	ctx: SlashCommandContext,
): Promise<boolean> {
	const spaceIndex = text.indexOf(" ");
	const command =
		spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

	switch (command) {
		// ── UI-triggered commands ──────────────────
		case "model":
			ctx.notifyWebview({ type: "pickModel" });
			return true;
		case "new":
			ctx.notifyWebview({ type: "new-session" });
			return true;
		case "login":
			ctx.notifyWebview({ type: "show-login" });
			return true;
		case "settings":
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"pi-agent",
			);
			return true;
		case "resume":
			ctx.notifyWebview({ type: "switchTab", data: { tab: "sessions" } });
			return true;
		case "scoped-models":
			ctx.notifyWebview({ type: "switchTab", data: { tab: "models" } });
			return true;

		// ── Session-level commands ─────────────────
		case "name": {
			if (!ctx.session) return true;
			const name = args;
			if (!name) {
				const current = ctx.session.sessionName;
				ctx.notifyWebview({
					type: "system-message",
					data: {
						message: current
							? `Session name: ${current}`
							: "Usage: /name <name>",
					},
				});
			} else {
				ctx.session.setSessionName(name);
				ctx.notifyWebview({
					type: "system-message",
					data: { message: `Session name set: ${name}` },
				});
			}
			return true;
		}

		case "compact": {
			if (!ctx.session) return true;
			try {
				await ctx.session.compact(args || undefined);
				ctx.notifyWebview({
					type: "compact-result",
					data: { success: true },
				});
			} catch (error) {
				ctx.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
			}
			return true;
		}

		case "session": {
			if (!ctx.session) return true;
			try {
				const stats = ctx.session.getSessionStats();
				const name = ctx.session.sessionName;
				const lines: string[] = [];
				lines.push(`📊 **Session Info**`);
				if (name) lines.push(`Name: ${name}`);
				lines.push(`File: ${stats.sessionFile ?? "In-memory"}`);
				lines.push(`ID: ${stats.sessionId}`);
				lines.push("");
				lines.push(`**Messages:** User ${stats.userMessages} · Asst ${stats.assistantMessages} · Tools ${stats.toolCalls}/${stats.toolResults} · Total ${stats.totalMessages}`);
				lines.push(`**Tokens:** In ${stats.tokens.input.toLocaleString()} · Out ${stats.tokens.output.toLocaleString()} · Total ${stats.tokens.total.toLocaleString()}`);
				if (stats.tokens.cacheRead > 0)
					lines.push(`Cache: Read ${stats.tokens.cacheRead.toLocaleString()} · Write ${stats.tokens.cacheWrite.toLocaleString()}`);
				if (stats.cost > 0)
					lines.push(`**Cost:** $${stats.cost.toFixed(4)}`);
				ctx.notifyWebview({
					type: "system-message",
					data: { message: lines.join("\n") },
				});
			} catch (error) {
				ctx.notifyWebview({
					type: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
			}
			return true;
		}

		case "export": {
			if (!ctx.session) return true;
			try {
				let filePath: string;

				// When only a format extension is given (e.g. ".html", ".md", ".jsonl"),
				// generate a proper timestamped filename in the workspace / cwd.
				const resolvedArgs = args && args.startsWith(".")
					? `session-${new Date().toISOString().replace(/[:.]/g, "-")}${args}`
					: (args || undefined);

				if (resolvedArgs?.endsWith(".jsonl")) {
					filePath = ctx.session.exportToJsonl(resolvedArgs);
				} else if (resolvedArgs?.endsWith(".md")) {
					filePath = exportSessionToMarkdown(ctx.session, resolvedArgs);
				} else {
					filePath = await ctx.session.exportToHtml(resolvedArgs);
				}
				const uri = vscode.Uri.file(filePath);
				await vscode.commands.executeCommand("vscode.open", uri);
				vscode.window.showInformationMessage(
					`Session exported to: ${filePath}`,
				);
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
			return true;
		}

		case "copy": {
			if (!ctx.session) return true;
			const text = ctx.session.getLastAssistantText();
			if (!text) {
				vscode.window.showWarningMessage(
					"No agent messages to copy yet.",
				);
			} else {
				await vscode.env.clipboard.writeText(text);
				vscode.window.showInformationMessage(
					"Copied last agent message to clipboard",
				);
			}
			return true;
		}

		case "fork": {
			if (!ctx.session) return true;
			ctx.notifyWebview({
				type: "system-message",
				data: {
					message:
						"Use the Session Tree to select a message to fork from, or type /tree to navigate branches.",
				},
			});
			return true;
		}

		case "clone": {
			if (!ctx.session) return true;
			try {
				await ctx.forkSession();
				vscode.window.showInformationMessage("Session cloned at current position");
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to clone: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return true;
		}

		case "tree": {
			ctx.notifyWebview({ type: "switchTab", data: { tab: "sessions" } });
			return true;
		}

		case "reload": {
			if (!ctx.session) return true;
			try {
				await (ctx.session as any).reload?.();
				await ctx.sendSessionResources();
				vscode.window.showInformationMessage(
					"Reloaded keybindings, extensions, skills, prompts",
				);
			} catch (error) {
				vscode.window.showErrorMessage(
					`Reload failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return true;
		}

		case "import": {
			if (!args) {
				vscode.window.showErrorMessage("Usage: /import <path.jsonl>");
				return true;
			}
			vscode.window.showInformationMessage(
				"Import from JSONL is not yet supported in the extension. Open the JSONL in the PI terminal to import.",
			);
			return true;
		}

		case "share": {
			if (!ctx.session) return true;
			try {
				const os = await import("node:os");
				const tmpFile = path.join(os.tmpdir(), `pi-session-${ctx.session.sessionId}.html`);
				await ctx.session.exportToHtml(tmpFile);

				vscode.window.showInformationMessage(
					"Session exported. Opening in VS Code — you can copy the content to a gist at https://gist.github.com",
					"Open File",
					"Copy Path",
				).then((selection) => {
					if (selection === "Open File") {
						vscode.commands.executeCommand("vscode.open", vscode.Uri.file(tmpFile));
					} else if (selection === "Copy Path") {
						vscode.env.clipboard.writeText(tmpFile);
						vscode.window.showInformationMessage("Path copied: " + tmpFile);
					}
				});
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to share: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return true;
		}

		case "changelog": {
			try {
				const changelogPath = path.join(
					path.dirname(require.resolve("@earendil-works/pi-coding-agent/package.json")),
					"CHANGELOG.md",
				);
				if (fs.existsSync(changelogPath)) {
					const content = fs.readFileSync(changelogPath, "utf-8");
					const entries = content
						.split(/^## /m)
						.slice(1, 4)
						.map((e) => {
							const lines = e.split("\n");
							const version = lines[0]?.trim() || "";
							const body = lines.slice(1).join("\n").trim();
							const summary = body.length > 300
								? body.slice(0, 300).replace(/\n$/, "") + "..."
								: body;
							return `**${version}**\n${summary}`;
						});
					if (entries.length > 0) {
						ctx.notifyWebview({
							type: "system-message",
							data: {
								message:
									`📋 **Recent Changelog**\n\n${entries.join("\n\n---\n\n")}\n\n_See full changelog at: ${changelogPath}_`,
							},
						});
					} else {
						vscode.window.showInformationMessage("No changelog entries found.");
					}
				} else {
					vscode.window.showInformationMessage(
						"Changelog file not found at: " + changelogPath,
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to read changelog: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return true;
		}

		case "hotkeys": {
			ctx.notifyWebview({
				type: "system-message",
				data: {
					message:
						"⌨ **Keyboard Shortcuts**\n" +
						"Ctrl+Shift+Alt+P — Open PiLot Studio\n" +
						"Ctrl+Shift+I — Focus chat input\n" +
						"Ctrl+Shift+Alt+N — New session\n" +
						"Ctrl+Shift+A — Attach file\n" +
						"Ctrl+Shift+; — Toggle dictation\n" +
						"Type / for slash commands",
				},
			});
			return true;
		}

		case "quit":
			return true;

		default:
			return false;
	}
}

// ── Markdown export ────────────────────────────────────────────────────────

/**
 * Export the current session to a Markdown file.
 * Serializes messages into a readable markdown conversation log.
 */
export function exportSessionToMarkdown(
	session: NonNullable<SlashCommandContext["session"]>,
	outputPath?: string,
): string {
	const filePath = outputPath
		? path.resolve(outputPath)
		: path.join(
				process.cwd(),
				`session-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
		  );

	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const serialized = serializeMessages(session.messages);

	const lines: string[] = [];
	lines.push(`# Chat Session`);
	if (session.sessionName) {
		lines.push(`**Session:** ${session.sessionName}`);
	}
	lines.push(`**Date:** ${new Date().toLocaleString()}`);
	lines.push(`**Session ID:** ${session.sessionId}`);
	const stats = session.getSessionStats();
	if (stats) {
		lines.push(`**Messages:** ${stats.totalMessages ?? "N/A"}`);
		if (stats.tokens) {
			lines.push(
				`**Tokens:** ${(stats.tokens.total ?? 0).toLocaleString()}`,
			);
		}
	}
	lines.push("");
	lines.push("---");
	lines.push("");

	for (const msg of serialized) {
		const timestamp = msg.timestamp
			? new Date(msg.timestamp).toLocaleTimeString()
			: "";

		if (msg.role === "user") {
			lines.push(`## 👤 User ${timestamp ? `(${timestamp})` : ""}`);
			lines.push("");
			if (msg.content) {
				lines.push(msg.content);
				lines.push("");
			}
			if (msg.images && msg.images.length > 0) {
				lines.push(`> _[${msg.images.length} image(s) attached]_`);
				lines.push("");
			}
		} else if (msg.role === "assistant") {
			lines.push(`## 🤖 Assistant ${timestamp ? `(${timestamp})` : ""}`);
			lines.push("");
			if (msg.thinking) {
				lines.push("> 💭 _Thinking_");
				lines.push(">");
				lines.push(
					"> " + msg.thinking.replace(/\n/g, "\n> "),
				);
				lines.push("");
			}
			if (msg.content) {
				lines.push(msg.content);
				lines.push("");
			}
		} else if (msg.role === "system") {
			lines.push(`## ⚙️ System ${timestamp ? `(${timestamp})` : ""}`);
			lines.push("");
			if (msg.content) {
				lines.push("```");
				lines.push(msg.content);
				lines.push("```");
				lines.push("");
			}
		}
	}

	lines.push("---");
	lines.push("");
	lines.push(
		`_Exported from PiLot Studio on ${new Date().toLocaleString()}_`,
	);
	lines.push("");

	fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
	return filePath;
}
