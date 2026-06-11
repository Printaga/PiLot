# Codebase Review Findings

## Critical Issues (High Priority)

### 1. Debug Logging Bypasses Diagnostics Setting
**Location:** `src/pi-agent-provider.ts:957-971, 2040, 2135-2139, 2145, 2186-2187, 2205-2212`
**Severity:** Medium
**Issue:** Uses `console.log()` directly for DIAGNOSTIC output instead of `this.logDebug()` which respects the `diagnostics.enabled` setting. This exposes internal paths, extension details, and statuses to users during normal operation.
**Fix:** Replace `console.log` with `this.logDebug()` calls to respect user privacy settings.

## High Priority Issues

### 2. Hardcoded Home Directory in Native Addons
**Location:** `src/utils/native-addons.ts:30`
**Severity:** High - Portability issue
**Issue:** Falls back to `"/home/lenovo"` as a hardcoded path when `HOME` environment variable is not set.
```typescript
const home = process.env.HOME || "/home/lenovo"; // Should use os.homedir()
```
**Fix:** Use `os.homedir()` or `process.env.USERPROFILE` fallback instead.

### 3. Missing Error Handling for Critical Paths
**Location:** `src/pi-agent-provider.ts:186-194` (resolvePiBinaryAtStartup)
**Severity:** High - Extension may fail silently
**Issue:** When pi binary resolution fails, the error is logged but no user-facing notification is shown.

## Medium Priority Issues

### 4. Session Tree Navigation Logic is Fragile
**Location:** `src/webview/components/SessionTree.svelte:83-106`
**Severity:** Medium - UI bug
**Issue:** The tree building logic attempts to infer parent-child relationships from label prefixes and timestamps, but this heuristic is unreliable and could produce incorrect tree structures. The tree doesn't use actual parent-child data from PI.

### 5. StatusLine Uses Non-existent Events
**Location:** `src/webview/components/StatusLine.svelte:49-50`
**Severity:** Medium - Broken feature
**Issue:** The component listens for `stream_start` and `stream_end` events which are never sent from the extension host. The streaming indicator won't work. Should use `agent_start` and `agent_end` instead.

### 6. Message Editing Session ID Issue
**Location:** `src/webview/App.svelte:545`
**Severity:** Medium - Feature defect
**Issue:** In `handleReady()`, the `sessionId` is always set to `undefined`, even when available in `data.sessionId`. This prevents proper session tracking on initial load.

## Low Priority Issues

### 7. Hardcoded Version in Settings Panel
**Location:** `src/webview/components/SettingsPanel.svelte:161`
**Severity:** Low - User confusion
**Issue:** Hardcoded version "v1.2.0" instead of using the actual `appVersion` state value passed as prop.

### 8. Missing Type Safety in Message Serialization
**Location:** `src/message-serializer.ts:17-75`
**Severity:** Low - Type safety
**Issue:** Uses `any` types extensively for message handling. Could benefit from proper typing.

### 9. Deprecated Code Still Present (Dead Code)
**Location:** `src/sessions-tree.ts` and `src/pi-agent-provider.ts:89-96`
**Severity:** Low - Dead code
**Issue:** `SessionsTreeProvider` and related `SessionNode` interface exist but are never used - the package.json only defines `piAgentChat` as a webview view, not a tree view.

### 10. Incorrect Issue (Resolved)
**Note:** Issue about duplicate packages in `getConfiguredPackages()` was incorrect - the method correctly uses a `Map<source, pkg>` for deduplication.

## Recommendations

1. **Immediate:** Replace `console.log` diagnostic statements with `logDebug` calls that respect the diagnostics setting
2. **Soon:** Use `os.homedir()` instead of hardcoded path in native-addons.ts (line 30)
3. **Soon:** Fix StatusLine.svelte to use `agent_start`/`agent_end` instead of `stream_start`/`stream_end`
4. **Soon:** Fix handleReady to properly set sessionId from ready data
5. **Later:** Add proper type definitions for message serialization
6. **Later:** Remove `SessionsTreeProvider` and related deprecated interfaces if unused

## Summary

| Priority | Issue | File(s) | Effort |
|----------|-------|---------|--------|
| Medium | Debug logging bypasses setting | `pi-agent-provider.ts` | Low |
| High | Hardcoded home directory | `native-addons.ts:30` | Low |
| Medium | Missing binary error notification | `pi-agent-provider.ts` | Low |
| Medium | StatusLine event mismatch | `StatusLine.svelte` | Low |
| Medium | Session tree heuristic logic | `SessionTree.svelte` | Medium |
| Low | Hardcoded version in settings | `SettingsPanel.svelte` | Very Low |
| Low | Dead code (SessionsTreeProvider) | `sessions-tree.ts` | Low |

## Verified Not Issues

- CSS variables are properly defined in `global.css`
- ESLint passes with no errors