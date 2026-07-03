# Test Coverage Plan — PiLot Studio

## Current Coverage Gaps Analysis

| File | Existing Tests | Gap Severity |
|------|---------------|--------------|
| `src/extension-ui-context.ts` | None | **Critical** |
| `src/utils/native-addons.ts` | None | **Critical** |
| `src/extension.ts` | None (only `validateThinkingLevel` via `extension.test.ts`) | **High** |
| `src/session-resources.ts` | Utility functions only (`isBinaryExtension`, `areImagesValid`) | **High** |
| `src/message-handler.ts` | Most message types covered | Medium |
| `src/pi-agent-provider.ts` | Core paths covered | Medium |
| `src/commands/index.ts` | `logDiagnostics` + `registerCommands` smoke only | Medium |
| `src/webview/types/index.ts` | None | Low |

## Ordered Test Plan

### 1. `src/extension-ui-context.ts` — ExtensionUIContext (Critical, no tests)
**Why first:** This class bridges PI SDK extensions to the VS Code webview. It manages status polling, error forwarding, and UI context creation. Bugs here silently break extension activity visibility.

Tests to add:
- `bindExtensionUI()` with no session (early return)
- `bindExtensionUI()` with session but no extension runner (early return)
- `bindExtensionUI()` full success path: sets UI context, emits `session_start`, calls `extendResourcesFromExtensions`, sends `extension-statuses-full`
- `createUIContext()` returns object with all required methods (`setStatus`, `notify`, `setWorkingMessage`, `custom`, etc.)
- `setStatus` adds/updates/removes entries in `extensionStatuses` map and notifies webview
- `setWorkingMessage` sends `activity-start` / `activity-end`
- `notify` sends `extension-notify`
- `startStatusPoller()` / `stopStatusPoller()` interval management
- `pollExtensionStatuses()` sends `extension-statuses-full` when runner has UI
- `forwardExtensionLoadingErrors()` maps loader errors to status entries
- `dispose()` stops poller
- `custom()` factory calls `done()` and handles async components

### 2. `src/utils/native-addons.ts` — Native Addon Compatibility (Critical, no tests)
**Why second:** ABI mismatches break code intelligence. This module must correctly detect and rebuild `better-sqlite3`.

Tests to add:
- `checkBetterSqlite3()` returns `ok: true` when ABI matches
- `checkBetterSqlite3()` returns `ok: false` with correct `moduleABI` / `runtimeABI` when mismatched
- `checkBetterSqlite3()` returns `ok: false, moduleABI: null` when no compiled module found
- `checkBetterSqlite3()` with custom `paths` argument
- `rebuildBetterSqlite3()` returns `{ success: true }` on successful `node-gyp rebuild`
- `rebuildBetterSqlite3()` returns `{ success: false }` when target dir missing
- `rebuildBetterSqlite3()` returns `{ success: false }` on `execSync` exception
- `rebuildBetterSqlite3()` includes `--target` and `--dist-url` when Electron detected
- `ensureBetterSqlite3Compatible()` returns `{ ok: true, rebuilt: false }` when already compatible
- `ensureBetterSqlite3Compatible()` returns `{ ok: true, rebuilt: true }` after successful rebuild
- `ensureBetterSqlite3Compatible()` returns `{ ok: false }` when rebuild fails
- `describeABIStatus()` formats known ABI versions (108, 115, 127, 137, 140, 142)
- `describeABIStatus()` handles `moduleABI === null`
- `findBetterSqlite3Paths()` discovers PI agent npm path
- `findBetterSqlite3Paths()` discovers nested `pi-code-intelligence` path

### 3. `src/extension.ts` — Extension Activation & Commands (High, no direct tests)
**Why third:** This is the extension entry point. Bugs here prevent the extension from loading or reacting to config changes.

Tests to add:
- `activate()` creates `PiAgentProvider`, registers webview view provider, registers commands, starts update checker
- `activate()` registers `pi-agent.openPanel` command with `switchSession` / `newSession` logic
- `activate()` registers `pi-agent.newSession` command
- `activate()` `onDidChangeConfiguration` handler:
  - Updates provider config on any `pi-agent` change
  - Calls `reloadSessionResources()` only for discovery/resource-related keys
- `tryRegisterViewContainerOptionsProvider()` registers when API exists
- `tryRegisterViewContainerOptionsProvider()` falls back silently when API missing
- `tryRegisterViewContainerOptionsProvider().setTitle()` updates state
- PI version resolution in the IIFE: success path sets title with version, failure path falls back to extension version only
- `deactivate()` is a no-op

### 4. `src/session-resources.ts` — SessionResources Class (High, class untested)
**Why fourth:** Handles `@file` mention resolution, project context, and configured package discovery. Untested class methods can silently break prompt context.

Tests to add:
- `getWorkspacePath()` returns first workspace folder or `cwd`
- `getConfiguredPackages()` returns empty when no settings files exist
- `getConfiguredPackages()` reads user + project settings files
- `getConfiguredPackages()` enriches with install paths via `DefaultPackageManager`
- `getConfiguredPackages()` handles `DefaultPackageManager` failure gracefully
- `setSettingsManager()` updates the manager reference
- `resolveFileMentions()` returns text unchanged when no `@` mentions
- `resolveFileMentions()` resolves existing text files, skips binary files
- `resolveFileMentions()` truncates files > 50KB
- `resolveFileMentions()` removes mentions from resolved text
- `resolveFileMentions()` handles read errors gracefully
- `getProjectContext()` returns project root/name/version from `package.json`
- `getProjectContext()` falls back to root-only string on parse error
- `getProjectContext()` returns empty string when no workspace folders

### 5. `src/message-handler.ts` — Missing Message Types (Medium)
**Why fifth:** Core webview↔extension bridge. Most types covered, but several user-facing flows are untested.

Tests to add:
- `getSessionInfo()` returns full resource info when session/resource loader exist
- `getSessionInfo()` returns `null` when no session
- `getSessionInfo()` handles resource loader errors gracefully
- `getProjectContext()` returns project info or null
- `getWorkspaceFiles()` returns sorted, deduplicated files with exclusion filter
- `getWorkspaceFiles()` handles no workspace folders
- `openFileAttachmentDialog()` returns selected file paths
- `openFileAttachmentDialog()` returns empty array when dialog cancelled
- `apply-code` replaces selection / inserts at cursor / handles no editor
- `preview-diff` creates temp file, opens diff, cleans up
- `preview-diff` handles no editor / no code
- `ready` response includes `sessionId` from provider session
- `default` unknown type returns error and logs debug

### 6. `src/pi-agent-provider.ts` — Additional Provider Methods (Medium)
**Why sixth:** Core provider has good coverage but several public and private methods are untested.

Tests to add:
- `resolveWebviewView()` sets webview options and starts initialization
- `getWebviewContent()` rewrites asset paths, strips CSP, injects media globals
- `buildSessionOptions()` with `toolPreset: "review"` sets correct tools array
- `buildSessionOptions()` with `toolPreset: "custom"` and empty `customTools` leaves `tools` undefined
- `buildSessionOptions()` reads all discovery flags and system prompt settings
- `createSession()` calls `extensionUIContext.bindExtensionUI()` and `startFooterForSession()`
- `sendSessionResources()` full path: collects skills/extensions/prompts/vscodeExtensions/packages
- `switchSession()` with valid session ID: disposes old, creates new, sends history + resources
- `forkSession()` with no `entryId` forks from leaf
- `forkSession()` when `getLeafId()` returns null logs error and returns
- `prompt()` with `autoContext: true` prepends project context
- `prompt()` resolves `@file` mentions before sending
- `prompt()` handles streaming behavior with images
- `steer()` / `followUp()` error paths send webview error and re-throw
- `setModel()` when model not found in registry (early return)
- `editMessage()` when index out of bounds or non-user role (early return)
- `getContextUsage()` includes `autoCompactionEnabled`
- `handleSessionEvent()` `thinking_level_changed` sends context-usage
- `handleSessionEvent()` `auto_retry_start` / `auto_retry_end` activity pills
- `handleSessionEvent()` `agent_end` with `willRetry: true` does NOT re-send history
- `dispose()` with active session emits `session_shutdown` and disposes
- `updateViewTitle()` updates title and description with versions
- `checkNativeAddons()` logs success / ABI mismatch / rebuild failure paths
- `rebuildNativeAddons()` success and failure paths
- `openCurrentSessionInEditor()` creates panel and sends history
- `newChatInEditor()` creates panel with webview content

### 7. `src/commands/index.ts` — Command Behaviors (Medium)
**Why seventh:** Commands are registered but their individual behaviors (especially editor interactions) are mostly untested.

Tests to add:
- `explainCode` with no active editor shows info message
- `explainCode` with empty selection shows info message
- `explainCode` with selection calls `provider.prompt()` with formatted prompt
- `refactorCode` same structure as explainCode
- `analyzeProject` uses workspace folder or passed URI
- `navigateToSession` calls `provider.navigateTree()`
- `focusInput` sends `focus-input` to webview
- `editLastMessage` sends `edit-last-message` to webview
- `addFileToChat` filters non-file URIs, sends `files-attached`
- `listResources` / `manageResources` focus sidebar and send messages
- `installResource` / `removeResource` prompt for input then call provider
- `deleteSessions` with empty array shows info message
- `deleteSessions` confirms and calls `provider.deleteSessions()`
- `exportDiagnosticsLog` writes buffer to selected URI
- `exportDiagnosticsLog` handles no buffer content
- `exportDiagnosticsLog` handles write error

### 8. `src/webview/types/index.ts` — Type Contracts (Low)
**Why last:** Pure type definitions. Only worth testing if they are used in runtime validation.

Tests to add (if any runtime guards exist):
- Verify `ThinkingLevel` union accepts exactly 6 values
- Verify `ImageContent` shape matches `areImagesValid` expectations
- Verify `ToolCallMessage` status union

## Execution Notes

- Do **not** refactor existing code to make it testable; add tests around current implementation.
- Use the existing mock infrastructure in `src/test/mocks/` (`pi-sdk-mocks.ts`, `session-mock.ts`).
- Follow existing test patterns: Mocha + `node:assert`, VS Code mocks via `resetVscodeMocks()`.
- Run `pnpm test` after each batch to verify no regressions.
- Tests requiring VS Code APIs should mock via `globalThis.vscode` or the existing `resetVscodeMocks()` helpers.
