# PiLot Studio for VS Code — Agent Instructions

## Commands

- Build: `pnpm run build`
- Compile TS: `pnpm run compile`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Dev server (browser): `pnpm run webview:serve`
- Dev watch (VS Code host assets): `pnpm run webview:dev`
- Package extension: `pnpm run package`

## Verification Flow

- Build requires both webview and extension: `pnpm run build`
- Tests require compilation first: `pnpm test` runs `compile && node ./dist-tsc/test/runTest.js`
- Lint: `pnpm run lint` (ESLint on src/**/*.ts)

## Tech Stack

- TypeScript `^6.0.3` (NodeNext/ESM), VS Code Extension Host runtime
- Svelte `^5.56.0` for the webview UI
- Vite `^8.0.15`, ESLint `^10.4.1`, Mocha + `@vscode/test-electron`, esbuild `^0.28.0`
- Key runtime dependency: `@earendil-works/pi-coding-agent@^0.78.0` (external, loaded at runtime)

## Project Structure

- `src/extension.ts` — extension activation and command registration entry point
- `src/pi-agent-provider.ts` — session lifecycle, webview bridge, settings sync, package/resource actions
- `src/webview/` — Svelte app, components, styles, and browser-side types
- `src/test/` — extension test runner plus unit and integration-style tests
- `src/utils/` — shared utilities such as shell helpers
- `media/` — extension icons, screenshots, and bundled voice binaries
- `README.md` — product usage, setup, and high-level development notes
- `CHANGELOG.md` — released changes

## Conventions

- Keep VS Code settings and PI CLI/TUI settings synchronized through `src/pi-agent-provider.ts`.
- Keep webview-only code inside `src/webview/`; extension TypeScript compilation excludes it via `tsconfig.webview.json`.
- Webview assets are produced into `dist/webview/`; rebuild the webview after UI asset changes before packaging.
- `getWebviewContent()` is responsible for VS Code-safe asset rewriting; do not weaken CSP or resource restrictions.
- Use `pnpm` exclusively. Treat `pnpm-lock.yaml` as the source of truth.

## Git Workflow

- No branch naming, commit convention, or PR template is documented in-repo.
- Follow the user's instructions and existing history instead of inventing a workflow.

## Boundaries

- ✅ Always: Refactor files under `src/`, improve the Svelte UI under `src/webview/`, and add focused lint/test coverage when it meaningfully reduces risk.
- ⚠️ Ask first: Change `package.json` contributions, add dependencies, alter packaging/publishing flow, or change the extension's public configuration surface.
- 🚫 Never: Commit secrets, bypass PI settings sync, or weaken webview resource restrictions/CSP handling.

## Architecture & Key Patterns

### Extension ↔ Webview Communication
- All messages from extension host → webview go through `PiAgentProvider.notifyWebview({ type, data })` which calls `view.webview.postMessage()`.
- All messages from webview → extension host go through `window.vscode.postMessage({ type, data })` and are handled by `MessageHandler.handle()`.
- When adding new message types, add both the send side in `pi-agent-provider.ts` and the receive side in `App.svelte`'s `handleVSCodeMessage` switch.

### PI SDK Integration (AgentSession & Extensions)
- The VS Code extension uses `createAgentSession()` from `@earendil-works/pi-coding-agent` which creates its own `ExtensionRunner` internally during construction.
- The runner starts with a `noOpUIContext` — all `ctx.ui.setStatus()`, `notify()`, `setWorkingMessage()` etc. calls from PI packages are silently discarded unless we replace it.
- **Never call `session.bindExtensions()` after construction** — it re-emits `session_start` and re-discovers resources, causing double-initialization. Instead, use `runner.setUIContext()` directly and set `(session as any)._extensionUIContext` to persist across `session.reload()`.
- Call `(session as any)._applyExtensionBindings?.(runner)` after setting the UI context so the runner picks up the new context immediately.
- The `AgentSessionEvent` types (`tool_execution_start/end`, `compaction_start/end`, `auto_retry_start/end`, etc.) are defined in `@earendil-works/pi-agent-core` and re-exported through `pi-coding-agent`.

### Activity / Package Status Bar
- The PI TUI shows package activity via a `FooterDataProvider` that aggregates extension statuses from `ctx.ui.setStatus(key, text)`, git branch, token stats, and model info.
- In the VS Code extension, we replicate this with:
  - **Extension statuses** — forwarded from our custom `ExtensionUIContext.setStatus()` implementation to the webview as `extension-status` messages.
  - **Derived activity** — tool executions, compaction, auto-retries are derived from `AgentSessionEvent` and sent as `activity-start`/`activity-end` messages.
  - **The `ActivityBar` Svelte component** renders these at the bottom of the chat panel as color-coded animated pills (extension=primary, tool=green, system=amber).
- Extension statuses persist until explicitly cleared (matching PI TUI behavior). Derived activities auto-clear when their end event arrives.
- Tool execution descriptions include arg previews (file paths, commands, patterns) when available.

### Webview State Management
- Svelte 5 runes (`$state`, `$derived`, `$effect`) are used throughout — no stores.
- State flows: `App.svelte` owns top-level state → passes as props → child components emit events via callbacks.
- Message handling centralized in `App.svelte`'s `handleVSCodeMessage` which dispatches to state updates.
