# Codebase Review Findings

## Medium Priority Issues

### 1. Duplicate Package Display Prevention Incomplete

**Location:** `src/pi-agent-provider.ts:78-79, 1755-1764`
**Severity:** Medium - UI inconsistency
**Issue:** The `getConfiguredPackages()` method returns duplicates if the same package is listed in both user and project settings. While there's a `Set` for deduplication by source, the fallback path doesn't check for duplicates properly.

### 2. Session Tree Navigation Logic is Fragile

**Location:** `src/webview/components/SessionTree.svelte:83-106`
**Severity:** Medium - UI bug
**Issue:** The tree building logic attempts to infer parent-child relationships from label prefixes and timestamps, but this heuristic is unreliable and could produce incorrect tree structures. The tree doesn't use actual parent-child data from PI.

### 3. StatusLine Uses Non-existent Events

**Location:** `src/webview/components/StatusLine.svelte:49-50`
**Severity:** Medium - Broken feature
**Issue:** The component listens for `stream_start` and `stream_end` events which are never sent from the extension host. The streaming indicator won't work. Should use `agent_start` and `agent_end` instead.

### 4. Message Editing Session ID Issue

**Location:** `src/webview/App.svelte:545`
**Severity:** Medium - Feature defect
**Issue:** In `handleReady()`, the `sessionId` is always set to `undefined`, even when available in `data.sessionId`. This prevents proper session tracking on initial load.

## Low Priority Issues

### 8. Unused/Duplicate CSS Variables Claim

**Location:** Identified as potential issue
**Severity:** Resolved - Not an issue
**Note:** CSS variables `--font-display`, `--accent-glow`, `--surface-tint`, `--color-success`, `--color-warning`, `--color-error` ARE properly defined in `src/webview/styles/global.css`.

### 9. Hardcoded Version in Settings Panel

**Location:** `src/webview/components/SettingsPanel.svelte:161`
**Severity:** Low - User confusion
**Issue:** Hardcoded version "v1.2.0" instead of using the actual `appVersion` state value passed as prop.

### 10. Missing Type Safety in Message Serialization

**Location:** `src/message-serializer.ts:17-75`
**Severity:** Low - Type safety
**Issue:** Uses `any` types extensively for message handling. Could benefit from proper typing.

### 11. Deprecated Code Still Present (Dead Code)

**Location:** `src/sessions-tree.ts` and `src/pi-agent-provider.ts:89-96`
**Severity:** Low - Dead code
**Issue:** `SessionsTreeProvider` and related `SessionNode` interface exist but are never used - the package.json only defines `piAgentChat` as a webview view, not a tree view. This is dead code that can be removed.

### 12. Race Condition in Voice Helper Spawning

**Location:** `src/voice-manager.ts:361-368`
**Severity:** Low - Edge case
**Issue:** Voice helper is spawned and immediately writes to stdin via `handleVoiceHelperOutput`, but there's no guarantee the process is ready to receive input before the first message arrives.
