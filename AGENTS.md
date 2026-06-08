# PiLot Studio for VS Code — Agent Instructions

## Commands

- Build: `pnpm run build`
- Compile TS: `pnpm run compile`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Dev server (browser): `pnpm run webview:serve`
- Dev watch (VS Code host assets): `pnpm run webview:dev`
- Package extension: `pnpm run package`

## Tech Stack

- TypeScript `^6.0.3` (NodeNext/ESM), Node.js `>=24.16.0`
- Svelte `^5.56.0` for the webview UI, VS Code Extension Host for the extension runtime
- Vite `^8.0.15`, ESLint `^10.4.1`, Mocha + `@vscode/test-electron`, esbuild `^0.28.0`
- Key runtime dependency: `@earendil-works/pi-coding-agent@^0.78.0`
- Preferred additions if new stack is introduced: SvelteKit `v2.60.1+`, SQLite with `better-sqlite3 v12.9.0+`

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

## Agent Platforms

- Universal instructions file in use: `AGENTS.md`
- No platform-specific instruction files detected under `.github/`, `.claude/`, `.cursor/`, or `.windsurf/`
