import * as vscode from "vscode";

import { PiAgentProvider } from "../pi-agent-provider.js";
import { runUpdateCheck } from "../update-checker.js";
import { draftCommitMessage, findRepositoryRoot } from "../git-commit-message.js";
import { findGitRepository, writeCommitMessage } from "../git-extension.js";
import {
	diagnosticsChannel,
	getDiagnosticsLogContent,
	logDiagnostics,
	setDiagnosticsEnabled,
} from "./diagnostics.js";

async function focusSidebar() {
	await vscode.commands.executeCommand("piAgentChat.focus");
}

export function registerCommands(context: vscode.ExtensionContext, provider: PiAgentProvider) {
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
		vscode.commands.registerCommand("pi-agent.analyzeProject", async (uri: vscode.Uri) => {
			await focusSidebar();
			await new Promise((resolve) => setTimeout(resolve, 500));

			const folderPath =
				uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
			const prompt = `Analyze the project at \`${folderPath}\`. Provide an overview of:\n1. Project structure\n2. Key files and their purposes\n3. Technologies and frameworks used\n4. Potential improvements`;

			await provider.prompt(prompt);
		}),
	);

	// Navigate To Session command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.navigateToSession", async (nodeId: string) => {
			await provider.navigateTree(nodeId);
		}),
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
			if (provider.postToActiveEditorChatPanel("focus-input", {})) return;
			await focusSidebar();
			// Send message to webview to focus input
			provider.notifyWebviewFromCommand("focus-input", {});
		}),
	);

	// Search Chat History command — Ctrl+F is intercepted by VS Code before it
	// reaches the webview, so this scoped keybinding (sidebar chat view or
	// editor chat panel) bridges it into the webview's in-chat search bar.
	// When an editor chat panel is focused the message goes there directly;
	// falling back to the sidebar would yank focus out of the editor.
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.searchChat", async () => {
			if (provider.postToActiveEditorChatPanel("focus-search", {})) return;
			await focusSidebar();
			provider.notifyWebviewFromCommand("focus-search", {});
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
			await vscode.commands.executeCommand("workbench.action.openSettings", "pi-agent");
		}),
	);

	// Open Current Session in Editor command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.openCurrentSessionInEditor", async () => {
			await provider.openCurrentSessionInEditor();
		}),
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
		vscode.commands.registerCommand("pi-agent.addFileToChat", async (uri: vscode.Uri) => {
			if (uri && uri.scheme === "file") {
				await focusSidebar();
				const relativePath = vscode.workspace.asRelativePath(uri);
				provider.notifyWebviewFromCommand("add-file-to-chat", {
					path: relativePath,
				});
			}
		}),
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
				prompt: "Enter resource source to install (e.g., npm package, git URL, or local path)",
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

	// Light Mode: palette toggle + status-bar indicator. Both drive the same
	// config-update path as the webview toggle, so the extension.ts config
	// listener performs the history-preserving session rebuild.
	const lightModeStatusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		50,
	);
	lightModeStatusBar.command = "pi-agent.toggleLightMode";
	const syncLightModeStatusBar = () => {
		if (provider.getLightMode()) {
			lightModeStatusBar.text = "$(zap) PI Light";
			lightModeStatusBar.tooltip =
				"Light Mode active: skills, extensions, packages, themes and auto context are disabled. Click to turn off.";
			lightModeStatusBar.show();
		} else {
			lightModeStatusBar.text = "";
			lightModeStatusBar.hide();
		}
	};
	syncLightModeStatusBar();
	context.subscriptions.push(lightModeStatusBar);

	// The config is the single source of truth: re-sync on ANY light-mode
	// change (palette, webview toggle, or the VS Code settings UI).
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("pi-agent.lightMode")) {
				syncLightModeStatusBar();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.toggleLightMode", async () => {
			await provider.setLightMode(!provider.getLightMode());
		}),
	);

	// Generate Commit Message: drafts a message with the PI CLI in print mode and
	// places it in the SCM commit-message box. Read-only with respect to git -
	// nothing is staged, committed, amended, or pushed, and no session record is
	// created (`--no-session`).
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.generateCommitMessage", async () => {
			const cwd =
				provider.getSessionCwd() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!cwd) {
				vscode.window.showWarningMessage(
					"PiLot Studio: open a folder or start a session to draft a commit message.",
				);
				return;
			}

			const repoRoot = findRepositoryRoot(cwd);
			if (!repoRoot) {
				vscode.window.showWarningMessage(
					"PiLot Studio: the current workspace is not inside a git repository.",
				);
				return;
			}

			// Resolve the SCM target before spending a model request, so a disabled
			// or missing git extension is reported instead of failing mid-flight.
			const lookup = await findGitRepository(repoRoot);
			if (lookup.status === "unavailable") {
				vscode.window.showWarningMessage(`PiLot Studio: ${lookup.message}`);
				return;
			}

			if (!provider.isBinaryAvailable()) {
				vscode.window.showErrorMessage(
					"PiLot Studio: the pi binary could not be found. Set pi-agent.binaryPath or add pi to your PATH.",
				);
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.SourceControl,
					title: "Drafting commit message...",
				},
				async () => {
					const outcome = await draftCommitMessage({
						cwd,
						binaryPath: provider.getPiBinaryPath(),
						model: provider.getCommitMessageModel(),
					});

					switch (outcome.status) {
						case "message": {
							writeCommitMessage(lookup.repository, outcome.message);
							const notes: string[] = [];
							if (outcome.truncated) notes.push("the patch was truncated");
							if (outcome.untrackedCount > 0) {
								notes.push(
									`${outcome.untrackedCount} untracked file(s) were not included`,
								);
							}
							vscode.window.showInformationMessage(
								notes.length > 0
									? `Commit message drafted (${notes.join("; ")}).`
									: "Commit message drafted.",
							);
							break;
						}
						case "nothing-to-commit":
							vscode.window.showInformationMessage(
								outcome.untrackedCount > 0
									? `PiLot Studio: nothing to describe - ${outcome.untrackedCount} untracked file(s) are not part of the diff.`
									: "PiLot Studio: there are no staged or modified changes to describe.",
							);
							break;
						case "timeout":
							vscode.window.showWarningMessage(
								`PiLot Studio: drafting the commit message timed out. ${outcome.message}`,
							);
							break;
						case "error":
							vscode.window.showErrorMessage(
								`PiLot Studio: could not draft a commit message. ${outcome.message}`,
							);
							break;
					}
				},
			);
		}),
	);

	// Diagnostics Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.showDiagnosticsLog", async () => {
			diagnosticsChannel.show(true);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi-agent.exportDiagnosticsLog", async () => {
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
				const content = getDiagnosticsLogContent();
				await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
				vscode.window.showInformationMessage(`Diagnostics log exported to ${uri.fsPath}`);
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to export diagnostics log: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
	);

	// Watch diagnostics.enabled setting to toggle the buffer
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("pi-agent.diagnostics")) {
				const config = vscode.workspace.getConfiguration("pi-agent");
				setDiagnosticsEnabled(config.get<boolean>("diagnostics.enabled", false));
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
		vscode.commands.registerCommand("pi-agent.rebuildNativeAddons", async () => {
			await provider.rebuildNativeAddons();
		}),
	);
}
