import * as vscode from "vscode";
import { PiAgentProvider, validateThinkingLevel } from "./pi-agent-provider.js";
import { disposeDiagnosticsChannel } from "./commands/diagnostics.js";
import { registerCommands } from "./commands/index.js";
import { startUpdateChecker } from "./update-checker.js";

/**
 * Read the `pi-agent.*` provider options from a configuration section.
 * Single source for activate() and the config-change listener — the mapping
 * (and its hardcoded defaults) previously lived in both places verbatim.
 */
function readPiAgentConfig(section: ReturnType<typeof vscode.workspace.getConfiguration>) {
	return {
		defaultModel: section.get<string>("defaultModel", "anthropic/claude-sonnet-4-5"),
		defaultProvider: section.get<string>("defaultProvider", "anthropic"),
		autoContext: section.get<boolean>("context.autoAttach", true),
		maxTokens: section.get<number>("maxTokens", 8192),
		thinkingLevel: validateThinkingLevel(section.get("thinkingLevel")),
		sessionDir: section.get<string>("sessionDir", ""),
	};
}

/**
 * pi's SDK reads the agent directory only from PI_CODING_AGENT_DIR, so bridge
 * the setting into the environment. An empty setting must DELETE the variable:
 * a stale value from the parent process would otherwise keep applying.
 */
function applyAgentDirEnv(agentDir: string): void {
	if (agentDir) {
		process.env.PI_CODING_AGENT_DIR = agentDir;
	} else {
		delete process.env.PI_CODING_AGENT_DIR;
	}
}

export async function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("pi-agent");

	applyAgentDirEnv(config.get<string>("agentDir", "").trim());

	const provider = new PiAgentProvider(context, readPiAgentConfig(config));

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
			try {
				if (sessionId) {
					await provider.switchSession(sessionId);
				} else if (!provider.hasSession) {
					await provider.newSession();
				}
			} catch (err) {
				// createSession() can reject (binary/session creation failure):
				// without this the user just clicks and nothing happens.
				provider.logDebug("[PI] Failed to open panel:", err);
				void vscode.window.showErrorMessage(
					`PiLot Studio: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.newSession", async () => {
			await vscode.commands.executeCommand("piAgentChat.focus");
			try {
				await provider.newSession();
			} catch (err) {
				provider.logDebug("[PI] Failed to create session:", err);
				void vscode.window.showErrorMessage(
					`PiLot Studio: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
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
			provider.updateConfig(readPiAgentConfig(newConfig));

			// The SDK reads the agent directory from the environment at session
			// creation, so a changed agentDir must be re-bridged (and requires a
			// rebuild — handled by the lightMode branch below when combined).
			if (e.affectsConfiguration("pi-agent.agentDir")) {
				applyAgentDirEnv(newConfig.get<string>("agentDir", "").trim());
			}

			if (
				e.affectsConfiguration("pi-agent.lightMode") ||
				e.affectsConfiguration("pi-agent.disabledSkills") ||
				e.affectsConfiguration("pi-agent.disabledPackages")
			) {
				// Resource-loader construction and extension startup happen at
				// session creation, so toggle changes rebuild the session while
				// preserving its transcript.
				provider.restartSessionPreservingHistory().catch((err) => {
					provider.logDebug(
						"[PI] Failed to restart session for resource toggle change:",
						err,
					);
				});
			} else if (resourceConfigKeys.some((k) => e.affectsConfiguration(`pi-agent.${k}`))) {
				provider.reloadSessionResources().catch((err) => {
					provider.logDebug("[PI] Failed to reload session resources:", err);
				});
			}
		}
	});
}

export function deactivate() {
	// The diagnostics output channel is created lazily; dispose it so it does
	// not leak across extension-host reloads.
	disposeDiagnosticsChannel();
}
