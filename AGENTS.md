# PiLot Studio for VS Code — Agent Instructions

## Commands

- Build: `pnpm run build`
- Compile TS: `pnpm run compile`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Dev server: `pnpm run webview:serve`
- Dev watch: `pnpm run webview:dev`
- Package: `pnpm run package`

## Verification Flow

- Build runs both webview and extension bundling: `pnpm run build`
- Tests require compilation first: `pnpm test` runs `pnpm run compile && node ./dist-tsc/test/runTest.js`
- Lint covers only extension-host TS in `src/**/*.ts`: `pnpm run lint`

## Tech Stack

- VS Code extension targeting `^1.85.0`
- TypeScript `6.0.3` with NodeNext/ESM-style resolution for extension sources
- Svelte `5.56.2` + Vite `8.0.16` for the webview UI
- ESLint `10.4.1`, esbuild `0.28.0`, Mocha `11.7.6`, `@vscode/test-electron` `2.5.2`
- Runtime dependency: `@earendil-works/pi-coding-agent` `0.78.1` loaded externally at runtime
- Package manager: `pnpm@11.8.0`

## Project Structure

- `src/extension.ts` — extension activation and command registration entry point
- `src/pi-agent-provider.ts` — session lifecycle, webview bridge, settings sync, package/resource actions
- `src/webview/` — Svelte app, components, browser-side types, and styles
- `src/protocol/` — shared host/webview message contracts
- `src/test/` — VS Code integration runner plus unit tests
- `scripts/` — install-time patching utilities
- `patches/` — checked-in patches applied during `postinstall`
- `media/` — icons, screenshots, and bundled voice binaries
- `.kilo/plans/` — internal planning notes, not runtime source of truth

## Related Docs

- [README.md](./README.md) — setup, features, troubleshooting, and development entry points
- [CHANGELOG.md](./CHANGELOG.md) — release history
- [media/voice/README.md](./media/voice/README.md) — platform/runtime notes for bundled dictation helpers
- [skill-management-gui.md](./skill-management-gui.md) — planning document only, not implementation truth

## Conventions

- Use `pnpm` exclusively; treat `pnpm-lock.yaml` as the source of truth for versions
- Keep webview-only code inside `src/webview/`; root TS compilation excludes it and Vite builds it separately into `dist/webview/`
- Keep extension settings and PI CLI/TUI settings synchronized through `src/pi-agent-provider.ts`
- Preserve the message bridge contract: host messages flow through `PiAgentProvider.notifyWebview(...)`, webview messages go through `window.vscode.postMessage(...)`, and new message types must be wired on both sides
- `getWebviewContent()` owns VS Code-safe asset rewriting; do not weaken CSP or webview resource restrictions
- Use Svelte 5 runes in the webview; top-level state lives in `App.svelte` rather than shared stores

## Gotchas

- `pnpm run webview:dev` is a Vite watch build for the webview, not the extension-host watcher
- `pnpm run webview:serve` uses port `5173` with `strictPort: true`; it fails if that port is busy
- Tests expect a VS Code executable or `VSCODE_PATH`; see `src/test/runTest.ts`
- `postinstall` patches files under `node_modules` via `scripts/postinstall-patch.mjs`; reinstalling dependencies can change patched runtime behavior
- esbuild leaves PI runtime packages external; bundled output still depends on the PI CLI/runtime being installed and configured
- Linux voice helpers may require system libraries noted in [media/voice/README.md](./media/voice/README.md)

## Git Workflow

- No branch naming, commit convention, or PR template is documented in-repo
- Follow the user's instructions and nearby history instead of inventing a workflow
- Public contribution guidance lives in [README.md](./README.md); release history is maintained in [CHANGELOG.md](./CHANGELOG.md)

## Agent Platforms

- `AGENTS.md` is the only checked-in agent instruction file in this repo
- No `.github/copilot-instructions.md`, `.github/instructions/`, `.claude/`, `.cursor/`, `.windsurf/`, or `.github/prompts/` files are present
- `.mcp.json` exists but currently defines no checked-in MCP servers

## Boundaries

- ✅ Always: Refactor files under `src/`, improve the Svelte UI under `src/webview/`, and add focused lint/test coverage when it materially reduces risk
- ⚠️ Ask first: Change `package.json` contributions, add dependencies, alter packaging/publishing flow, or change the public configuration surface
- 🚫 Never: Commit secrets, bypass PI settings sync, weaken webview CSP/resource restrictions, or treat planning notes as authoritative over code

## Architecture Notes

- The extension uses `createAgentSession()` from `@earendil-works/pi-coding-agent`; do not call `session.bindExtensions()` after construction because it replays startup work
- To restore extension UI hooks after reloads, set the runner UI context directly and preserve `(session as any)._extensionUIContext`
- Activity pills in the webview combine persistent extension statuses with derived session events like tool execution, compaction, and auto-retries
