# Codebase Review: Errors, Bugs, and Issues to Fix

## Critical Issues

### 1. ToolCallMessage Interface Mismatch (High Priority)
**Files**: `src/webview/types/index.ts`, `src/webview/App.svelte`, `src/webview/components/MessageBubble.svelte`

The `ToolCallMessage` interface is defined inconsistently across files:
- **`webview/types/index.ts`** uses: `tool`, `expandable`, `expanded`, `status: "running" | "success" | "error"`
- **`App.svelte`** and **`MessageBubble.svelte`** use: `toolCallId`, `toolName`, `args`, `status: "pending" | "streaming" | "complete"`

The extension sends events with `toolCallId`/`toolName` format (see `tool_execution_start`, `tool_execution_update`, `tool_execution_end` handlers in App.svelte lines 545-630), but the shared types file has incompatible definitions. This causes type confusion and potential runtime errors.

**Evidence**: App.svelte:558-561 shows toolCalls created with `toolCallId` and `toolName`, but `webview/types/index.ts:11-18` defines the interface with `tool` property only.

### 2. Missing packages-updated Message Handler (High Priority)
**Files**: `src/webview/components/PiPackagesPanel.svelte:186`, `src/pi-agent-provider.ts:1409-1447`

`PiPackagesPanel.svelte` listens for `packages-updated` message (line 186) to refresh package lists after install/remove/update:
```ts
if (type === "packages-updated") {
  refreshInstalled();
  setTimeout(() => {
    fetchMarketplacePackages();
  }, 1000);
}
```

However, the extension's `runPackageCommand` method (pi-agent-provider.ts:1409-1447) only sends:
- `loading` (start/end)
- `output` (streaming output)
- No `packages-updated` message on success

After `installPackage`, `uninstallPackage`, or `updatePackages` complete successfully, the webview never refreshes its package lists, leaving stale data displayed.

## Medium Priority Issues

### 3. Unused Store Modules
**Files**: `src/webview/stores/session-store.svelte.ts`, `src/webview/stores/ui-store.svelte.ts`

Both Svelte 5 $state rune modules exist but are never imported anywhere in the codebase. They define:
- `getMessages`, `setMessages`, `addMessage`, etc. (session-store)
- `getActiveTab`, `setActiveTab`, `getIsListening`, etc. (ui-store)

The webview uses local `$state` declarations in `App.svelte` instead of these store modules. These are dead code that should either be integrated or deleted.

### 4. execFileAsync Error Code Handling
**File**: `src/utils/shell.ts:43-58`

When a command fails without an error code property (e.g., spawn failure), `execFileAsync` defaults to code 0 instead of indicating failure:
```ts
code: error && "code" in error && typeof error.code === "number" ? error.code : 0
```

This masks errors. Should return 1 (generic error) when the error doesn't have a code property.

## Low Priority Issues

### 5. Unused toast API fallback (empty else branch)
**File**: `src/webview/components/PiPackagesPanel.svelte:202-203`

```ts
if (vscode?.postMessage) {
  vscode.postMessage({ type: "listPackages" });
} else {
  // Empty - no fallback
}
```

The empty else branch serves no purpose and could be simplified.

## Verification Status

- TypeScript compilation: ✅ Clean (`pnpm run compile` exits 0)
- ESLint: ✅ Clean (`pnpm run lint`)
- Tests: ✅ Pass (`pnpm test` exits 0)
- No runtime errors detected in static analysis

## Recommended Actions

1. **Align ToolCallMessage interface**: Update `webview/types/index.ts` to use `toolCallId`, `toolName`, `args`, `result`, `isError`, `status: "pending" | "streaming" | "complete"` to match actual usage
2. **Add packages-updated message**: Dispatch `{ type: "packages-updated" }` in `runPackageCommand` after successful completion (line 1436)
3. **Remove or integrate stores**: Delete the unused store modules since they're not integrated
4. **Fix execFileAsync**: Return code 1 for generic errors instead of 0