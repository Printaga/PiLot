# Plan: Fix PI Binary Path Resolution on Windows

## Problem Statement
Users on Windows report that despite specifying a path to `pi.exe` in `pi-agent.binaryPath` settings, the extension doesn't recognize it and prompts them to install PI from npm.

## Root Causes Identified

### Issue 1: Windows `.exe` Extension Not Handled
**Location:** `src/pi-binary.ts:24-62` (`resolvePiBinaryFromSetting`)

When a user specifies a path like `C:\tools\pi` on Windows, the code doesn't automatically check for `.exe` extension. On Windows, executables require the `.exe` extension, but the current code only checks for the exact path provided.

**Fix:** Add Windows-specific `.exe` fallback when checking if a user-provided binary path exists.

### Issue 2: Incomplete Windows Binary Candidate Paths
**Location:** `src/pi-binary.ts:80-86` (`findPiBinary`)

The Windows candidate paths are incomplete:
- Uses `path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi")` but npm/pnpm on Windows creates `pi.cmd` or `pi.exe` in subdirectories like `node_modules` or `bin`
- Missing common Windows npm global paths: `%ProgramFiles%\nodejs\`, `%APPDATA%\npm\`, `%LOCALAPPDATA%\npm\`, etc.
- Doesn't account for npm's `prefix` configuration which may place binaries in non-standard locations

**Fix:** Expand Windows candidate paths to include:
- `LOCALAPPDATA/pnpm` with `.exe` and `.cmd` extensions
- `APPDATA/npm` with `.exe` and `.cmd` extensions  
- `LOCALAPPDATA/npm` with `.exe` and `.cmd` extensions
- Well-known npm script execution wrapper paths

### Issue 3: Empty State Shows Setup Card Unconditionally
**Location:** `src/webview/components/ChatPanel.svelte:598-670`

When `messages.length === 0`, the UI always shows the "Getting Started" setup card with npm install command, even if:
- A valid binary path is configured
- The PI CLI is properly installed and working
- The user simply hasn't sent any messages yet

This is confusing because users with properly installed PI still see "install from npm" prompts.

**Fix:** The empty state should only show setup guidance when the extension signals that PI is not available. Currently there's no distinction between "session has no messages" and "PI binary not found".

### Issue 4: No Status Communication for Binary Availability
The webview receives `piCliVersion` in the ready response but has no way to know if the binary was found vs. just using the fallback "pi" command.

**Fix:** Add a `binaryAvailable` flag in the ready response to let the UI know whether to show setup prompts.

## Implementation Steps

### Step 1: Fix `resolvePiBinaryFromSetting` to handle Windows `.exe` suffix
**File:** `src/pi-binary.ts`

Add logic to try appending `.exe` and `.cmd` on Windows when the exact path doesn't exist:
```typescript
if (path.isAbsolute(trimmed)) {
    // ... existing check ...
    if (process.platform === "win32") {
        // Try with .exe extension
        try {
            fs.accessSync(trimmed + ".exe", fs.constants.F_OK);
            return trimmed + ".exe";
        } catch {}
        // Try with .cmd extension  
        try {
            fs.accessSync(trimmed + ".cmd", fs.constants.F_OK);
            return trimmed + ".cmd";
        } catch {}
    }
}
```

### Step 2: Expand Windows candidate paths in `findPiBinary`
**File:** `src/pi-binary.ts`

Add more Windows-specific paths including `.exe` and `.cmd` variants:
- `%APPDATA%\npm\pi.exe`, `%APPDATA%\npm\pi.cmd`
- `%LOCALAPPDATA%\npm\pi.exe`, `%LOCALAPPDATA%\npm\pi.cmd`
- `%LOCALAPPDATA%\pnpm\pi.exe`, `%LOCALAPPDATA%\pnpm\pi.cmd`
- Check npm's actual global prefix via environment or config

### Step 3: Add binary availability status to webview
**File:** `src/pi-agent-provider.ts`

Add a method to check if the binary was successfully resolved, and include this in the ready response:
- Add `isBinaryAvailable` property/method
- Include it in `handleReady()` response data

### Step 4: Update ChatPanel to conditionally show setup card
**File:** `src/webview/components/ChatPanel.svelte`

Only show the "Getting Started" setup card when:
- `messages.length === 0` AND
- `piCliVersion` is null/undefined AND  
- No valid binary path was configured

Add prop/interface to receive binary availability status.

### Step 5: Add tests for Windows path resolution
**File:** `src/test/suite/unit/pi-binary.test.ts` (create if needed)

Add unit tests covering:
- User-specified path without `.exe` on Windows
- User-specified path with `.exe` on Windows
- Well-known Windows npm paths
- npm install via curl paths (Windows-compatible)

## Verification
1. `pnpm run build` - Ensure all changes compile
2. `pnpm run lint` - Check code style
3. Manual testing on Windows required for full validation (cannot test cross-platform without Windows environment)