import * as vscode from "vscode";
import { PiAgentProvider, validateThinkingLevel } from "./pi-agent-provider.js";
import { registerCommands } from "./commands/index.js";
import { startUpdateChecker } from "./update-checker.js";

export async function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("pi-agent");

	const provider = new PiAgentProvider(context, {
		defaultModel: config.get("defaultModel", "anthropic/claude-sonnet-4-5"),
		defaultProvider: config.get("defaultProvider", "anthropic"),
		autoContext: config.get("context.autoAttach", true),
		maxTokens: config.get("maxTokens", 8192),
		thinkingLevel: validateThinkingLevel(config.get("thinkingLevel")),
		sessionDir: config.get("sessionDir", ""),
	});

	context.subscriptions.push(provider);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("piAgentChat", provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	registerCommands(context, provider);

	context.subscriptions.push(startUpdateChecker(context, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.openPanel",
			async (sessionId?: string) => {
				await vscode.commands.executeCommand("piAgentChat.focus");
				if (sessionId) {
					await provider.switchSession(sessionId);
				} else if (!provider.hasSession) {
					await provider.newSession();
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.newSession", async () => {
			await vscode.commands.executeCommand("piAgentChat.focus");
			await provider.newSession();
		}),
	);

	const resourceConfigKeys = [
		"disableExtensionDiscovery",
		"disableSkillDiscovery",
		"disablePromptTemplateDiscovery",
		"disableContextFiles",
		"extraExtensions",
		"extraSkills",
		"extraPromptTemplates",
		"systemPrompt",
		"appendSystemPrompts",
	];

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("pi-agent")) {
				const newConfig = vscode.workspace.getConfiguration("pi-agent");
				provider.updateConfig({
					defaultModel: newConfig.get(
						"defaultModel",
						"anthropic/claude-sonnet-4-5",
					),
					defaultProvider: newConfig.get("defaultProvider", "anthropic"),
					autoContext: newConfig.get("context.autoAttach", true),
					maxTokens: newConfig.get("maxTokens", 8192),
					thinkingLevel: validateThinkingLevel(newConfig.get("thinkingLevel")),
					sessionDir: newConfig.get("sessionDir", ""),
				});

				if (
					resourceConfigKeys.some((k) =>
						e.affectsConfiguration(`pi-agent.${k}`),
					)
				) {
					provider.reloadSessionResources().catch((err) => {
						provider.logDebug("[PI] Failed to reload session resources:", err);
					});
				}
			}
		}),
	);
}

export function deactivate() {}
