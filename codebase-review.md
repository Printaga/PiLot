# Codebase Review Findings

## High Priority Issues

### 2. Hardcoded Home Directory in Native Addons

**Location:** `src/utils/native-addons.ts:30`
**Severity:** High - Portability issue
**Issue:** Falls back to `"/home/lenovo"` as a hardcoded path when `HOME` environment variable is not set. This won't work on Windows or other systems.

```typescript
const home = process.env.HOME || "/home/lenovo"; // Should use os.homedir()
```

**Fix:** Use `require('os').homedir()` or `process.env.USERPROFILE` fallback instead.

### 3. Missing Error Handling for Critical Paths

**Location:** `src/pi-agent-provider.ts:186-194` (resolvePiBinaryAtStartup)
**Severity:** High - Extension may fail silently
**Issue:** When pi binary resolution fails, the error is logged but no user-facing notification is shown. Users may be confused why the extension doesn't work.

## Medium Priority Issues

### 4. Duplicate Package Display Prevention Incomplete

**Location:** `src/pi-agent-provider.ts:78-79, 1755-1764`
**Severity:** Medium - UI inconsistency
**Issue:** The `getConfiguredPackages()` method returns duplicates if the same package is listed in both user and project settings. While there's a `Set` for deduplication by source, the fallback path doesn't check for duplicates properly.

### 5. Session Tree Navigation Logic is Fragile

**Location:** `src/webview/components/SessionTree.svelte:83-106`
**Severity:** Medium - UI bug
**Issue:** The tree building logic attempts to infer parent-child relationships from label prefixes and timestamps, but this heuristic is unreliable and could produce incorrect tree structures. The tree doesn't use actual parent-child data from PI.

### 6. StatusLine Uses Non-existent Events

**Location:** `src/webview/components/StatusLine.svelte:49-50`
**Severity:** Medium - Broken feature
**Issue:** The component listens for `stream_start` and `stream_end` events which are never sent from the extension host. The streaming indicator won't work. Should use `agent_start` and `agent_end` instead.

### 7. Message Editing Session ID Issue

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

## Recommendations

1. **Immediate:** Replace `console.log` diagnostic statements with `logDebug` calls that respect the diagnostics setting
2. **Soon:** Use `os.homedir()` instead of hardcoded path in native-addons.ts (line 30)
3. **Soon:** Fix StatusLine.svelte to use `agent_start`/`agent_end` instead of `stream_start`/`stream_end`
4. **Soon:** Fix handleReady to properly set sessionId from ready data
5. **Later:** Add proper type definitions for message serialization
6. **Later:** Remove `SessionsTreeProvider` and related deprecated interfaces if unused

## Summary

| Priority | Issue                             | File(s)                | Effort   |
| -------- | --------------------------------- | ---------------------- | -------- |
| Medium   | Debug logging bypasses setting    | `pi-agent-provider.ts` | Low      |
| High     | Hardcoded home directory          | `native-addons.ts:30`  | Low      |
| Medium   | Missing binary error notification | `pi-agent-provider.ts` | Low      |
| Medium   | StatusLine event mismatch         | `StatusLine.svelte`    | Low      |
| Medium   | Session tree heuristic logic      | `SessionTree.svelte`   | Medium   |
| Low      | Hardcoded version in settings     | `SettingsPanel.svelte` | Very Low |
| Low      | Dead code (SessionsTreeProvider)  | `sessions-tree.ts`     | Low      |

## Verified Not Issues

- CSS variables are properly defined in `global.css`
- ESLint passes with no errors
