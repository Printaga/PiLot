import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	PiAgentProvider,
	piAgentProviderInternals,
	type PiAgentConfig,
} from "../../pi-agent-provider.js";
import { ModelRegistryHandler } from "../../model-registry-handler.js";
import { PackageManager } from "../../package-manager.js";
import { SessionListManager } from "../../session-manager.js";
import { createSessionMock, createResourceLoaderMock } from "../mocks/session-mock.js";
import {
	createMockBinaryService,
	createMockMemento,
	createMockModelRegistry,
	createMockModelRuntime,
	createMockSessionManager,
	createMockSettingsManager,
} from "../mocks/pi-sdk-mocks.js";

// Real-host lane: boots the SHIPPED webview (dist/webview/index.html as built
// by Vite) inside a real VS Code webview panel and verifies that it loads and
// communicates under the now-enforced Content-Security-Policy:
//   1. the host-side HTML transform keeps the policy authoritative
//      (cspSource substitution, nonce in script-src, media-globals script),
//   2. the real renderer executes the bundle and completes the ready
//      handshake (script-src must allow the bundle + the nonce'd script),
//   3. the packages panel mounts and speaks (switchTab → listPackages /
//      getResourceToggles → "installed" broadcast),
//   4. CSP verdicts are observed live from inside the page: the two npm
//      registry fetches the panel relies on are allowed, 'self' (a real
//      webview asset URL) is allowed, and a cross-origin negative control is
//      blocked.
// The agent dir is pointed at a temp folder so nothing touches ~/.pi/agent.

const tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-webview-"));
process.env.PI_CODING_AGENT_DIR = tempAgentDir;

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const builtIndexHtml = path.join(repoRoot, "dist", "webview", "index.html");

interface CapturedMessage {
	type?: string;
	id?: string;
	data?: any;
	isError?: boolean;
}

/** True when the VS Code facade (plain-Node lane) answered instead of the real host. */
function isFacadeLane(): boolean {
	return vscode.extensions.getExtension("vscode.git") === undefined;
}
suite("REALHOST webview boots under the enforced CSP", () => {
	let provider: PiAgentProvider;
	/** Messages posted webview→host, in arrival order (real page AND simulator). */
	const inbox: CapturedMessage[] = [];
	/** Messages posted host→webview (real panel outbox; wired in the boot test). */
	const outbox: CapturedMessage[] = [];
	/** HTML emitted by getWebviewContent() (mock webview lane for pure analysis). */
	let emittedHtml = "";
	/** HTML actually served to the real panel by resolveWebviewView(). */
	let realServedHtml = "";
	/** Real panel (host lane; created in the boot test before resolve). */
	let panel: vscode.WebviewPanel | undefined;
	let savedInternals: Record<string, any> = {};

	// VS Code surface overrides (facade lane only) — restored in teardown.
	let savedFsReadFile: any;
	let savedGetConfiguration: any;

	// Deterministic CSP source for the facade lane's transform assertions.
	const FAKE_CSP_SOURCE = "https://mock-csp-source.vscode-cdn.net";

	suiteSetup(async function () {
		this.timeout(30_000);

		if (!fs.existsSync(builtIndexHtml)) {
			throw new Error(
				`dist/webview/index.html is missing — run \`pnpm run webview:build\` before this suite (checked ${builtIndexHtml})`,
			);
		}

		if (isFacadeLane()) {
			// Plain-Node lane: the facade's workspace.fs cannot read real files,
			// and its getConfiguration().get() ignores fallbacks — give it the
			// real-API semantics (return the caller's default).
			const facadeFs = (vscode.workspace as any).fs;
			savedFsReadFile = facadeFs.readFile;
			// Return the Buffer itself: workspace.fs.readFile contract is a
			// Uint8Array (Buffer is one), and the provider calls .toString() on
			// it — a wrapped copy would stringify as comma-joined byte numbers.
			facadeFs.readFile = async (uri: vscode.Uri) => fs.readFileSync(uri.fsPath);
			const facadeWs = vscode.workspace as any;
			savedGetConfiguration = facadeWs.getConfiguration;
			facadeWs.getConfiguration = (_section?: string) => ({
				get: (_key: string, fallback?: unknown) => fallback,
				update: async () => {},
			});
		}

		// ── Provider with the unit fixture's dependency seams ──────────────
		// The SDK seams are stubbed so initialize() would be safe, and
		// isInitialized is set true so resolveWebviewView's fire-and-forget
		// initialize() returns immediately instead of doing real SDK work.
		const internals = piAgentProviderInternals as unknown as Record<string, any>;
		savedInternals = {
			createModelRuntime: internals.createModelRuntime,
			createModelRegistry: internals.createModelRegistry,
			createSettingsManager: internals.createSettingsManager,
			createSessionManager: internals.createSessionManager,
			createAgentSession: internals.createAgentSession,
			getAgentDir: internals.getAgentDir,
		};
		internals.createModelRuntime = async () => createMockModelRuntime();
		internals.createModelRegistry = () => createMockModelRegistry();
		internals.createSettingsManager = () => createMockSettingsManager();
		internals.createSessionManager = () => createMockSessionManager(tempAgentDir);
		internals.createAgentSession = async () => ({
			session: createSessionMock({ resourceLoader: createResourceLoaderMock() }),
			extensionsResult: { statuses: [] },
		});
		internals.getAgentDir = () => tempAgentDir;

		const config: PiAgentConfig = {
			defaultModel: "anthropic/claude-sonnet-4-5",
			defaultProvider: "anthropic",
			autoContext: false,
			maxTokens: 8192,
			thinkingLevel: "medium",
		};

		const availableModels: any[] = [
			{ id: "test/model", name: "Test Model", provider: "test", contextWindow: 128000 },
		];

		const mockCtx = {
			extensionUri: vscode.Uri.file(repoRoot),
			globalState: createMockMemento() as any,
			workspaceState: createMockMemento() as any,
			subscriptions: [] as vscode.Disposable[],
			extension: { packageJSON: { version: "2.7.0" } },
		};
		provider = new PiAgentProvider(mockCtx as unknown as vscode.ExtensionContext, config);

		const mockBinary = {
			...createMockBinaryService({ getCliVersion: async () => "0.1.0" }),
			resolveAtStartup: () => {},
			prependToPath: () => {},
			isBinaryAvailable: () => true,
			getBinaryPath: () => "pi-unused-stub",
		} as any;
		(provider as any).binaryService = mockBinary;

		// Pre-set the session so resolveWebviewView skips newSession() and its
		// real session bootstrap — the handshake under test needs the view and
		// the message handler, not a live agent session.
		(provider as any).session = createSessionMock({
			resourceLoader: createResourceLoaderMock(),
			sessionId: "webview-csp-test-session",
		});
		(provider as any).isInitialized = true;

		(provider as any).footerManager = {
			start: () => {},
			stop: () => {},
			sendFooterData: () => {},
			dispose: () => {},
		} as any;
		(provider as any).modelRegistryHandler = new ModelRegistryHandler({
			getModelRegistry: () => (provider as any).modelRegistry,
			getModelRuntime: () => (provider as any).modelRuntime,
			getSettingsManager: () => (provider as any).settingsManager,
			binaryService: mockBinary,
			availableModels,
			favoriteModels: (provider as any).favoriteModels ?? [],
			currentModelId: (provider as any).currentModelId,
			globalState: mockCtx.globalState,
			notifyWebview: (msg: any) => (provider as any).notifyWebview(msg),
			logError: () => {},
			logDebug: () => {},
		});
		(provider as any).packageManager = new PackageManager({
			getResourceLoader: () => (provider as any).session?.resourceLoader,
			getConfiguredPackages: () => [],
			binaryService: mockBinary,
			notifyWebview: (msg: any) => (provider as any).notifyWebview(msg),
			logDebug: () => {},
			logError: () => {},
		});
		// listPackages shells out to the real pi binary — stub it (same seam
		// the unit fixture uses) so the panel round-trip stays process-free.
		(provider as any).packageManager.listPackages = async () => [
			{ source: "npm:stub-pkg", enabled: true, types: ["unknown"] },
		];
		(provider as any).sessionListManager = new SessionListManager({
			config,
			getSession: () => (provider as any).session,
			setSession: (s: any) => {
				(provider as any).session = s;
			},
			getSessionManager: () => (provider as any).sessionManager,
			setSessionManager: (m: any) => {
				(provider as any).sessionManager = m;
			},
			getModelRegistry: () => (provider as any).modelRegistry,
			getModelRuntime: () => (provider as any).modelRuntime,
			getSettingsManager: () => (provider as any).settingsManager,
			notifyWebview: (msg: any) => (provider as any).notifyWebview(msg),
			logDebug: () => {},
			logError: () => {},
			onSessionDeleted: async () => {},
		});

		// The provider's own MessageHandler (built in its constructor) is what
		// resolveWebviewView registers on the view — no separate instance needed.
	});

	suiteTeardown(async function () {
		this.timeout(15_000);
		panel?.dispose();
		// Restore internals seams before restoring fs so a thrown teardown
		// cannot leave the next file running against stubbed SDK seams.
		const internals = piAgentProviderInternals as unknown as Record<string, any>;
		for (const [key, value] of Object.entries(savedInternals)) {
			if (value !== undefined) internals[key] = value;
		}
		if (savedFsReadFile) {
			(vscode.workspace as any).fs.readFile = savedFsReadFile;
		}
		if (savedGetConfiguration) {
			(vscode.workspace as any).getConfiguration = savedGetConfiguration;
		}
		fs.rmSync(tempAgentDir, { recursive: true, force: true });
	});

	/** Suite-stable capturing mock for the facade lane (html persists across tests). */
	let facadeWebview: (vscode.Webview & { html: string }) | undefined;

	/** Webview: the real panel's (host lane) or a capturing mock (facade lane). */
	function captureWebview(): vscode.Webview & { html: string } {
		if (panel) return panel.webview as unknown as vscode.Webview & { html: string };
		if (facadeWebview) return facadeWebview;
		const listeners: Array<(m: any) => void> = [];
		const mock = {
			// Capture host→webview replies so the facade lane can assert them.
			postMessage: async (m: unknown) => {
				outbox.push(m as CapturedMessage);
				return true;
			},
			options: {},
			asWebviewUri: (uri: vscode.Uri) => uri,
			cspSource: FAKE_CSP_SOURCE,
			html: "",
			onDidReceiveMessage: (l: (m: any) => void) => {
				listeners.push(l);
				return { dispose: () => {} };
			},
			// test hook used by the simulator below
			...({ __listeners: listeners } as any),
		} as unknown as vscode.Webview & { html: string };
		facadeWebview = mock;
		return mock;
	}

	/** View wrapper: real panel.webview in the host lane, mock in the facade lane. */
	function viewFor(webview: vscode.Webview): vscode.WebviewView {
		return {
			webview,
			title: "",
			description: undefined,
			visible: true,
			show: () => {},
			// WebviewPanel has no onDidChangeVisibility (that's onDidChangeViewState).
			onDidChangeVisibility: () => ({ dispose: () => {} }),
			dispose: () => {},
		} as unknown as vscode.WebviewView;
	}

	/** Deliver a webview→host message through the provider's registered handler. */
	function simulateFromWebview(webview: unknown, message: unknown): void {
		const listeners = (webview as any).__listeners as Array<(m: any) => void>;
		assert.ok(listeners && listeners.length > 0, "onDidReceiveMessage must be registered");
		for (const l of listeners) l(message);
	}

	async function waitFor(
		description: string,
		predicate: () => boolean,
		timeoutMs = 20_000,
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(
			`Timed out after ${timeoutMs}ms waiting for: ${description}. Inbox: ${JSON.stringify(inbox).slice(0, 1500)}`,
		);
	}

	test("emitted HTML keeps the CSP authoritative and hardens it", async function () {
		this.timeout(15_000);
		const webview = captureWebview();
		emittedHtml = await (provider as any).getWebviewContent(webview);

		const policyMatch = emittedHtml.match(
			/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i,
		);
		assert.ok(policyMatch, "a CSP meta tag must survive the transform");
		const policy = policyMatch[1];

		// Exactly one CSP meta — the src/index.html tag, still authoritative.
		const cspCount = (emittedHtml.match(/http-equiv="Content-Security-Policy"/gi) ?? []).length;
		assert.strictEqual(cspCount, 1, "exactly one CSP meta tag must remain");

		const cspSource = (webview as any).cspSource as string;
		// 'self' is widened with the webview resource origin everywhere.
		assert.ok(
			policy.includes(`script-src 'self' ${cspSource} 'nonce-`),
			`script-src must list 'self', cspSource and a nonce; got: ${policy}`,
		);
		assert.ok(
			policy.includes(`style-src 'self' ${cspSource} 'unsafe-inline'`),
			`style-src must keep 'unsafe-inline' for Svelte styles; got: ${policy}`,
		);
		assert.ok(
			policy.includes(`img-src 'self' ${cspSource} data:`),
			`img-src must be allowlist-only; got: ${policy}`,
		);
		assert.ok(
			policy.includes(`connect-src 'self' ${cspSource} https://registry.npmjs.org`),
			`connect-src must allow only self and the npm registry; got: ${policy}`,
		);
		assert.ok(policy.includes("base-uri 'self'"), "base-uri 'self' required");
		assert.ok(policy.includes("form-action 'self'"), "form-action 'self' required");
		assert.ok(policy.includes("object-src 'none'"), "object-src 'none' required");
		// No scheme wildcards survive anywhere: the whole point of the enforced
		// policy is that img-src etc. are allowlists, not `https:` catch-alls.
		for (const directive of policy.split(";")) {
			const name = directive.trim().split(/\s+/)[0];
			if (!name) continue;
			assert.ok(
				!/(^|\s)(https?|wss?):(\s|$)/.test(directive),
				`directive ${name} must not contain a scheme wildcard; got: ${directive.trim()}`,
			);
		}

		// The nonce in the policy covers exactly the injected media script
		// (the provider emits the script body on its own line after the tag).
		const nonce = policy.match(/'nonce-([0-9a-f]{32})'/)?.[1];
		assert.ok(nonce, "script-src must carry a 32-hex-char nonce");
		const mediaScriptRe = new RegExp(`<script nonce="${nonce}">\\s*window\\.__MEDIA_ICON__`);
		assert.ok(
			mediaScriptRe.test(emittedHtml),
			"the media-globals script must be injected with the CSP nonce before </head>",
		);
		assert.ok(
			emittedHtml.indexOf(`<script nonce="${nonce}">`) < emittedHtml.indexOf("</head>"),
			"media script must live inside <head>",
		);

		// Assets are webview URIs, crossorigin is gone, and every <script> is
		// either the nonce'd media script or a CSP-covered external module.
		assert.ok(
			!/src="\.\/assets\//.test(emittedHtml),
			"relative ./assets/ paths must be rewritten to webview URIs",
		);
		assert.ok(emittedHtml.includes("assets/index-"), "hashed bundle must be referenced");
		assert.ok(!/crossorigin/i.test(emittedHtml), "crossorigin must be stripped");
		const scriptTags = emittedHtml.match(/<script\b[^>]*>/gi) ?? [];
		assert.ok(scriptTags.length >= 2, "bundle + injected media script expected");
		for (const tag of scriptTags) {
			assert.ok(
				/nonce="[0-9a-f]{32}"/.test(tag) || /src="/.test(tag),
				`inline scripts must be nonce'd; offending tag: ${tag}`,
			);
		}
	});

	test("resolveWebviewView serves the emitted page and registers the handler", async function () {
		this.timeout(30_000);
		// Real panel = real Chromium renderer + real webview.cspSource. Created
		// here (not in setup) so a facade-lane run never touches Electron UI.
		if (!isFacadeLane()) {
			panel = vscode.window.createWebviewPanel(
				"pilotsCspProbe",
				"PiLot CSP probe",
				{ viewColumn: vscode.ViewColumn.One, preserveFocus: true },
				{
					enableScripts: true,
					localResourceRoots: [
						vscode.Uri.joinPath(vscode.Uri.file(repoRoot), "dist", "webview"),
						vscode.Uri.joinPath(vscode.Uri.file(repoRoot), "media"),
					],
				},
			);
			panel.webview.onDidReceiveMessage((m: CapturedMessage) => inbox.push(m));
			// Mirror the host→webview direction so broadcasts can be asserted.
			const origPost = panel.webview.postMessage.bind(panel.webview);
			(panel.webview as any).postMessage = (m: unknown) => {
				outbox.push(m as CapturedMessage);
				return origPost(m);
			};
		}

		const webview = captureWebview();
		provider.resolveWebviewView(viewFor(webview));

		// The fire-and-forget chain must complete: page served, handler wired.
		await waitFor("resolveWebviewView to serve webview.html", () =>
			Boolean((webview as any).html && (webview as any).html.length > 0),
		);
		realServedHtml = (webview as any).html as string;
		assert.ok(
			realServedHtml.length > 1_000,
			"served page must be the built document (inline CSP + bundle reference)",
		);
		assert.ok(
			/http-equiv="Content-Security-Policy"/.test(realServedHtml),
			"served page must carry the authoritative CSP meta",
		);
		// The real cspSource must appear in the served policy — the transform
		// used the panel's own origin, not a stale or fake one. A bare substring
		// probe would match the origin embedded anywhere (path, query, another
		// directive's argument — CodeQL js/incomplete-url-substring-sanitization),
		// so assert on the token level instead. cspSource may itself be a
		// multi-source string (e.g. "'self' https://*.vscode-cdn.net"): require
		// EVERY source it names to appear as an exact, standalone source-list
		// token. The host substitutes `'self' ${cspSource}`, so a cspSource that
		// already carries 'self' yields a duplicated-but-valid 'self' token.
		const activeCspSource = panel ? panel.webview.cspSource : FAKE_CSP_SOURCE;
		const servedPolicy = realServedHtml.match(
			/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i,
		)![1];
		const cspTokens = (p: string) =>
			p
				.split(";")
				.flatMap((directive) => directive.trim().split(/\s+/))
				.filter(Boolean);
		const servedTokens = cspTokens(servedPolicy);
		const cspSourceSources = activeCspSource.trim().split(/\s+/).filter(Boolean);
		assert.ok(
			cspSourceSources.every((source) => servedTokens.includes(source)),
			`served policy must embed every source of the webview's real cspSource (${activeCspSource}); got: ${servedPolicy}`,
		);
		// The mock-webview emission and the real emission differ only in the
		// URI scheme of rewritten assets (passthrough file:// vs webview CDN);
		// the policy structure must be byte-identical apart from cspSource.
		const mockPolicy = emittedHtml.match(
			/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i,
		)![1];
		// The nonce is regenerated per getWebviewContent call — normalize it so
		// only the structural shape is compared.
		const normalize = (p: string) =>
			p
				.replaceAll(FAKE_CSP_SOURCE, "<CSP_SOURCE>")
				.replaceAll(activeCspSource, "<CSP_SOURCE>")
				.replace(/'nonce-[0-9a-f]{32}'/g, "'<NONCE>'");
		assert.strictEqual(
			normalize(mockPolicy),
			normalize(servedPolicy),
			"policy shape must be identical regardless of which webview emitted it",
		);
	});

	test("real webview completes the ready handshake under CSP", async function () {
		if (isFacadeLane()) this.skip(); // needs a real Chromium renderer

		this.timeout(30_000);
		// The module bundle (script-src 'self' + cspSource) executes, Svelte
		// mounts, acquireVsCodeApi() runs and posts {type:"ready"} (visible in
		// the inbox); the host answers with the typed ready payload — captured
		// in the outbox — a full round trip through the enforced policy.
		// The renderer executes the bundle asynchronously — poll for the app's
		// ready request instead of asserting it synchronously.
		await waitFor("the app's ready request", () => inbox.some((m) => m.type === "ready"));
		await waitFor("the host's ready response", () =>
			outbox.some((m) => m.type === "ready" && m.data && typeof m.data === "object"),
		);
		const ready = outbox.find((m) => m.type === "ready")!;
		assert.strictEqual(ready.data.appVersion, "2.7.0", "ready payload carries appVersion");
		assert.ok(Array.isArray(ready.data.models), "ready payload carries the models list");
		assert.ok(typeof ready.data.sessionId === "string", "ready payload carries the session id");

		// The app's boot queries are answered with typed broadcasts — reaching
		// the outbox proves the page received them (postMessage resolved).
		for (const type of ["pi-settings-changed", "light-mode-changed", "auto-context-changed"]) {
			await waitFor(`the ${type} broadcast`, () => outbox.some((m) => m.type === type));
			const broadcast = outbox.find((m) => m.type === type)!;
			assert.ok(
				broadcast.data && typeof broadcast.data === "object",
				`${type} must carry a data payload`,
			);
		}
	});

	test("packages panel mounts on switchTab and completes the listPackages round trip", async function () {
		if (isFacadeLane()) this.skip(); // needs a real Chromium renderer

		this.timeout(30_000);
		// Host→webview: switch to the Packages tab. The CSP does not govern
		// postMessage, so this works even while scripts are nonce-restricted.
		panel!.webview.postMessage({ type: "switchTab", data: { tab: "packages" } });

		// PiPackagesPanel.onMount posts listPackages + getResourceToggles; the
		// arrival of BOTH proves the panel component mounted and spoke.
		await waitFor("the packages panel's listPackages request", () =>
			inbox.some((m) => m.type === "listPackages"),
		);
		await waitFor("the packages panel's getResourceToggles request", () =>
			inbox.some((m) => m.type === "getResourceToggles"),
		);
		// The host must answer: sendPackagesList broadcasts type "installed",
		// and the stub seam's entry proves it carried real provider data. The
		// payload is wrapped — `{ installed: [...] }` — because the webview's
		// parseHostMessage collapses non-object payloads to {} and a bare array
		// used to render as "No packages installed".
		await waitFor("the 'installed' packages-list broadcast", () =>
			outbox.some((m) => m.type === "installed"),
		);
		const installed = outbox.find((m) => m.type === "installed")!;
		assert.ok(
			Array.isArray(installed.data?.installed) &&
				installed.data.installed.some((p: any) => p?.source === "npm:stub-pkg"),
			`'installed' broadcast must carry the wrapped package list; got: ${JSON.stringify(installed.data)}`,
		);
	});

	test("CSP verdicts observed in the page: registry allowed, cross-origin blocked", async function () {
		if (isFacadeLane()) this.skip(); // needs a real Chromium renderer

		this.timeout(60_000);
		// Serve a minimal page carrying the PRODUCTION policy byte-for-byte
		// (extracted from the served HTML) plus one nonce'd probe script. The
		// app bundle is absent, so the probe gets the single
		// acquireVsCodeApi() permit and can report results home. Executing at
		// all proves the nonce path works with the shipped policy; the fetch
		// verdicts prove connect-src enforcement.
		const servedPolicy = realServedHtml.match(
			/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i,
		)![1];
		const nonce = servedPolicy.match(/'nonce-([0-9a-f]{32})'/)?.[1];
		assert.ok(nonce, "served policy must carry a nonce to reuse for the probe");

		// A real asset URL from the served page doubles as the 'self' probe
		// target (same webview origin; connect-src 'self' must allow it).
		const selfTarget = realServedHtml.match(/<script[^>]*src="([^"]+)"/)?.[1];
		assert.ok(selfTarget, "served page must reference its bundle by URL");
		assert.ok(
			selfTarget.startsWith("http") || selfTarget.startsWith("vscode-webview"),
			`bundle URL must be a webview resource URI; got: ${selfTarget}`,
		);

		// A MINIMAL page: production policy verbatim + probe script only. The
		// app bundle must NOT be present — it would boot again and take the
		// single acquireVsCodeApi() permit before the probe could.
		const probeScript = `<script nonce="${nonce}">
(function () {
  var results = { search: null, manifest: null, blockedControl: null, self: null, errors: {} };
  var posted = false;
  function record(key, ok, err) {
    results[key] = ok === true;
    if (err) results.errors[key] = String((err && err.message) || err);
    maybePost();
  }
  function maybePost() {
    if (posted) return;
    if (results.search === null || results.manifest === null ||
        results.blockedControl === null || results.self === null) return;
    posted = true;
    try {
      var v = acquireVsCodeApi();
      v.postMessage({ type: "cspProbeResult", data: results });
    } catch (e) { /* renderer torn down */ }
  }
  fetch("https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250")
    .then(function () { record("search", true, null); },
          function (e) { record("search", false, e); });
  fetch("https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest")
    .then(function () { record("manifest", true, null); },
          function (e) { record("manifest", false, e); });
  fetch("https://example.com/pi-csp-negative-control")
    .then(function () { record("blockedControl", true, null); },
          function (e) { record("blockedControl", false, e); });
  fetch(${JSON.stringify(selfTarget)})
    .then(function () { record("self", true, null); },
          function (e) { record("self", false, e); });
  // Give slow verdicts a moment, then post whatever settled (nulls stay).
  setTimeout(maybePost, 8000);
})();
</script>`;

		// A MINIMAL page: production policy verbatim + probe script only. The
		// app bundle must NOT be present — it would boot again and take the
		// single acquireVsCodeApi() permit before the probe could.
		const probeHtml = `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${servedPolicy}" />\n  </head>\n  <body>${probeScript}</body>\n</html>`;
		assert.notStrictEqual(probeHtml, realServedHtml, "probe page must be the minimal variant");

		// The probe page keeps the production policy verbatim.
		assert.ok(
			probeHtml.includes(`content="${servedPolicy}"`),
			"probe page must reuse the production policy byte-for-byte",
		);
		panel!.webview.html = probeHtml;

		await waitFor(
			"the cspProbeResult message",
			() => inbox.some((m) => m.type === "cspProbeResult"),
			45_000,
		);
		const probe = inbox.find((m) => m.type === "cspProbeResult")!.data;

		assert.strictEqual(
			probe.blockedControl,
			false,
			`cross-origin negative control must be blocked by the enforced CSP; errors: ${JSON.stringify(probe.errors)}`,
		);
		assert.strictEqual(
			probe.search,
			true,
			`the packages panel's npm search fetch must be allowed by connect-src; errors: ${JSON.stringify(probe.errors)}`,
		);
		assert.strictEqual(
			probe.manifest,
			true,
			`the packages panel's /latest manifest fetch must be allowed by connect-src; errors: ${JSON.stringify(probe.errors)}`,
		);
		assert.strictEqual(
			probe.self,
			true,
			`fetch of a webview asset URL must be allowed by connect-src 'self'; errors: ${JSON.stringify(probe.errors)}`,
		);
	});

	test("facade lane: served page satisfies the same protocol without a renderer", async function () {
		if (!isFacadeLane()) this.skip(); // host lane already proved the real thing

		this.timeout(15_000);
		const webview = captureWebview();
		assert.ok(
			(webview as any).html.length > 1_000,
			"resolveWebviewView must have served the emitted page in this lane too",
		);
		simulateFromWebview(webview, { type: "ready", data: {} });
		await waitFor(
			"the host's ready response",
			() => outbox.some((m) => m.type === "ready" && m.data && typeof m.data === "object"),
			5_000,
		);
		const ready = outbox.find((m) => m.type === "ready")!;
		assert.strictEqual(ready.data.appVersion, "2.7.0");
		assert.ok(Array.isArray(ready.data.models));

		simulateFromWebview(webview, { type: "getLightMode", id: "getLightMode", data: {} });
		await waitFor(
			"the getLightMode id response",
			() => outbox.some((m) => m.id === "getLightMode"),
			5_000,
		);
		const lightMode = outbox.find((m) => m.id === "getLightMode")!;
		assert.strictEqual(lightMode.data, false, "lightMode default is off");
		assert.strictEqual(lightMode.isError, false);
	});
});
