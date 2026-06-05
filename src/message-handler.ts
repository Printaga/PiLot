import * as vscode from "vscode";
import { PiAgentProvider } from "./pi-agent-provider.js";

export class MessageHandler {
	constructor(private provider: PiAgentProvider) {}

	async handle(message: {
		type: string;
		id?: string;
		data?: any;
	}): Promise<any> {
		try {
			let result: any;

			switch (message.type) {
				case "ready":
					result = await this.handleReady();
					// Send ready response back to webview so it knows initialization is complete
					this.sendReadyResponse(result);
					break;

				case "prompt":
					try {
						await this.provider.prompt(
							message.data.text,
							message.data.images
						);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "newSession":
					try {
						await this.provider.newSession();
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "switchSession":
					try {
						await this.provider.switchSession(message.data.sessionId);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "forkSession":
					await this.provider.forkSession(message.data?.fromNode);
					result = { success: true };
					break;

				case "navigateTree":
					await this.provider.navigateTree(message.data.nodeId);
					result = { success: true };
					break;

				case "setSessionName":
					try {
						await this.provider.setSessionName(message.data.name);
						result = { success: true };
					} catch (error) {
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error;
					}
					break;

				case "switchModel":
					try {
						await this.provider.setModel(message.data.modelId);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "setThinkingLevel":
					try {
						await this.provider.setThinkingLevel(message.data.level);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "steer":
					try {
						await this.provider.steer(message.data.text);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "followUp":
					try {
						await this.provider.followUp(message.data.text);
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "abort":
					try {
						await this.provider.abort();
						result = { success: true };
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "getModels":
					result = await this.provider.getAvailableModels();
					this.provider.webview?.postMessage({
						type: "models-updated",
						data: { models: result },
					});
					break;

				case "getProviderAuth":
					result = await this.provider.getProviderAuthData();
					// Send directly even without message id so webview gets the data
					this.sendProviderAuth(result);
					break;

				case "setApiKey":
					await this.provider.setApiKey(
						message.data.provider,
						message.data.apiKey,
					);
					result = { success: true };
					break;

				case "removeAuth":
					await this.provider.removeAuth(message.data.provider);
					result = { success: true };
					break;

				case "getCurrentModel":
					result = this.provider.getCurrentModelId();
					break;

				case "getFavorites":
					result = this.provider.getFavorites();
					break;

				case "toggleFavorite":
					result = await this.provider.toggleFavorite(
						message.data.modelId,
						message.data.isFavorite,
					);
					break;

				case "listSessions":
					result = await this.provider.listSessions();
					this.sendSessionsList(result);
					break;

				case "getSessions":
					result = [];
					break;

				case "compact":
					try {
						result = await this.provider.compact();
					} catch (error) {
						// Send error as system message to webview
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error; // Re-throw for the caller's error handling
					}
					break;

				case "getContextUsage":
					result = this.provider.getContextUsage();
					// Push to webview so it updates immediately even without message id
					this.sendContextUsage(result);
					break;

				case "getSessionStats":
					result = this.provider.getSessionStats();
					if (result) {
						this.sendSessionStats(result);
					}
					break;

				case "getAutoCompactionStatus":
					result = this.provider.getAutoCompactionEnabled();
					break;

				case "setAutoCompaction":
					this.provider.setAutoCompactionEnabled(message.data.enabled);
					result = { success: true };
					break;

				case "getSessionInfo":
					result = await this.getSessionInfo();
					break;

				case "getContext":
					result = await this.getProjectContext();
					break;

				case "get-workspace-files":
					{
						const workspaceFiles = await this.getWorkspaceFiles();
						this.provider.webview?.postMessage({
							type: "workspace-files",
							data: { files: workspaceFiles },
						});
					}
					break;

				case "listPackages":
					this.provider.logDebug("[MessageHandler] listPackages case called");
					result = await this.provider.listPackages();
					this.provider.logDebug("[MessageHandler] listPackages result:", JSON.stringify(result));
					this.sendPackagesList(result);
					break;

				case "installPackage":
					try {
						await this.provider.installPackage(message.data.source);
						result = { success: true };
						// Refresh packages list after install
						const packages = await this.provider.listPackages();
						this.sendPackagesList(packages);
					} catch (error) {
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error;
					}
					break;

				case "uninstallPackage":
					try {
						await this.provider.uninstallPackage(message.data.source);
						result = { success: true };
						// Refresh packages list after uninstall
						const packages = await this.provider.listPackages();
						this.sendPackagesList(packages);
					} catch (error) {
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error;
					}
					break;

				case "updateResources":
					try {
						await this.provider.updatePackages();
						result = { success: true };
						// Refresh packages list after update
						const packages = await this.provider.listPackages();
						this.sendPackagesList(packages);
					} catch (error) {
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error;
					}
					break;

				case "openFileAttachmentDialog":
					{
						const paths = await this.openFileAttachmentDialog();
						console.log("[PiLot] openFileAttachmentDialog: selected paths =", JSON.stringify(paths));
						this.provider.webview?.postMessage({
							type: "files-attached",
							data: { paths },
						});
						console.log("[PiLot] openFileAttachmentDialog: response sent, webview exists =", !!this.provider.webview);
					}
					break;

				case "toggle-voice-capture":
					try {
						await this.provider.toggleVoiceCapture();
						result = { success: true };
					} catch (error) {
						this.provider.webview?.postMessage({
							type: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
								timestamp: Date.now(),
							},
						});
						throw error;
					}
					break;

				case "showRenameSessionDialog":
					{
						const newName = await vscode.window.showInputBox({
							prompt: "Enter a new name for this session",
							placeHolder: "My session name",
						});
						if (newName) {
							await this.provider.setSessionName(newName);
							result = { success: true };
						} else {
							result = { cancelled: true };
						}
					}
					break;

				default:
					this.provider.logDebug("Unknown message type:", message.type);
					result = { error: `Unknown message type: ${message.type}` };
			}

			if (message.id) {
				this.sendResponse(message.id, result);
			}

			return result;
		} catch (error) {
			this.provider.logError("Message handler error:", error);
			const errorResult = {
				error: error instanceof Error ? error.message : String(error),
			};

			if (message.id) {
				this.sendResponse(message.id, errorResult, true);
			}

			return errorResult;
		}
	}

	private async handleReady(): Promise<any> {
		const models = await this.provider.getAvailableModels();
		const sessions = await this.provider.listSessions();
		const currentModel = this.provider.getCurrentModelId();
		const favoriteModels = this.provider.getFavorites();
		const thinkingLevel = this.provider.getThinkingLevel();

		// Re-send session resources now that webview is ready to receive
		this.provider.sendSessionResources();

		return {
			models,
			sessions,
			currentModel,
			favoriteModels,
			thinkingLevel,
			sessionId: undefined,
		};
	}

	private async getSessionInfo(): Promise<any> {
		const session = (this.provider as any).session;
		if (!session) return null;

		try {
			let contextFiles: any[] = [];
			let skills: any[] = [];
			let extensions: any[] = [];
			let prompts: any[] = [];
			try {
				const rl = session.resourceLoader;
				if (rl) {
					contextFiles = rl.getAgentsFiles?.().agentsFiles || [];
					skills = rl.getSkills().skills || [];
					extensions = rl.getExtensions().extensions || [];
					prompts = rl.getPrompts().prompts || [];
				}
			} catch {
				contextFiles = [];
				skills = [];
				extensions = [];
				prompts = [];
			}

			// Collect VS Code active extensions
			const vscodeExtensions = vscode.extensions.all
				.filter((ext) => ext.isActive)
				.map((ext) => ({
					id: ext.id,
					name: ext.packageJSON?.displayName || ext.packageJSON?.name || ext.id,
					version: ext.packageJSON?.version || "",
				}));

			return {
				skills: skills.map((s: any) => ({
					name: s.name,
					description: s.description,
				})),
				skillCount: skills.length,
				extensions: extensions.map((e: any) => ({
					path: e.path,
					sourceInfo: e.sourceInfo
						? { name: e.sourceInfo.name, label: e.sourceInfo.label }
						: null,
				})),
				extensionCount: extensions.length,
				vscodeExtensions,
				vscodeExtensionCount: vscodeExtensions.length,
				contextFiles: contextFiles.map((f: any) => ({ path: f.path })),
				contextFileCount: contextFiles.length,
				prompts: prompts.map((p: any) => ({
					name: p.name,
					description: p.description,
				})),
				promptCount: prompts.length,
			};
		} catch (e) {
			this.provider.logError("getSessionInfo failed:", e);
			return null;
		}
	}

	private async getProjectContext(): Promise<any> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return null;
		}

		const root = workspaceFolders[0].uri.fsPath;

		try {
			const packageJsonPath = vscode.Uri.joinPath(
				workspaceFolders[0].uri,
				"package.json",
			);
			const packageJsonContent =
				await vscode.workspace.fs.readFile(packageJsonPath);
			const pkg = JSON.parse(packageJsonContent.toString());

			return {
				root,
				name: pkg.name || "Unknown",
				version: pkg.version || "Unknown",
				description: pkg.description || "",
			};
		} catch {
			return { root, name: "Unknown", version: "Unknown" };
		}
	}

	private sendReadyResponse(data: any) {
		this.provider.webview?.postMessage({
			type: "ready",
			data,
		});
	}

	private sendSessionsList(data: any) {
		this.provider.webview?.postMessage({
			type: "sessions-list",
			data,
		});
	}

	private sendProviderAuth(data: any) {
		this.provider.webview?.postMessage({
			type: "provider-auth",
			data,
		});
	}

	private sendContextUsage(data: any) {
		this.provider.webview?.postMessage({
			type: "context-usage",
			data,
		});
	}

	private sendSessionStats(data: any) {
		this.provider.webview?.postMessage({
			type: "session-stats",
			data: { tokens: data?.tokens },
		});
	}

	private sendPackagesList(data: any) {
		this.provider.logDebug("[MessageHandler] sendPackagesList called with:", JSON.stringify(data));
		this.provider.webview?.postMessage({
			type: "installed",
			data: data,
		});
	}

	private async getWorkspaceFiles(): Promise<string[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return [];
		}

		const files: string[] = [];
		const rootUri = workspaceFolders[0].uri;

		try {
			// Explicit exclude pattern: only skip node_modules, .git, and typical build
			// artifacts. The VS Code default exclusion set (null) can be unexpectedly
			// restrictive (e.g. hiding src/ or dist/ depending on user settings).
			const excludePattern = '{**/node_modules/**,**/.git/**,**/dist-tsc/**}';
			const pattern = new vscode.RelativePattern(rootUri, '**/*');
			const fileUris = await vscode.workspace.findFiles(
				pattern,
				excludePattern,
				2000,
			);

			const seen = new Set<string>();
			for (const uri of fileUris) {
				const relativePath = vscode.workspace.asRelativePath(uri, false);
				// Filter out node_modules and hidden files (belt and suspenders)
				if (
					!relativePath ||
					relativePath.includes('node_modules') ||
					relativePath.startsWith('.')
				) {
					continue;
				}
				// Deduplicate (findFiles can return the same file via different paths)
				if (seen.has(relativePath)) continue;
				seen.add(relativePath);
				files.push(relativePath);
			}
		} catch (e) {
			this.provider.logError('Failed to get workspace files:', e);
		}

		return files.sort();
	}

	private sendResponse(id: string, data: any, isError = false) {
		this.provider.webview?.postMessage({
			id,
			data,
			isError,
		});
	}

	private async openFileAttachmentDialog(): Promise<string[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return [];
		}

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
			return paths;
		}

		return [];
	}
}
