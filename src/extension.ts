import * as vscode from "vscode";
import { PiAgentProvider, validateThinkingLevel } from "./pi-agent-provider.js";
import { registerCommands } from "./commands/index.js";
import { startUpdateChecker } from "./update-checker.js";
import { execFileAsync } from "./utils/shell.js";
import { findPiBinary } from "./pi-binary.js";

/**
 * Try to register a view container options provider for the pi-agent activity bar icon.
 * This uses an unstable/proposed API that may not exist in all VS Code versions.
 * Falls back silently if the API is unavailable.
 */
function tryRegisterViewContainerOptionsProvider(
	context: vscode.ExtensionContext,
): {
	setTitle: (title: string, description?: string) => void;
} {
	const state: { title: string; description?: string } = {
		title: "PiLot Studio",
	};

	// Try to register the options provider (available in VS Code 1.78+ as proposed API,
	// may be present in newer versions)
	const win = vscode.window as any;
	if (typeof win.registerViewContainerOptionsProvider === "function") {
		try {
			const disposable = win.registerViewContainerOptionsProvider("pi-agent", {
				getOptions: () => ({
					title: state.title,
					badge: undefined,
				}),
			});
			context.subscriptions.push(disposable);
		} catch {
			// API exists but registration failed
		}
	}

	return {
		setTitle: (title: string, description?: string) => {
			state.title = title;
			state.description = description;
		},
	};
}

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

	// Register the webview view provider for the Agent Chat (secondary sidebar)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("piAgentChat", provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	registerCommands(context, provider);

	// Try to register a dynamic view container title provider for the activity bar tooltip
	const viewContainerTitle = tryRegisterViewContainerOptionsProvider(context);

	// Resolve PI CLI version and update the view container title
	(async () => {
		const extVersion = context.extension.packageJSON.version || "0.0.0";
		let piVersion: string | null = null;
		try {
			const binaryPath = findPiBinary();
			const result = await execFileAsync(binaryPath, ["--version"]);
			if (result.code === 0) {
				piVersion = result.stdout.trim();
			}
		} catch {
			// PI not available
		}

		const title = piVersion
			? `PiLot Studio v${extVersion} \u2014 Connected to PI v${piVersion}`
			: `PiLot Studio v${extVersion}`;
		viewContainerTitle.setTitle(title);
	})();

	// Start the update checker (periodically checks for pi CLI and package updates)
	context.subscriptions.push(startUpdateChecker(context, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.openPanel",
			async (sessionId?: string) => {
				// Reveal the sidebar webview view
				await vscode.commands.executeCommand("piAgentChat.focus");
				// If a session ID was passed, switch to that session
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

				// Reload session resources when discovery or resource settings change
				if (
					e.affectsConfiguration("pi-agent.disableExtensionDiscovery") ||
					e.affectsConfiguration("pi-agent.disableSkillDiscovery") ||
					e.affectsConfiguration("pi-agent.disablePromptTemplateDiscovery") ||
					e.affectsConfiguration("pi-agent.disableContextFiles") ||
					e.affectsConfiguration("pi-agent.extraExtensions") ||
					e.affectsConfiguration("pi-agent.extraSkills") ||
					e.affectsConfiguration("pi-agent.extraPromptTemplates") ||
					e.affectsConfiguration("pi-agent.systemPrompt") ||
					e.affectsConfiguration("pi-agent.appendSystemPrompts")
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
