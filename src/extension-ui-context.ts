import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface ExtensionUIContextDeps {
	getSession: () => AgentSession | undefined;
	extensionStatuses: Map<string, string>;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
}

export class ExtensionUIContext {
	private statusPoller: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly deps: ExtensionUIContextDeps) {}

	/**
	 * Bind a custom ExtensionUIContext to the session's extension runner
	 * so that ctx.ui.setStatus() calls from packages are forwarded to the webview.
	 *
	 * We set the UI context on the extension runner directly (not via bindExtensions)
	 * because createAgentSession already initializes and binds the runner during
	 * construction. Calling bindExtensions again would re-emit session_start and
	 * re-discover resources. Instead, we replace the no-op UI context with our own
	 * and also set it on the session's _extensionUIContext field so that reload()
	 * preserves it.
	 */
	async bindExtensionUI(): Promise<void> {
		const session = this.deps.getSession();
		if (!session) return;

		try {
			const runner = session.extensionRunner;
			if (!runner) {
				this.deps.logDebug(
					"[PI] No extension runner found, skipping UI context binding",
				);
				return;
			}

			// Create a UI context that forwards setStatus calls to the webview
			const uiContext = this.createUIContext();

			// Set the UI context on the runner so extension setStatus calls reach us
			runner.setUIContext(uiContext);

			// Also set the internal _extensionUIContext field so session.reload() preserves it.
			(session as any)._extensionUIContext = uiContext;

			const extensionPaths = runner.getExtensionPaths?.() ?? [];
			const extensionCount = extensionPaths.length;
			this.deps.logDebug(
				`[PiLot DIAGNOSTIC] Extension paths found: ${extensionCount}`,
			);
			if (extensionCount > 0) {
				this.deps.logDebug(
					"[PiLot DIAGNOSTIC] Extension paths:",
					extensionPaths,
				);
			}

			// Check if extensions have session_start handlers
			const extensions = (runner as any).extensions ?? [];
			this.deps.logDebug(
				`[PiLot DIAGNOSTIC] Extensions loaded: ${extensions.length}`,
			);
			if (extensions.length > 0) {
				const handlers = extensions.map((ext: any) => ({
					path: ext.path,
					hasSessionStart: ext.handlers?.has("session_start"),
					handlerCount: ext.handlers?.get("session_start")?.length ?? 0,
				}));
				this.deps.logDebug("[PiLot DIAGNOSTIC] Extension handlers:", handlers);
			}

			this.deps.logDebug(
				`[PI] Bound extension UI context for setStatus forwarding (${extensionCount} extensions loaded)`,
			);

			// Re-apply bindings so the new UI context is used by the runner
			(session as any)._applyExtensionBindings?.(runner);

			// CRITICAL: Emit session_start to initialize extensions
			// Without this, extensions never run their initialization handlers (LSP setup, indexing, etc.)
			// and never call setStatus() to report their activity.
			const sessionStartEvent = (session as any)._sessionStartEvent ?? {
				type: "session_start" as const,
				reason: "startup" as const,
				cwd: session.sessionManager.getCwd(),
				sessionPath: (session as any).sessionFile,
			};

			// Store it for future reload() calls
			(session as any)._sessionStartEvent = sessionStartEvent;

			this.deps.logDebug(
				"[PiLot DIAGNOSTIC] Emitting session_start event:",
				sessionStartEvent,
			);
			this.deps.logDebug("[PI] Emitting session_start to extensions");
			await runner.emit(sessionStartEvent);
			this.deps.logDebug(
				"[PiLot DIAGNOSTIC] session_start emitted successfully",
			);

			// Let extensions discover additional resources (skills, prompts, themes)
			await (session as any).extendResourcesFromExtensions?.("startup");

			this.deps.logDebug(
				`[PiLot DIAGNOSTIC] Extension statuses after session_start: ${this.deps.extensionStatuses.size}`,
			);
			if (this.deps.extensionStatuses.size > 0) {
				this.deps.logDebug(
					"[PiLot DIAGNOSTIC] Statuses:",
					Object.fromEntries(this.deps.extensionStatuses),
				);
			}

			// ── Forward extension loading errors (from createAgentSession) ──────────
			// Extensions that FAILED to load during createAgentSession never got to call
			// setStatus() because the noOpUIContext was active. Their errors are stored in
			// the resource loader's extensionsResult.errors array. Forward them now.
			this.forwardExtensionLoadingErrors();

			this.deps.logDebug("[PI] Extensions initialized");

			// Send any statuses that extensions may have already set during initialization
			if (this.deps.extensionStatuses.size > 0) {
				this.deps.logDebug(
					"[PiLot DIAGNOSTIC] Sending extension-statuses-full to webview",
				);
				this.deps.notifyWebview({
					type: "extension-statuses-full",
					data: Object.fromEntries(this.deps.extensionStatuses),
				});
			}

			// Start polling extension statuses as a sync mechanism
			this.startStatusPoller();
		} catch (err) {
			this.deps.logError("[PI] Failed to bind extension UI context:", err);
		}
	}

	/** Start polling extension statuses from the runner as a fallback/sync mechanism. */
	startStatusPoller(): void {
		this.stopStatusPoller();
		this.statusPoller = setInterval(() => {
			this.pollExtensionStatuses();
		}, 2000);
	}

	/** Stop the status poller. */
	stopStatusPoller(): void {
		if (this.statusPoller !== undefined) {
			clearInterval(this.statusPoller);
			this.statusPoller = undefined;
		}
	}

	/**
	 * Poll the extension runner for all current extension statuses.
	 * This syncs statuses in case setStatus was called before our UI context was attached
	 * or by extensions that bypass the UI context.
	 */
	private pollExtensionStatuses(): void {
		const session = this.deps.getSession();
		if (!session) return;

		try {
			const runner = session.extensionRunner;
			if (!runner || !runner.hasUI()) return;

			// The extension runner stores statuses via the FooterDataProvider.
			// Since we can't access FooterDataProvider directly from the extension host,
			// we rely on the setStatus forwarding from our UI context.
			// This poller is a safety net — send the current full map.
			if (this.deps.extensionStatuses.size > 0) {
				this.deps.notifyWebview({
					type: "extension-statuses-full",
					data: Object.fromEntries(this.deps.extensionStatuses),
				});
			}

			// Also re-check the resource loader for extension loading errors.
			// These are set once during session creation but may change on reload.
			this.forwardExtensionLoadingErrors();
		} catch {
			// Silently ignore — session may be disposed
		}
	}

	/**
	 * Forward extension loading errors from the resource loader as extension statuses.
	 *
	 * During createAgentSession(), extensions that FAIL to load (e.g., native module ABI
	 * mismatch) are caught by loadExtension() and stored in the resource loader's
	 * extensionsResult.errors array. These errors never reach setStatus() because the
	 * no-op UI context is active at that point.
	 *
	 * This method reads those errors and creates status entries so they appear in the
	 * ActivityBar alongside normal extension statuses.
	 */
	forwardExtensionLoadingErrors(): void {
		const session = this.deps.getSession();
		if (!session) return;

		try {
			const rl = session.resourceLoader;
			if (!rl) return;

			const er = rl.getExtensions();
			if (!er.errors || er.errors.length === 0) return;

			for (const err of er.errors) {
				if (!err.path || !err.error) continue;
				const errKey = `ext:error:${err.path}`;
				if (this.deps.extensionStatuses.has(errKey)) continue;

				const rawError = err.error as unknown;
				const errorText =
					typeof rawError === "string"
						? rawError
						: rawError instanceof Error
							? rawError.message
							: String(rawError);
				// Truncate long load errors to first 200 chars
				const displayText =
					errorText.length > 200 ? errorText.slice(0, 200) + "…" : errorText;

				this.deps.extensionStatuses.set(errKey, displayText);
				this.deps.notifyWebview({
					type: "extension-status",
					data: { key: errKey, text: displayText },
				});
			}
		} catch (e) {
			this.deps.logDebug("[PI] Failed to forward extension loading errors:", e);
		}
	}

	/** Dispose resources. */
	dispose(): void {
		this.stopStatusPoller();
	}

	/**
	 * Create the UI context object that forwards extension calls to the webview.
	 */
	private createUIContext() {
		return {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message: string, type?: string) => {
				this.deps.logDebug(
					`[PI] Extension notify: ${type || "info"}: ${message}`,
				);
				this.deps.notifyWebview({
					type: "extension-notify",
					data: { message, type: type || "info" },
				});
			},
			onTerminalInput: () => () => {},
			setStatus: (key: string, text: string | undefined) => {
				this.deps.logDebug(
					`[PiLot DIAGNOSTIC] setStatus called: ${key} = ${text}`,
				);
				if (text === undefined || text === null) {
					this.deps.extensionStatuses.delete(key);
				} else {
					this.deps.extensionStatuses.set(key, text);
				}
				this.deps.logDebug(`[PI] Extension setStatus: ${key} = ${text}`);
				this.deps.notifyWebview({
					type: "extension-status",
					data: { key, text: text ?? undefined },
				});
			},
			setWorkingMessage: (message?: string) => {
				if (message) {
					this.deps.notifyWebview({
						type: "activity-start",
						data: { key: "_working", text: message, activityType: "system" },
					});
				} else {
					this.deps.notifyWebview({
						type: "activity-end",
						data: { key: "_working" },
					});
				}
			},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async <T>(
				factory: (
					tui: any,
					theme: any,
					keybindings: any,
					done: (result: T) => void,
				) => any,
				options?: { overlay?: boolean },
			): Promise<T> => {
				const factoryName = factory.name || "";
				const callerLine =
					new Error().stack?.split("\n").slice(2, 4).join(" / ") || "";
				this.deps.logDebug(
					`[PI] Extension custom UI (no TUI): factory=${factoryName}, caller=${callerLine}`,
				);
				void options;

				// Call factory with no TUI context so extensions gracefully detect
				// headless mode and call done() to complete initialization.
				return new Promise<T>((resolve) => {
					const done = (result: T) => resolve(result);
					try {
						const component = factory(undefined, undefined, undefined, done);
						// Factory may return a Promise (async component factory).
						// Resolution/failure handled via done() call.
						if (component && typeof (component as any)?.then === "function") {
							(component as Promise<any>).catch((e: unknown) => {
								this.deps.logDebug(
									`[PI] Extension custom factory promise error: ${e}`,
								);
							});
						}
					} catch (e) {
						this.deps.logDebug(`[PI] Extension custom factory error: ${e}`);
						resolve(undefined as unknown as T);
					}
				});
			},
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return undefined as unknown as import("@earendil-works/pi-coding-agent").ExtensionUIContext["theme"];
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "UI not available" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}
}
