import * as vscode from "vscode";
import { PiAgentProvider, validateThinkingLevel } from "./pi-agent-provider.js";
import { registerCommands } from "./commands/index.js";
import { startUpdateChecker } from "./update-checker.js";

export async function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("pi-agent");

	// pi's SDK reads the agent directory only from PI_CODING_AGENT_DIR, so
	// bridge the setting into it (applied at activation; reload to apply).
	const agentDir = config.get<string>("agentDir", "").trim();
	if (agentDir) {
		process.env.PI_CODING_AGENT_DIR = agentDir;
	}

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
		vscode.commands.registerCommand("pi-agent.openPanel", async (sessionId?: string) => {
			await vscode.commands.executeCommand("piAgentChat.focus");
			if (sessionId) {
				await provider.switchSession(sessionId);
			} else if (!provider.hasSession) {
				await provider.newSession();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.newSession", async () => {
			await vscode.commands.executeCommand("piAgentChat.focus");
			await provider.newSession();
		}),
	);

	context.subscriptions.push(installConfigListener(provider));
}

/**
 * Which `pi-agent.*` keys require only a resource-loader `reload()` when they
 * change. Everything that rewrites loader construction-time options — light
 * mode's `no*` flags — needs a full session rebuild instead.
 */
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

/**
 * React to `pi-agent.*` configuration changes: refresh the provider config
 * snapshot, then reload session resources or rebuild the session (history
 * preserved) depending on which keys changed.
 *
 * Exported so tests can drive the real listener without activating the full
 * extension.
 */
export function installConfigListener(
	provider: Pick<
		PiAgentProvider,
		"updateConfig" | "reloadSessionResources" | "restartSessionPreservingHistory" | "logDebug"
	>,
): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration("pi-agent")) {
			const newConfig = vscode.workspace.getConfiguration("pi-agent");
			provider.updateConfig({
				defaultModel: newConfig.get("defaultModel", "anthropic/claude-sonnet-4-5"),
				defaultProvider: newConfig.get("defaultProvider", "anthropic"),
				autoContext: newConfig.get("context.autoAttach", true),
				maxTokens: newConfig.get("maxTokens", 8192),
				thinkingLevel: validateThinkingLevel(newConfig.get("thinkingLevel")),
				sessionDir: newConfig.get("sessionDir", ""),
			});

			if (e.affectsConfiguration("pi-agent.lightMode")) {
				// Light mode's `no*` flags are fixed at resource-loader
				// construction, so the session must be rebuilt (history is
				// preserved) for the change to take effect.
				provider.restartSessionPreservingHistory().catch((err) => {
					provider.logDebug("[PI] Failed to restart session for light mode change:", err);
				});
			} else if (resourceConfigKeys.some((k) => e.affectsConfiguration(`pi-agent.${k}`))) {
				provider.reloadSessionResources().catch((err) => {
					provider.logDebug("[PI] Failed to reload session resources:", err);
				});
			}
		}
	});
}

export function deactivate() {}
