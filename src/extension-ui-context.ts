import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface ExtensionUIContextDeps {
	getSession: () => AgentSession | undefined;
	extensionStatuses: Map<string, string>;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
}

/** Upper bound for an extension `custom()` factory that never calls done(). */
const CUSTOM_UI_TIMEOUT_MS = 30_000;

/** Structural type for the session_start payload the runner emits. */
interface SessionStartEvent {
	type: "session_start";
	reason: "startup" | "reload" | "new" | "resume" | "fork";
	cwd: string;
	sessionPath?: string;
}

export class ExtensionUIContext {
	private statusPoller: ReturnType<typeof setInterval> | undefined;
	/** Serialized statuses snapshot: the poller only re-broadcasts on change. */
	private lastStatusSnapshot = "";
	/** Error keys this instance has already forwarded (pruned when gone). */
	private reportedErrorKeys = new Set<string>();

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
				this.deps.logDebug("[PI] No extension runner found, skipping UI context binding");
				return;
			}

			// Create a UI context that forwards setStatus calls to the webview
			const uiContext = this.createUIContext();

			// Set the UI context on the runner so extension setStatus calls reach us
			runner.setUIContext(uiContext);

			// Internal (untyped) AgentSession/runner fields we depend on. The upstream
			// API is not fully typed, so the exact shape we touch is declared once and
			// the casts stay isolated here.
			const internals = session as unknown as {
				_extensionUIContext?: unknown;
				_sessionStartEvent?: SessionStartEvent;
				_applyExtensionBindings?: (runner: unknown) => void;
				extendResourcesFromExtensions?: (reason: string) => Promise<void>;
			};
			const runnerInternals = runner as unknown as {
				extensions?: Array<{
					path?: string;
					handlers?: Map<string, Array<unknown>>;
				}>;
			};

			// Preserve our UI context so session.reload() does not restore the no-op one.
			internals._extensionUIContext = uiContext;

			const extensions = runnerInternals.extensions ?? [];
			this.deps.logDebug(`[PiLot DIAGNOSTIC] Extensions loaded: ${extensions.length}`);
			if (extensions.length > 0) {
				const handlers = extensions.map((ext) => ({
					path: ext.path,
					hasSessionStart: ext.handlers?.has("session_start") ?? false,
					handlerCount: ext.handlers?.get("session_start")?.length ?? 0,
				}));
				this.deps.logDebug("[PiLot DIAGNOSTIC] Extension handlers:", handlers);
			}

			this.deps.logDebug(
				`[PI] Bound extension UI context for setStatus forwarding (${extensions.length} extensions loaded)`,
			);

			// Re-apply bindings so the new UI context is used by the runner
			internals._applyExtensionBindings?.(runner);

			// CRITICAL: Emit session_start to initialize extensions
			// Without this, extensions never run their initialization handlers (LSP setup, indexing, etc.)
			// and never call setStatus() to report their activity. A stale cached event
			// must not pin an old cwd/sessionPath, so the payload is rebuilt per bind.
			const sessionStartEvent: SessionStartEvent = {
				type: "session_start",
				reason: "startup",
				cwd: session.sessionManager.getCwd(),
				sessionPath: (session as unknown as { sessionFile?: string }).sessionFile,
			};

			// Store it for future reload() calls
			internals._sessionStartEvent = sessionStartEvent;

			// Re-emitting session_start re-runs initialization (LSP servers,
			// indexers, MCP children). Only the first bind of a runner may emit it;
			// later binds (retry paths, re-binds on the same session) must be
			// idempotent or those processes get duplicated.
			const boundRunner = runner as unknown as { __piLotUIBound?: boolean };
			if (boundRunner.__piLotUIBound) {
				this.deps.logDebug("[PI] Runner already bound; skipping session_start re-emit");
			} else {
				boundRunner.__piLotUIBound = true;
				this.deps.logDebug(
					"[PiLot DIAGNOSTIC] Emitting session_start event:",
					sessionStartEvent,
				);
				this.deps.logDebug("[PI] Emitting session_start to extensions");
				await runner.emit(sessionStartEvent);
				this.deps.logDebug("[PiLot DIAGNOSTIC] session_start emitted successfully");
			}

			// Let extensions discover additional resources (skills, prompts, themes)
			await internals.extendResourcesFromExtensions?.("startup");

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
				this.deps.logDebug("[PiLot DIAGNOSTIC] Sending extension-statuses-full to webview");
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
			if (!runner) return;
			// Optional-chained elsewhere in the runner API: guard this call too so a
			// renamed/absent method cannot kill the poller via the empty catch.
			if (typeof runner.hasUI === "function" && !runner.hasUI()) return;

			// The extension runner stores statuses via the FooterDataProvider.
			// Since we can't access FooterDataProvider directly from the extension host,
			// we rely on the setStatus forwarding from our UI context.
			// This poller is a safety net — send the current full map, but only when
			// it actually changed (setStatus already notifies per change).
			const snapshot = JSON.stringify(Object.fromEntries(this.deps.extensionStatuses));
			if (snapshot !== this.lastStatusSnapshot) {
				this.lastStatusSnapshot = snapshot;
				if (this.deps.extensionStatuses.size > 0) {
					this.deps.notifyWebview({
						type: "extension-statuses-full",
						data: JSON.parse(snapshot),
					});
				}
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

			const currentErrorKeys = new Set<string>();
			for (const err of er.errors) {
				if (!err.path || !err.error) continue;
				const errKey = `ext:error:${err.path}`;
				currentErrorKeys.add(errKey);
				if (this.deps.extensionStatuses.has(errKey)) continue;
				this.reportedErrorKeys.add(errKey);

				const rawError = err.error as unknown;
				let errorText: string;
				if (typeof rawError === "string") {
					errorText = rawError;
				} else if (rawError instanceof Error) {
					errorText = rawError.message;
				} else {
					errorText = JSON.stringify(rawError) ?? String(rawError);
				}
				// Truncate long load errors to first 200 chars
				const displayText =
					errorText.length > 200 ? errorText.slice(0, 200) + "…" : errorText;

				this.deps.extensionStatuses.set(errKey, displayText);
				this.deps.notifyWebview({
					type: "extension-status",
					data: { key: errKey, text: displayText },
				});
			}

			// An error that no longer exists (fixed and reloaded extension) must
			// not stay in the status map forever as a false failure.
			for (const key of this.reportedErrorKeys) {
				if (currentErrorKeys.has(key)) continue;
				this.reportedErrorKeys.delete(key);
				if (this.deps.extensionStatuses.delete(key)) {
					this.deps.notifyWebview({
						type: "extension-status",
						data: { key, text: undefined },
					});
				}
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
				this.deps.logDebug(`[PI] Extension notify: ${type || "info"}: ${message}`);
				this.deps.notifyWebview({
					type: "extension-notify",
					data: { message, type: type || "info" },
				});
			},
			onTerminalInput: () => () => {},
			setStatus: (key: string, text: string | undefined) => {
				this.deps.logDebug(`[PiLot DIAGNOSTIC] setStatus called: ${key} = ${text}`);
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
				factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => any,
				options?: { overlay?: boolean },
			): Promise<T> => {
				const factoryName = factory.name || "";
				const callerLine = new Error().stack?.split("\n").slice(2, 4).join(" / ") || "";
				this.deps.logDebug(
					`[PI] Extension custom UI (no TUI): factory=${factoryName}, caller=${callerLine}`,
				);
				void options;

				// Call factory with no TUI context so extensions gracefully detect
				// headless mode and call done() to complete initialization.
				return new Promise<T>((resolve) => {
					// A factory that never calls done() must not hang initialization
					// forever; the timeout settles the promise as a last resort.
					let settled = false;
					// The timer handle is read by settle() (declared before it) but only
					// written once below, so a mutable holder satisfies prefer-const.
					const timerHolder: { current?: ReturnType<typeof setTimeout> } = {};
					const settle = (result: T) => {
						if (settled) return;
						settled = true;
						if (timerHolder.current !== undefined) clearTimeout(timerHolder.current);
						resolve(result);
					};
					timerHolder.current = setTimeout(() => {
						this.deps.logDebug(
							"[PI] Extension custom factory timed out without calling done()",
						);
						settle(undefined as unknown as T);
					}, CUSTOM_UI_TIMEOUT_MS);
					const done = (result: T) => settle(result);
					try {
						const component = factory(undefined, undefined, undefined, done);
						// Factory may return a Promise (async component factory). Settle
						// from it as well: resolution may bypass done().
						if (component && typeof (component as any)?.then === "function") {
							(component as Promise<any>).then(
								(result: unknown) => {
									if (result !== undefined) settle(result as T);
								},
								(e: unknown) => {
									this.deps.logDebug(
										`[PI] Extension custom factory promise error: ${e}`,
									);
									settle(undefined as unknown as T);
								},
							);
						}
					} catch (e) {
						this.deps.logDebug(`[PI] Extension custom factory error: ${e}`);
						settle(undefined as unknown as T);
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
