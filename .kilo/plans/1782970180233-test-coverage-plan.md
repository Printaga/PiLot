# Test Coverage Analysis and Implementation Plan

## Executive Summary

The current test suite has **~25% meaningful coverage** of the backend TypeScript codebase. Tests focus on pure utility functions but miss critical integration points, class methods, and error handling paths. Webview Svelte components have no test coverage.

---

## Current Test Coverage Analysis

### Covered Modules (Partial)

| Module | Lines Covered | % Covered | Notes |
|--------|---------------|-----------|-------|
| `validateThinkingLevel` (pi-agent-provider.ts) | 1 function | 100% | Well tested with edge cases |
| `pi-binary.ts` (selected functions) | 3 functions | ~40% | Missing `readPackageManifest`, `readPackageSourcesFromSettingsFile`, `resolvePiBinary` |
| `shell.ts` (utility functions) | 3 functions | ~60% | Missing `execFileAsync` timeout/error cases |
| `session-manager.ts` (pure functions) | 2 functions | ~50% | `generateSessionName` has limited edge case coverage |
| `session-resources.ts` (pure functions) | 2 functions | ~40% | Missing class method tests |
| `message-serializer.ts` | 1 function | ~70% | Missing edge cases for null/undefined content |

### Uncovered / Partially Covered Modules

| Module | Lines | Criticality | Risk |
|--------|-------|-------------|------|
| `PiAgentProvider` class | ~1900 | High | Core session lifecycle, many error paths untested |
| `MessageHandler` class | ~970 | High | All 50+ message types untested |
| `BinaryService` class | ~118 | Medium | Git branch resolution, version caching untested |
| `PackageManager` class | ~223 | High | Package install/uninstall/update flows untested |
| `ModelRegistryHandler` class | ~247 | Medium | Model sync, favorites, CLI model ID fetching untested |
| `FooterManager` class | ~76 | Medium | Git branch polling, status updates untested |
| `ExtensionUIContext` class | ~354 | High | Extension binding, status polling, error forwarding untested |
| `SessionResources` class | ~252 | Medium | File mention resolution, project context untested |
| `VoiceManager` class | ~550 | High | Voice capture lifecycle, model download, error handling untested |
| `UpdateChecker` module | ~497 | Medium | Version comparison, update detection, notification logic untested |
| `commands/index.ts` | ~394 | Medium | All command handlers untested |

---

## Missing Tests by Priority

### Phase 1: High-Risk Core Functionality (Priority: Critical)

**Modules:** `PiAgentProvider`, `MessageHandler`, `ExtensionUIContext`

**Missing Tests:**

1. **PiAgentProvider.createSession()**
   - Error handling when dependencies fail to initialize
   - Session option building with all tool presets
   - Session option building with custom system prompts
   - Error handling during session creation

2. **PiAgentProvider.session lifecycle**
   - `newSession()` - clean initialization and error states
   - `switchSession()` - invalid session ID handling
   - `forkSession()` - tree navigation edge cases
   - `abort()` - error propagation to webview
   - `compact()` - error handling and context refresh
   - `editMessage()` - index validation, type checking, persistence errors

3. **PiAgentProvider.setApiKey/removeAuth()**
   - Unauthorized provider handling
   - Initialization race conditions

4. **PiAgentProvider.prompt/steer/followUp()**
   - Auto-context prepend logic
   - File mention resolution integration
   - Image validation integration
   - Error handling and webview notification

5. **PiAgentProvider.initialize()**
   - Native addon ABI check failures
   - Model registry initialization errors
   - Settings manager late initialization

6. **MessageHandler.handle()**
   - All 50+ message types require individual test cases
   - Error paths for each async operation
   - Response formatting validation
   - Unknown message type handling

7. **ExtensionUIContext.bindExtensionUI()**
   - Runner not found scenario
   - UI context creation and setter methods
   - Session start event emission
   - Extension loading error forwarding

### Phase 2: Package Management (Priority: High)

**Modules:** `PackageManager`, `BinaryService`, `pi-binary.ts`

**Missing Tests:**

1. **PackageManager.enrichPackages()**
   - Matching skills/extensions/prompts to packages
   - Resource loader error handling
   - Manifest read failures

2. **PackageManager.listPackagesFromCli()**
   - Direct exec fallback
   - Shell command fallback
   - Error logging paths

3. **BinaryService.resolveGitBranch()**
   - `.git` directory case (normal repository)
   - `.git` file case (submodule/gitdir)
   - No `.git` found (return null)
   - Detached HEAD state
   - Error handling

4. **BinaryService.getCliVersion()**
   - Cache hit/miss behavior
   - CLI not responding
   - Invalid version output

5. **readPackageManifest()** - all edge cases
6. **readPackageSourcesFromSettingsFile()** - malformed JSON, missing file, empty packages

### Phase 3: Model and Session Management (Priority: Medium)

**Modules:** `ModelRegistryHandler`, `SessionListManager`, `FooterManager`

**Missing Tests:**

1. **ModelRegistryHandler.getMergedModels()**
   - Empty registry case
   - Duplicate model handling

2. **ModelRegistryHandler.cycleModel()**
   - No models available
   - Current model not in list

3. **ModelRegistryHandler.toggleFavorite()**
   - Model not in available list (guard)
   - Already favorite/not favorite cases
   - CLI model sync integration

4. **ModelRegistryHandler.syncFavoritesToSettings/syncFromCliModels()**
   - CLI not available
   - No models matched

5. **SessionListManager.tryAutoSessionName(s)**
   - No session / already named
   - Missing user/assistant message
   - `generateSessionName` various edge cases

6. **FooterManager.start/stop/sendFooterData**
   - Poller lifecycle
   - Home directory path shortening
   - No change detection optimization

### Phase 4: Voice and Dictation (Priority: Medium)

**Module:** `VoiceManager`

**Missing Tests:**

1. **Voice model selection and path resolution**
2. **Model download logic**
   - Cached model validation (size mismatch)
   - Download failure handling
   - Abort signal handling
3. **Voice helper process management**
   - Various message types (`ready`, `prepared`, `started`, `transcript`, `error`, `level`)
   - Process error events
   - ALSA missing error on Linux
4. **VoiceManager.toggleVoiceCapture()** state transitions
5. **dispose()** cleanup

### Phase 5: Update Checker (Priority: Medium)

**Module:** `update-checker.ts`

**Missing Tests:**

1. **parsePackageVersion()** - all version formats (semver, prerelease, build metadata)
2. **isNewerVersion()** - equivalence, newer, older, prerelease edge cases
3. **fetchLatestPiRelease()**
   - Success/failure/timeout/network errors
   - Invalid JSON
   - Missing version field
4. **checkForPackageUpdates()**
   - No settings manager
   - Package manager errors
5. **showUpdateNotification()** - pi update only, package updates only, both, none
6. **runUpdateCheck()** - auto-update flow, offline mode
7. **performCheckWithDeduplication()**
   - Last check throttling
   - Known updates deduplication
   - Storage state management

### Phase 6: Commands (Priority: Medium-Low)

**Module:** `commands/index.ts`

**Missing Tests:**

1. **All command handlers** - require mocking VS Code API
2. **Configuration change handler** in extension.ts
3. **Diagnostics buffer management**

### Phase 7: Webview Components (Priority: Low-Medium)

**All 16 Svelte components** have no test coverage. Requires:

- Svelte testing library or Playwright for component testing
- Mocking `window.vscode` API
- Testing UI state transitions
- Testing keyboard shortcuts

---

## Untestable or Difficult-to-Test Code

### Requires Refactoring for Testability

| Location | Issue | Recommendation |
|----------|-------|----------------|
| `VoiceManager.getVoiceHelperPath()` | Uses `vscode.extensions.getExtension()` | Inject extension path via constructor parameter |
| `BinaryService.resolveGitBranch()` | Requires real filesystem/git state | Already covered partially via BinaryService abstraction, but functional tests needed |
| `PiAgentProvider.handleSessionEvent()` | 100+ event type branches | Split into strategy pattern or event handler registry |
| `MessageHandler.handle()` | 50+ message type cases in single switch | Split into per-message-type handler methods |
| Webview components using `window.vscode` | Requires VS Code API mock | Create abstraction layer for VS Code messaging |

---

## Required Test Infrastructure

### Mocks & Stubs Needed

1. **VS Code API Mocks**
   ```typescript
   // test/mocks/vscode-mock.ts
   - window.createOutputChannel()
   - window.showInformationMessage()
   - window.showErrorMessage()
   - window.showWarningMessage()
   - workspace.getConfiguration()
   - workspace.workspaceFolders
   - commands.registerCommand()
   ```

2. **AgentSession Mock**
   ```typescript
   // test/mocks/session-mock.ts
   - createAgentSession stub
   - SessionManager stubs
   - AuthStorage stubs
   - ModelRegistry stubs
   - SettingsManager stubs
   - extensionRunner stubs
   ```

3. **BinaryService Mock**
   - CLI version caching
   - Git branch resolution
   - Binary path resolution

4. **fs/promises Mock**
   - For testing file operations without side effects

### Helper Utilities Needed

1. **`createTestPiAgentProvider()`** - Factory for provider with mocked dependencies
2. **`createTestMessageHandler()`** - Factory with mock provider
3. **`assertWebviewMessage()`** - Assert message type and data
4. **`mockVSCodeConfiguration()`** - Setup configuration values
5. **`waitForCondition()`** - Async condition polling for integration tests

---

## Complexity Estimates by Phase

| Phase | Complexity | Estimated Test Count | Notes |
|-------|------------|---------------------|-------|
| Phase 1 | High | 50-80 tests | Core functionality, many async error paths |
| Phase 2 | Medium | 25-40 tests | CLI spawning and file parsing |
| Phase 3 | Medium | 20-30 tests | Registry and cache operations |
| Phase 4 | High | 20-35 tests | Voice model download and process management |
| Phase 5 | Medium | 20-30 tests | Version comparison and HTTP mocking |
| Phase 6 | Medium | 15-25 tests | Command handlers need VS Code API mocking |
| Phase 7 | Medium-High | 30-50 tests | Svelte component testing requires setup |

---

## Recommended Test Framework Additions

### For Extension Host Tests
No changes needed - current Mocha + assert setup is adequate.

### For Webview Component Tests
Add to `devDependencies`:
```json
{
  " vitest": "^3.0.0",
  "@testing-library/svelte": "^5.0.0",
  "happy-dom": "^15.0.0"
}
```

Create `vitest.config.ts` with jsdom environment for Svelte testing.

---

## Validation Steps

1. Run `pnpm run lint` after each test file addition
2. Run `pnpm test` to verify all tests pass
3. Target: 80%+ coverage on pure functions, 70%+ on class methods
4. Edge cases must have tests (error paths, null values, empty states)