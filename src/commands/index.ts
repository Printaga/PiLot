import * as vscode from "vscode";

import { PiAgentProvider } from "../pi-agent-provider.js";
import { runUpdateCheck } from "../update-checker.js";

// ── Diagnostics output channel and log buffer ──────────────────────────────

export const diagnosticsChannel = vscode.window.createOutputChannel(
	"PiLot Studio Diagnostics",
	{ log: true },
);

const diagnosticsBuffer: string[] = [];
let isDiagnosticsEnabled = false;

/** @internal Reset diagnostics state for tests. guarded by PI_TEST env. */
export function resetDiagnosticsStateForTests(): void {
	if (process.env.PI_TEST !== "1") {
		throw new Error("resetDiagnosticsStateForTests is only available under PI_TEST=1");
	}
	diagnosticsBuffer.length = 0;
	isDiagnosticsEnabled = false;
}

/** @internal Read diagnostics buffer for tests. guarded by PI_TEST env. */
export function getDiagnosticsBuffer(): readonly string[] {
	if (process.env.PI_TEST !== "1") {
		throw new Error("getDiagnosticsBuffer is only available under PI_TEST=1");
	}
	return diagnosticsBuffer;
}

/** Append a message to the diagnostics log if diagnostics are enabled. */
export function logDiagnostics(message: string, ...args: unknown[]) {
	if (!isDiagnosticsEnabled) return;
	const line = `[${new Date().toISOString()}] ${message}`;
	diagnosticsChannel.appendLine(line);
	diagnosticsBuffer.push(line);
	if (args.length > 0) {
		for (const arg of args) {
			const argLine =
				typeof arg === "string" ? arg : JSON.stringify(arg, null, 2);
			diagnosticsChannel.appendLine(argLine);
			diagnosticsBuffer.push(argLine);
		}
	}
}

/** Enable or disable diagnostics logging. */
export function setDiagnosticsEnabled(enabled: boolean) {
	isDiagnosticsEnabled = enabled;
	if (enabled) {
		logDiagnostics("Diagnostics logging enabled");
	}
}

async function focusSidebar() {
	await vscode.commands.executeCommand("piAgentChat.focus");
}

export function registerCommands(
	context: vscode.ExtensionContext,
	provider: PiAgentProvider,
) {
	// Explain Code command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.explainCode", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showInformationMessage("No active editor");
				return;
			}

			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);

			if (!selectedText.trim()) {
				vscode.window.showInformationMessage("No code selected");
				return;
			}

			await focusSidebar();
			await new Promise((resolve) => setTimeout(resolve, 500));

			const prompt = `Explain this code in detail:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
			await provider.prompt(prompt);
		}),
	);

	// Refactor Code command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.refactorCode", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showInformationMessage("No active editor");
				return;
			}

			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);

			if (!selectedText.trim()) {
				vscode.window.showInformationMessage("No code selected");
				return;
			}

			await focusSidebar();
			await new Promise((resolve) => setTimeout(resolve, 500));

			const prompt = `Refactor this code for better readability, performance, and maintainability:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
			await provider.prompt(prompt);
		}),
	);

	// Analyze Project command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.analyzeProject",
			async (uri: vscode.Uri) => {
				await focusSidebar();
				await new Promise((resolve) => setTimeout(resolve, 500));

				const folderPath =
					uri?.fsPath ||
					vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
					"";
				const prompt = `Analyze the project at \`${folderPath}\`. Provide an overview of:\n1. Project structure\n2. Key files and their purposes\n3. Technologies and frameworks used\n4. Potential improvements`;

				await provider.prompt(prompt);
			},
		),
	);

	// Navigate To Session command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.navigateToSession",
			async (nodeId: string) => {
				await provider.navigateTree(nodeId);
			},
		),
	);

	// Cycle Model command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.cycleModel", async () => {
			await provider.cycleModel();
		}),
	);

	// Cycle Thinking Level command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.cycleThinkingLevel", async () => {
			await provider.cycleThinkingLevel();
		}),
	);

	// Focus Input command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.focusInput", async () => {
			await focusSidebar();
			// Send message to webview to focus input
			provider.notifyWebviewFromCommand("focus-input", {});
		}),
	);

	// Edit Last Message command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.editLastMessage", async () => {
			provider.notifyWebviewFromCommand("edit-last-message", {});
		}),
	);

	// Open Settings command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.openSettings", async () => {
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"pi-agent",
			);
		}),
	);

	// Open Current Session in Editor command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.openCurrentSessionInEditor",
			async () => {
				await provider.openCurrentSessionInEditor();
			},
		),
	);

	// New Chat in Editor command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.newChatInEditor", async () => {
			await provider.newChatInEditor();
		}),
	);

	// Toggle Voice Capture command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.toggleVoiceCapture", async () => {
			provider.notifyWebviewFromCommand("toggle-voice-capture", {});
		}),
	);

	// Add File to Chat command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.addFileToChat",
			async (uri: vscode.Uri) => {
				if (uri && uri.scheme === "file") {
					await focusSidebar();
					const relativePath = vscode.workspace.asRelativePath(uri);
					provider.notifyWebviewFromCommand("add-file-to-chat", {
						path: relativePath,
					});
				}
			},
		),
	);

	// Resource Management Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.listResources", async () => {
			// Focus sidebar and trigger resource list view
			await focusSidebar();
			provider.notifyWebviewFromCommand("list-resources", {});
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.installResource", async () => {
			const input = await vscode.window.showInputBox({
				prompt:
					"Enter resource source to install (e.g., npm package, git URL, or local path)",
				placeHolder: "npm:@pi-agent/skill-analyze",
			});
			if (input) {
				await provider.installPackage(input);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.removeResource", async () => {
			const input = await vscode.window.showInputBox({
				prompt: "Enter resource source to remove",
				placeHolder: "npm:@pi-agent/skill-analyze",
			});
			if (input) {
				await provider.uninstallPackage(input);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.updateResources", async () => {
			await provider.updatePackages();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.manageResources", async () => {
			await focusSidebar();
			provider.notifyWebviewFromCommand("manage-resources", {});
		}),
	);

	// Delete Sessions command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.deleteSessions",
			async (sessionIds?: string[]) => {
				if (!sessionIds || sessionIds.length === 0) {
					vscode.window.showInformationMessage(
						"Select sessions to delete from the history panel.",
					);
					return;
				}
				const selection = await vscode.window.showInformationMessage(
					`Delete ${sessionIds.length} session${sessionIds.length === 1 ? "" : "s"}? This cannot be undone.`,
					{ modal: true },
					"Cancel",
					"Delete",
				);
				const confirmed = selection === "Delete";
				if (!confirmed) return;
				await provider.deleteSessions(sessionIds);
				vscode.window.showInformationMessage(
					`Deleted ${sessionIds.length} session${sessionIds.length === 1 ? "" : "s"}.`,
				);
			},
		),
	);

	// Check for Updates command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.checkForUpdates", async () => {
			try {
				await runUpdateCheck(provider);
			} catch (err) {
				logDiagnostics(`[Update Checker] Manual update check failed: ${err}`);
				vscode.window.showErrorMessage("Failed to check for updates.");
			}
		}),
	);

	// Diagnostics Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.showDiagnosticsLog", async () => {
			diagnosticsChannel.show(true);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.exportDiagnosticsLog",
			async () => {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				const defaultUri = workspaceFolders?.[0]?.uri;

				const uri = await vscode.window.showSaveDialog({
					defaultUri: defaultUri
						? vscode.Uri.joinPath(defaultUri, "pi-diagnostics.log")
						: undefined,
					filters: {
						"Log files": ["log"],
						"Text files": ["txt"],
						"All files": ["*"],
					},
					title: "Export PiLot Studio Diagnostics Log",
				});

				if (!uri) return;

				try {
					const content =
						diagnosticsBuffer.length > 0
							? diagnosticsBuffer.join("\n") + "\n"
							: "[PiLot Studio Diagnostics — no log entries yet]\n";
					await vscode.workspace.fs.writeFile(
						uri,
						Buffer.from(content, "utf-8"),
					);
					vscode.window.showInformationMessage(
						`Diagnostics log exported to ${uri.fsPath}`,
					);
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to export diagnostics log: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
		),
	);

	// Watch diagnostics.enabled setting to toggle the buffer
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("pi-agent.diagnostics")) {
				const config = vscode.workspace.getConfiguration("pi-agent");
				setDiagnosticsEnabled(
					config.get<boolean>("diagnostics.enabled", false),
				);
			}
		}),
	);

	// Initialize diagnostics state from current config
	{
		const config = vscode.workspace.getConfiguration("pi-agent");
		setDiagnosticsEnabled(config.get<boolean>("diagnostics.enabled", false));
	}

	// Attach File command — opens native file picker and sends @path mentions to webview
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.attachFile", async () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) return;

			const uris = await vscode.window.showOpenDialog({
				canSelectMany: true,
				canSelectFolders: false,
				canSelectFiles: true,
				defaultUri: workspaceFolders[0].uri,
				openLabel: "Attach Files",
			});

			if (uris && uris.length > 0) {
				const paths = uris
					.map((uri) => vscode.workspace.asRelativePath(uri))
					.filter(Boolean);
				if (paths.length > 0) {
					provider.notifyWebviewFromCommand("files-attached", { paths });
				}
			}
		}),
	);

	// Rebuild Native Addons command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"pi-agent.rebuildNativeAddons",
			async () => {
				await provider.rebuildNativeAddons();
			},
		),
	);
}
