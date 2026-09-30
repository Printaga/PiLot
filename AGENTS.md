# PiLot Studio for VS Code — Agent Instructions

## Commands

- Install: `pnpm install` (CI uses Node 24 and `pnpm install --frozen-lockfile`; use the pnpm version in `package.json`)
- Build (webview + extension bundle): `pnpm run build`
- Compile extension TS: `pnpm run compile`
- Check (compile + webview svelte-check): `pnpm run check`
- Test (compile + VS Code integration suite): `pnpm test` (alias: `test:e2e`)
- Unit tests (plain Node, no VS Code host): `pnpm run test:unit`
- Webview component tests (plain Node + jsdom, mounts real Svelte components): `pnpm run test:webview`
- Run one Mocha file in either lane: `MOCHA_TEST_FILE=unit/git-commit-message.test.js pnpm run test:unit` (suite-relative path of the compiled `.js`)
- Lint (extension TS + Svelte webview): `pnpm run lint` / `pnpm run lint:fix`
- Format (Prettier): `pnpm run format` / `pnpm run format:check`
- Fallow: `pnpm run fallow:review` (advisory) / `pnpm run fallow:audit` (changed-code gate)
- Verification: `pnpm verify` (fast) / `pnpm verify:full` (adds build + integration suite)
- Dev server: `pnpm run webview:serve`
- Dev watch: `pnpm run webview:dev`
- Package: `pnpm run package`

## Verification policy

| Change              | Required feedback                                                                |
| ------------------- | -------------------------------------------------------------------------------- |
| Any code change     | `pnpm verify` (check, lint, format:check, test:unit, test:webview, fallow:audit) |
| UI/runtime behavior | `pnpm verify:full` (verify + build + VS Code integration suite)                  |
| Before commit       | Husky pre-commit runs lint-staged (Prettier + ESLint on staged files)            |
| Before completion   | All required checks pass; never declare done with known failures                 |

- After a targeted code edit, run the narrowest relevant check first, then `pnpm verify`; use `pnpm verify:full` for webview/UI or release-facing changes.
- For documentation-only edits, check affected Markdown with Prettier and run `git diff --check`.
- `src/webview/` is type-checked only by `svelte-check` (part of `pnpm run check`); esbuild/Vite bundling does not type-check it.
- `test:unit` runs the Mocha suites under plain Node against the host-independent VS Code facade (`src/test/mocks/vscode-facade.ts` via `scripts/run-node-tests.mjs`); `test:e2e` runs the same suites inside a real VS Code host — behavior differences between the two are harness gaps worth fixing at the facade, not the tests. Host-only `realhost-*` suites self-skip in the plain-Node lane.
- `test:webview` mounts real Svelte 5 components in jsdom (no bundler): specs live in `src/test/webview/`, compiled on the fly by `scripts/webview-test-loader.mjs`. Fix webview component gaps in the component/test, not the loader — the loader is generic harness, not behavior.
- The Fallow audit gates changed code only (`new-only` attribution, base = `$FALLOW_BASE_REF`, the repo's default branch, or `origin/main`). Inherited findings are baseline debt recorded in `fallow-baselines/`: fix opportunistically when touching that code, never hide them with blanket disables.
- Do not weaken checks (`|| true`, broad `eslint-disable`, ignored diagnostics) and do not convert failures into passes; distinguish real defects from environmental failures honestly.
- Formatting is Prettier-owned: tabs/4 in extension sources (`src/**`), 2 spaces in `src/webview/**`, JSON at 2 spaces. `.editorconfig` mirrors this; do not hand-format.

## Tech Stack

- VS Code extension targeting `^1.85.0`
- TypeScript `~6.0.3` with NodeNext/ESM-style resolution for extension sources
- Svelte `^5.56.9` + Vite `^8.2.2` for the webview UI
- ESLint `^10.8.1`, esbuild `^0.28.2`, Mocha `^12.0.1`, `@vscode/test-electron` `^3.1.0`
- PI SDK: `@earendil-works/pi-coding-agent` is a devDependency for types and tests; `src/loader.cjs` resolves it from the user's globally installed PI CLI at runtime
- Package manager: `pnpm@11.8.0`

## Project Structure

- `src/extension.ts` — extension activation and command registration entry point
- `src/loader.cjs` — CommonJS entry shim (loaded by VS Code, delegates to `dist/` bundle)
- `src/pi-agent-provider.ts` — session lifecycle, webview bridge, settings sync, package/resource actions
- `src/pi-binary.ts` — PI CLI binary detection, version checks, upgrade handling
- `src/session-manager.ts` — session CRUD, tree navigation, fork/merge operations
- `src/session-resources.ts` — workspace context, file mentions, package resolution
- `src/message-handler.ts` — webview message dispatch and routing
- `src/message-serializer.ts` — session message serialization for webview transport
- `src/extension-ui-context.ts` — runner UI hooks, status polling, activity tracking
- `src/footer-manager.ts` — status bar footer data (cwd, git branch, session name)
- `src/voice-manager.ts` — dictation lifecycle, model download, audio streaming
- `src/binary-service.ts` — shell command execution, git branch resolution
- `src/git-extension.ts` — minimal local typings/bridge for the built-in `vscode.git` API
- `src/git-commit-message.ts` — staged-diff commit-message drafting via PI print mode (read-only; never touches git state)
- `src/model-registry-handler.ts` — model list fetching and caching
- `src/package-manager.ts` — PI package install/update/remove operations
- `src/update-checker.ts` — extension update notification and changelog display
- `src/commands/index.ts` — registered VS Code command handlers
- `src/commands/diagnostics.ts` — diagnostics output channel, bounded in-memory log buffer, export helpers
- `src/utils/native-addons.ts` — native addon ABI mismatch detection and recovery
- `src/utils/shell.ts` — cross-platform shell helpers
- `src/protocol/types.ts` — shared host/webview message type definitions
- `src/webview/` — Svelte app (App.svelte + 23 components, entry `main.ts`), types, styles
- `src/test/` — Mocha suites: `suite/unit/` (21 host-independent files), `suite/realhost-*.test.ts` (VS Code host-only integration), `webview/` (jsdom component specs), `mocks/` (`vscode-facade.ts`/`vscode-shim.ts`, `pi-sdk-mocks.ts`, `session-mock.ts`), `runTest.ts` (Electron host runner)
- `scripts/` — verification and test orchestration (`verify.mjs`, `run-node-tests.mjs`, `run-e2e.mjs`, `run-webview-tests.mjs`, `fallow-audit.mjs`, `dl-vscode.mjs`) and install-time patching (`postinstall-patch.mjs`)
- `fallow-baselines/` — checked-in Fallow baselines (dead code, dupes, health) so inherited main debt never gates new changes
- `media/` — icons, screenshots, and bundled voice binaries
- `.github/workflows/ci.yml` — CI runs the same chain as `pnpm verify:full` (build before test stages; xvfb on Linux)
- Root config: `esbuild.config.mjs`, `eslint.config.mjs`, `svelte.config.js`, `tsconfig.json`, `tsconfig.test.json`, `tsconfig.webview.json`, `vite.webview.config.mts`, `pnpm-workspace.yaml`

## Related Docs

- [README.md](./README.md) — setup, features, troubleshooting, and development entry points
- [CHANGELOG.md](./CHANGELOG.md) — release history
- [TODO.md](./TODO.md) — tracked feature/bug backlog
- [media/voice/README.md](./media/voice/README.md) — platform/runtime notes for bundled dictation helpers

## Conventions

- Use `pnpm` exclusively; treat `pnpm-lock.yaml` as the source of truth for versions
- Keep webview-only code inside `src/webview/`; root TS compilation excludes it and Vite builds it separately into `dist/webview/`
- Keep extension settings and PI CLI/TUI settings synchronized through `src/pi-agent-provider.ts`
- When changing a bridge message, update `src/message-handler.ts`, `src/protocol/types.ts`, and the webview consumer as needed. Host notifications use `PiAgentProvider.notifyWebview(...)` or the existing `webview.postMessage(...)` paths; webview messages use `window.vscode.postMessage(...)`.
- `getWebviewContent()` owns VS Code-safe asset rewriting; do not weaken CSP or webview resource restrictions
- Use Svelte 5 runes in the webview; top-level state lives in `App.svelte` rather than shared stores
- Test conventions: Mocha TDD style (`suite`/`test`, not `describe`/`it`), `node:assert` for assertions, mocks via `globalThis.vscode` and `src/test/mocks/` factories
- Child-process arguments that carry settings, paths, or user input must be shell-quoted (`quoteShellArg`) or passed on stdin — repository-derived bytes always travel via stdin, never through the shell. See the header of `src/git-commit-message.ts`; `src/test/suite/unit/argv-injection-guard.test.ts` guards this invariant
- Lint conventions: ESLint flat config (`eslint.config.mjs`) covers TS and `.svelte`; Svelte files need `tseslint.parser` as `parserOptions.parser`; `no-undef` and `svelte/no-at-html-tags` are intentionally off for `.svelte` (svelte-check + webview CSP cover them)
- Formatting is enforced by Prettier + prettier-plugin-svelte; Husky pre-commit runs lint-staged as a safety net, not a substitute for `pnpm verify`

## Gotchas

- `pnpm run webview:dev` is a Vite watch build for the webview, not the extension-host watcher
- `pnpm run webview:serve` uses port `5173` with `strictPort: true`; it fails if that port is busy
- `pnpm test` (e2e) needs a real VS Code: it picks a platform desktop install or honors `VSCODE_PATH`; download a pinned build with `node scripts/dl-vscode.mjs [version]`. A host abort after a fully green run still counts as passing — the runner treats a green `test-results.log` as authoritative and retries each file once
- `postinstall` patches `@earendil-works/pi-coding-agent` under `node_modules` in place via `scripts/postinstall-patch.mjs` (`.agents/skills/` discovery mode plus a stub for the corrupt upstream `photon.js`); reinstalling dependencies re-applies the patches
- Edit source files rather than generated `dist/`, `dist-tsc/`, `node_modules/`, or tool output.
- esbuild leaves PI runtime packages external; bundled output still depends on the PI CLI/runtime being installed and configured
- `fallow init` regenerates `.fallowrc.json` with a default `entry` list (`src/index.ts`) that does not match this repo; keep the generated file's entry override removed so Fallow auto-detects entries from `package.json`
- Linux voice helpers may require system libraries noted in [media/voice/README.md](./media/voice/README.md)

## Agent Platforms

- `AGENTS.md` is the only checked-in agent instruction file in this repo
- No `.github/copilot-instructions.md`, `.github/instructions/`, `.claude/`, `.cursor/`, `.windsurf/`, or `.github/prompts/` files are present
- No `.mcp.json` is checked in

## Boundaries

- ⚠️ Ask first: Change `package.json` contributions, add dependencies, alter packaging/publishing flow, or change the public configuration surface
- 🚫 Never: Commit secrets, bypass PI settings sync, weaken webview CSP/resource restrictions, or treat planning notes as authoritative over code

## Architecture Notes

- The extension uses `createAgentSession()` from `@earendil-works/pi-coding-agent`; do not call `session.bindExtensions()` after construction because it replays startup work
- To restore extension UI hooks after reloads, set the runner UI context directly and preserve `(session as any)._extensionUIContext`
- Activity pills in the webview combine persistent extension statuses with derived session events like tool execution, compaction, and auto-retries
