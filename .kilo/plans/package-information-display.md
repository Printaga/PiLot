# Plan: Display Package Information in VS Code Extension

## Problem Analysis

The PI terminal displays detailed package information in its footer and chat window, showing what each installed package provides (extensions, skills, prompts, themes) along with descriptions. The VS Code extension currently only shows:
- Package source (e.g., `npm:my-package`)
- Installation path
- Count of installed packages

This minimal information doesn't help users understand what each package actually does.

## Current Implementation

### Backend (`src/pi-agent-provider.ts`)
- `sendSessionResources()` sends package info with only `{ source, path }` fields
- Uses `listPackages()` which combines CLI `pi list` output with `DefaultPackageManager.listConfiguredPackages()`

### UI Components
- `ChatPanel.svelte`: Shows `packagesTitle` with just source names (line ~290-294)
- `PiPackagesPanel.svelte`: Installed packages show only source and path
- `ResourceBadge.svelte`: Shows count only

## Proposed Changes

### 1. Extend Package Data Structure (Backend)
**File: `src/pi-binary.ts`**
- Enhance `InstalledPackage` type to include:
  - `version?: string` - npm/git package version
  - `description?: string` - package description from manifest
  - `extensions?: string[]` - list of extensions provided
  - `skills?: string[]` - list of skills provided
  - `prompts?: string[]` - list of prompts provided
  - `themes?: string[]` - list of themes provided

### 2. Fetch Package Metadata (Backend)
**File: `src/session-resources.ts`**
- Use `DefaultPackageManager.resolve()` to get detailed resource information
- Read package `package.json` for version/description when available
- Merge with existing `getConfiguredPackages()` output

### 3. Update Session Resources Message (Backend)
**File: `src/pi-agent-provider.ts`**
- Extend `sendSessionResources()` payload to include full package metadata
- Move beyond simple `{ source, path }` to the enriched structure

### 4. Enhance ResourceBadge Component
**File: `src/webview/components/ResourceBadge.svelte`**
- Add tooltip showing package resource breakdown
- Example: "my-package: 2 extensions, 1 skill, 3 prompts"

### 5. Improve ChatPanel Resources Display
**File: `src/webview/components/ChatPanel.svelte`**
- Update `packagesTitle` to show resource breakdown per package
- Format: `"1. my-package (2 ext, 1 skill, 3 prompts)"

### 6. Update PiPackagesPanel Detail View
**File: `src/webview/components/PiPackagesPanel.svelte`**
- Show resource badges for each installed package
- Display version and description when available
- Add loading of package metadata on mount

## Technical Considerations

1. **Performance**: Package metadata enrichment should be async and cached
2. **Error Handling**: Skip packages that can't be resolved (graceful degradation)
3. **Backward Compatibility**: Existing package data structure must remain compatible

## Implementation Order

1. Extend types and data structures first
2. Update backend to fetch and send enriched data
3. Update UI components to consume and display the new data
4. Test with installed packages to verify correct display