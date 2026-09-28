# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [Unreleased]

### Security

- Replaced shell-string `execSync` interpolation with argv-array `execFileSync` / `node:fs` in `postinstall-patch.mjs`, `native-addons.ts`, and the VS Code download/clean-up scripts (command/shell injection).
- Escaped quotes in `MessageBubble`'s `escapeHtml`, stopped emitting inline `onclick` attributes, and tightened the webview CSP (no `unsafe-inline`, explicit `connect-src`) — closes the attribute-injection XSS vector.
- Removed the remote Google Fonts `@import` from the webview styles (blocked by CSP anyway; leaked a request per load).
- Constrained `@mention` file resolution in `session-resources.ts` to the workspace root (path traversal like `@../../etc/passwd`).
- Constrained `MOCHA_TEST_FILE` resolution in the test scaffold and sub-path imports in `loader.cjs` against escaping their intended roots.
- All webview `message` handlers (`ContextIndicator`, `PiPackagesPanel`, `SessionTree`, `VoiceCapture`) now validate `event.data` shape via a shared guard before trusting payloads.
- `message-serializer.ts` no longer trusts untyped upstream payload shapes (defensive parsing before serialization).

### Fixed

- `pi-binary.ts`: bare-name `pi` lookup now resolves again (spawned a shell builtin with `shell: false`); arg-env quoting hardened.
- `loader.cjs`: fixed the `@earendel-works` package-name typo, extracted doc URLs to constants, added timeouts to `which`/`where` probes, hooked `Module._resolveFilename` without leaking a process-wide duplicate hook, and resolved bare imports via the package `exports` map before guessing `dist/index.js`.
- `shell.ts`: Windows callers can no longer hit cmd.exe `shell: true` interpolation (quoting seam enforced).
- `verify.mjs` / `fallow-audit.mjs`: signal-terminated and spawn-failed runs are reported distinctly instead of collapsing into a generic exit code; `result.error` is no longer ignored (fail-open CI).
- `run-node-tests.mjs`, `runTest.ts`, test scaffold: watchdog/no-result paths now exit non-zero — no more green CI for failed or misconfigured runs; each test file gets a pid-suffixed tmpdir (parallel-safe) and VS Code discovery is cross-platform instead of hardcoded.
- `dl-tmp.mjs` / `dl-vscode.mjs`: top-level awaits are handled; VS Code version comes from env/config instead of a hardcoded 1.85.0.
- `run-clean.mjs`: removed the machine-specific `/home/lenovo/...` path; VS Code discovery matches `runTest.ts`.
- `session-manager.ts`: multi-session delete now settles per item, reporting which sessions failed and why, instead of failing the whole batch.
- `voice-manager.ts`: temp recording files are cleaned up and stdio listeners detached on stop/dispose.
- `MermaidDiagram`: render cache is capped with eviction; stale async renders can no longer overwrite a newer diagram.
- `MessageBubble`: markdown re-render effect no longer loops unboundedly; tool-call state is cleared on stream errors and new sessions in `App.svelte`.
- `PiPackagesPanel`: registry lookups are batched (no N+1 fan-out), stale responses are discarded, install log is capped, and the installing overlay can no longer deadlock.
- `Toast` timers are cleared on unmount and the stack is capped; `ContextIndicator` clamps percent to 0–100; `OnboardingTour` guards step bounds.
- Accessibility: tooltips wired via `aria-describedby`, `role="button"` handles Space, dialogs focusable; `prefers-reduced-motion` respected by `ActivityBar` and `SkeletonLoader` animations.
- Test mocks: `pi-sdk-mocks` Proxy is overrideable and `disposeCalls` tracks; `session-mock` no longer double-registers handlers or force-casts; `vscode-facade` fires listeners exactly once.
- Deduplicated `PiAgentConfig`/`ThinkingLevel`/`SessionNode` definitions and the cross-component `sendMessage` helper (shared in `webview/messages.ts`); native-addon ABI scan logic consolidated.
- `pnpm-workspace.yaml`: removed invalid `allowBuilds`/`minimumReleaseAgeExclude` keys; `.vscodeignore` no longer ships nested `.env`/secret files and keeps shared `.vscode` config; removed redundant tsconfig globs/excludes; removed dead `wrapperEl` in `HelpTooltip`.

## [2.6.0] - 2026-09-18

### Added

- **Generate Commit Message** (`pi-agent.generateCommitMessage`, also a sparkle button in the Source Control title bar of a git repo): drafts a commit message for the currently staged changes with a PI model and places it in the VS Code commit box.
- **`pi-agent.git.commitMessageModel`** setting (Settings → Git in the VS Code Settings UI, or the "Commit Messages" section of the PiLot Settings tab) to pin the model used for commit-message drafting. Leave it empty to use the standard PI model.
- **Disable packages and skills** Added support for disabling and re-enabling individual packages and skills.

## [2.5.0] - 2026-09-13

### Added

- **System prompt file editing from the GUI** (Settings → Configuration Files): "Open SYSTEM.md" and "Open APPEND_SYSTEM.md" buttons create the file in PI's agent directory (default `~/.pi/agent`, configurable via `pi-agent.agentDir`) if missing and open it in a VS Code editor tab. SYSTEM.md replaces PI's default system prompt for new sessions (with a confirmation before first creation); APPEND_SYSTEM.md appends to it. A warning is shown in Settings when `pi-agent.systemPrompt` / `pi-agent.appendSystemPrompts` override these files.
- **PI Light Mode** toggle (Settings → Agent Behavior, or the `pi-agent.lightMode` setting) for running pi in a reduced mode ideal for local LLMs via llama.cpp — equivalent to `pi --no-skills --no-extensions --no-context-files --no-prompt-templates --no-themes --tools read,bash,edit,write`. Overrides the individual discovery toggles and restricts tools to `read`, `bash`, `edit`, `write` when the tool preset is `default`; toggling restarts the current session with its history preserved. Toggle Light Mode command (`pi-agent.toggleLightMode`) in the command palette, plus a `PI Light` status-bar indicator while active. Light Mode is reflected across the UI: a `Light` header badge, banners in the Skills and Packages panels, and Auto Context is forced off (toggle disabled) while active — the user's preference is restored when Light Mode is switched off.

### Changed

- Improved testing suite for development

### Fixed

- Standalone .ts files in the PI extension folder were not detected as installed extensions
- GitHub reported 7 Dependabot vulnerabilities on main (6 high, 1 moderate)
- Search the current session chat (ctrl+F) was not working properly
- Auto naming of new sessions did not work reliably
- Multiple minor issues

## [2.4.1] - 2026-09-08

### Fixed

- PI installed via MISE and other non-standard methods was not properly detected.

## [2.4.0] - 2026-08-21

### Added

- Support for adding custom OpenAI-compatible providers via the GUI.
- OAuth provider login support.
- Mermaid diagram support.

### Changed

- The thinking level setting now actually considers the available thinking levels for the selected model.
- Several minor adjustments to keep pace with the past 30 days of PI CLI changes.
- Migrated PiLot to the SDK 0.84.x API surface.

### Fixed

- Fixed a bug where deleting a provider from the GUI did not actually remove the provider from PI.
- Fixed favorite models not persisting between app restarts.
- Fixed issues with running the test suite for development.
- Fixed several dependabot security vulnerabilities.
- Fixed 3 minor code quality issues found by Fallow.

## [2.3.1] - 2026-07-19

### Changed

- Migrated PiLot to the SDK 0.80.x API surface. Replaces the legacy `AuthStorage.create()` + `ModelRegistry.create(authStorage)` boot path (removed upstream) with `ModelRuntime.create()` + `new ModelRegistry(runtime)`. `auth.json` writes now go through `ModelRuntime.setRuntimeApiKey` / `removeRuntimeApiKey`, and disk re-reads use `ModelRuntime.refresh()`. Bumps dev-dep pin to `^0.80.0`.

### Fixed

- Restored extension startup. The previously bundled extension was failing to initialize against the upgraded global PI SDK with `TypeError: Cannot read properties of undefined (reading 'create')`.

## [2.3.0] - 2026-07-10

### Added

- Support for the new max thinking level in Pi 0.80.6.
- Support for slash commands for invoking PI CLI built-in commands and available skills.
- Add a button in the **Settings** tab to open the global Pi settings file (`settings.json`), a button in the **Models** tab to open `models.json`, and a button in the **Providers** tab to open `auth.json` for manual editing. This is needed because some providers, such as Cloudflare, require additional manual configuration beyond entering an API key in the GUI.

### Changed

- Improved session auto naming
- Improved test coverage
- Revised TODO.md

### Fixed

- List of available models did not automatically update after the initial provider configuration.
- The current session name was not displayed in the 'Rename Session' dialog.
- Some provider error messages was not exposed to the user.

## [2.2.1] - 2026-07-04

### Changed

- Improved landing page design
- Improved file picker @ search function

### Fixed

- Fixed some files not available in file picker. Increaced limit on files available in file picker from 2000 to 10000
- Package @catdaemon/pi-code-intelligence sqllite3 node compability with VsCode
- Removed redundant extra versions of the landing page.

## [2.2.0] - 2026-07-03

### Added

- "Apply to Editor" button on code blocks — inserts or replaces selection in active editor
- "Preview Diff" button on code blocks — opens VS Code diff editor with proposed changes
- "Open in Editor" button for code blocks
- Code block copy button with clipboard feedback
- Message-level copy button for assistant responses
- Add support for forking sessions from existing ones
- Chat search (Ctrl+F) to highlight matching text in messages
- Markdown table rendering
- Timestamp toggle (relative ↔ absolute)
- Markdown header anchors for linking
- Expanded empty state quick actions (Debug Issue, Write Tests)

### Changed

- Message actions (copy, timestamp toggle, fork) appear on hover
- Refactor to minimize code bloat.
- Significantly improved test coverage

### Fixed

- Added missing ordered list rendering support
- Fixed duplicate CSS for message actions
- Fixed missing default skill paths

## [2.1.0] - 2026-06-23

### Added

- Add dedicated Skills tab in the PiLot Studio sidebar for viewing PI CLI skills and defining skill directories
- Add scroll to bottom button in the chat window for quick access

### Changed

- Refactored PiAgentProvider (2719 → 1779 lines) by extracting 6 modules: BinaryService, FooterManager, ExtensionUIContext, ModelRegistryHandler, PackageManager, SessionListManager
- Created `binary-service.ts` consolidating binary resolution, PATH management, and git branch detection
- Created `footer-manager.ts` for git branch polling and footer data synchronization
- Created `extension-ui-context.ts` for extension UI binding, status polling, and loading error forwarding
- Created `model-registry-handler.ts` for model registry merging, favorites sync, and CLI model caching
- Created `package-manager.ts` for package CLI operations, enrichment, and CRUD
- Created `session-manager.ts` for session list caching, auto-naming, and deletion

### Fixed

- Fixed BinaryService using console.log/console.error instead of proper logging infrastructure; now accepts logDebug/logError callbacks like all other services
- Fixed non-functional types filter for available packages
- Fixed missing ARIA listbox pattern implementation
- Clean up child processes on session shutdown
- Fixed truncated skill tooltip in context section.
- Added missing `getSettings` and `setToolConfig` message handlers in MessageHandler
- Added missing `getSettings()` and `setToolConfig()` methods to PiAgentProvider for VS Code configuration integration
- Fixed forkSession message to pass `fromNodeId` instead of `sessionId` parameter
- Fixed ToolsPanel to receive and sync `toolPreset` prop from App.svelte state
- Fixed ToolsPanel to send correct data format (`toolPreset`, `customTools`) in setToolConfig messages
- Removed redundant activation events from package.json

## [2.0.2] - 2026-06-11

### Fixed

- Fixed edge issues with manually set PI binary resolution on Windows. findGlobalPiInstallation() now checks setting first → PATH → hardcoded paths
- Fixed extractNodeModulesPath() to handle Windows \ path separators

## [2.0.1] - 2026-06-11

### Added

- New tooltip for the top left icon showing the current version of the extension and PI binary
- More detailed information about installed PI packages

### Changed

- "Show more (x older messages)" option moved from the bottom of the chat window to the top of the GUI for easier access
- Cleaned up Settings & Help tab

### Fixed

- Fixed an edge case where the app uses the wrong PI binary path
- Removed hardcoded Home Directory fallback path in Native Addons
- Removed duplicate package/extension display in the GUI context view
- Fixed missing error handling for critical paths in the PI binary resolution logic
- Fixed StatusLine uses non-existent events
- Fixed incorrect keyboard shortcut hints
- Fixed auto context toggle in settings
- Fixed debug logging bypasses Diagnostics setting
- Removed unused CSS selectors
- Multiple minor issues fixed

## [2.0.0] - 2026-06-09

### Added

- Activity Bar component status messages and information
- Toast notifications and improved error messages
- Session select and delete
- Session export feature
- Resizable chat window for an improved user experience
- Onboarding tour for new users, including new tooltips
- Prompt templates feature with editable starter text
- ResourceBadge component with change-indicator animations
- TODO.md file for future development and improvements

### Changed

- Removed the bundled PI binary from the extension package; the extension now relies on the user's local PI binary installation
- Major GUI and design overhaul
- Major codebase refactoring
- Documentation update

### Fixed

- Fixed a major issue preventing PI packages from working in the VS Code extension
- Fixed numerous minor issues

## [1.2.0] - 2026-06-07

### Added

- Full integration of PI CLI resource settings (extensions, skills, prompts, system prompts)

### Changed

- Updated and simplified README.md documentation

### Fixed

- Fixed PI binary resolution with multiple installations, custom paths, and relative workspace paths
- Made CLI commands respect the `pi-agent.binaryPath` setting instead of hardcoding "pi"
- Added executable permission checks and improved binary validation via PATH
- Added proper error messages when the PI binary is not found
- Removed leftover mock data from the capabilities tab
- Minor fixes to the GUI layout and labels

## [1.1.0] - 2026-06-06

### Added

- Added version check for PI and PI packages in the GUI showing available updates

### Fixed

- Fixed mismatch between PI CLI scoped models and the extension favorite models causing warnings
- Fixed icon display issues

## [1.0.1] - 2026-06-05

### Fixed

- Corrected GitHub URL

## [1.0.0] - 2026-06-05

### Added

- Initial release
