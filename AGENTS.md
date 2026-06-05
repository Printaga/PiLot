# PiLot Studio for VS Code — Agent Instructions

## Commands

- Build: `pnpm run build`
- Compile TS: `pnpm run compile`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Dev server (UI): `pnpm run webview:serve` (browser) or `pnpm run webview:dev` (VS Code host watch)
- Package: `pnpm run package`

## Tech Stack

- **Languages**: TypeScript `^6.0.3` (NodeNext/ESM)
- **Frameworks**: Svelte `^5.56.0` (for webview UI), VS Code Extension Host
- **Tooling**: Vite `^8.0.15`, ESLint `^10.4.1`, Mocha + `@vscode/test-electron`
- **Platform**: Node.js `>=24.16.0`
- **Key Dependencies**: `@earendil-works/pi-coding-agent@0.78.0`
- **User Preferences**: Preferred stack includes SvelteKit v2.60.1+, SQLite (with better-sqlite3 v12.9.0+). (Note: SvelteKit/SQLite not currently active in this repo, but use these versions if adding them).

## Project Structure

- `src/extension.ts` — extension activation and command registration
- `src/commands/` — VS Code commands (explain, refactor, analyze)
- `src/webview/` — Svelte app source code
- `src/test/` — extension test runner and tests
- `src/pi-agent-provider.ts` — webview provider, session lifecycle, model/settings sync
- `dist/` — compiled extension output and built webview assets
- `dist-tsc/` — output from tests/compiler
- `docs/` — see [README.md](./README.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

## Conventions

- **Settings Sync**: Keep VS Code settings and PI TUI/CLI settings synchronized via `pi-agent-provider.ts`.
- **Webview Isolation**: Keep webview-specific code strictly inside `src/webview/` (`tsconfig.webview.json`). Extension TS compilation excludes this.
- **Webview Loading**: Assets load from `dist/webview/index.html`. Rebuild webview on UI asset changes.
- **CSP & Assets**: `getWebviewContent()` rewrites Vite asset paths, strips `crossorigin`, and removes hardcoded CSP for VS Code compatibility.
- **Package Manager**: Use `pnpm` exclusively. `pnpm-lock.yaml` is the source of truth. Do not use npm or yarn.

## Git Workflow

- No specific branch naming, commit convention, or PR process is documented.
- Do not invent a workflow; follow the user's instructions and existing repository history if asked.

## Boundaries

- ✅ **Always**: Refactor files under `src/`, improve Svelte UI in `src/webview/`, add focused lint/test coverage to reduce risk.
- ⚠️ **Ask first**: Change `package.json` contributions, add dependencies, alter packaging/publishing flow, or change the extension's public configuration surface.
- 🚫 **Never**: Commit secrets, weaken webview resource restrictions, or bypass the settings sync with the PI TUI/CLI.

## Agent Platforms

- **Universal instructions file**: `AGENTS.md` (this file).
- No platform-specific instruction files detected (`.github/`, `.claude/`, `.cursor/`, `.windsurf/`).
