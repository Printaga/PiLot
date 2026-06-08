# PiLot Studio Refactoring Plan

## Overview

PiLot Studio is a VS Code extension integrating the PI AI coding agent with a Svelte-based webview UI. This plan addresses code organization, separation of concerns, and maintainability issues.

## Current Architecture Issues

### 1. Massive Provider File (`pi-agent-provider.ts` - 2844 lines)
The `PiAgentProvider` class handles too many responsibilities:
- Session lifecycle management
- Voice capture and audio processing
- Package management via CLI
- Model synchronization with PI CLI
- Webview message handling
- Pi binary resolution
- Context file resolution (@mentions)

### 2. Duplicate Logic Between Extension Host and Webview
- Settings/state management exists in both `App.svelte` (UI state) and `pi-agent-provider.ts` (persistent state)
- Message serialization happens in multiple places
- Session resources gathering code is duplicated in `sendSessionResources()` and `getSessionInfo()` in `message-handler.ts`

### 3. Circular Dependencies
- `message-handler.ts` imports from `pi-agent-provider.ts`
- `pi-agent-provider.ts` creates `MessageHandler` and exposes webview
- Settings manager access is done via `getSettingsManager()` which accesses private state

### 4. Webview Code Organization
- All UI state is in `App.svelte` with a large switch statement in `handleVSCodeMessage()`
- Components have duplicate type definitions (ImageContent, ToolCallMessage, etc.)
- No centralized store for webview state management

## Proposed Refactoring

### Phase 0: Prepare for Extraction

Before moving code, establish shared infrastructure:

1. **`src/webview/types/index.ts`** - Create shared types FIRST (they're needed by later phases):
   - `ImageContent`, `ToolCallMessage`, `Message`, `Model`, `SessionItem`, `SessionNode`
   - `VoiceHelperMessage`, `VoiceModelDef`, `PiAgentConfig`, `ThinkingLevel`
   - Export all interfaces currently in `pi-agent-provider.ts` and `App.svelte`

2. **`src/utils/shell.ts`** - Extract general-purpose shell utilities:
   - `stripAnsi()`, `shellQuote()`, `getShellCommand()`, `execFileAsync()`

3. **`src/protocol/types.ts`** - Define message protocol types:
   - `WebviewMessage`, `ProviderMessage` interfaces
   - Message type constants to avoid magic strings

This establishes a clean import hierarchy before the main extractions.

### Phase 1: Extract Voice Module

**Create `src/voice-manager.ts`** - Full voice lifecycle with orchestration:

```
- Voice model definitions (VOICE_MODELS, VOICE_MODEL_BASE_URL)
- VoiceModelDef interface
- VoiceHelperMessage interface
- VoiceManager class with:
  - Constructor(received: {extensionUri, logChannel})
  - getVoiceModelPath(), downloadVoiceModel()
  - startVoiceCapture(), stopVoiceCapture()
  - handleVoiceHelperOutput()
  - toggleVoiceCapture() - moves orchestration from provider
  - notifyWebview callback for voice events
- PiAgentProvider holds VoiceManager instance, forwards calls
```

Reduction: ~300 lines from provider. The key change: `toggleVoiceCapture` and voice event handling stay together in the module rather than splitting logic.

### Phase 2: Extract Pi Binary Module

**Create `src/pi-binary.ts`** - Pi-specific binary handling only:

```
- resolvePiBinaryFromSetting(), findPiBinary(), resolvePiBinary()
- parseInstalledPackages(), readPackageSourcesFromSettingsFile()
- PiBinary resolution with proper logging interface
- Shell utilities imported from src/utils/shell.ts
```

Reduction: ~100 lines from provider (shell utils already extracted).

### Phase 3: Extract Session Resources Module

**Create `src/session-resources.ts`** - Context gathering service:

```
- SessionResources type and gathering logic
- isBinaryExtension(), resolveFileMentions()
- getProjectContext(), getConfiguredPackages()
- getSessionInfo() - moves from message-handler.ts
- PiAgentProvider holds SessionResources instance
```

Reduction: ~150 lines from provider, ~70 lines from message-handler.

### Phase 4: Resolve Circular Dependencies

Refactor `message-handler.ts` to break the cycle:

1. Create `src/protocol/handler.ts` with:
   - `MessageHandler` receives a `ProviderApi` interface (not full PiAgentProvider)
   - ProviderApi defines only methods handler needs
   - PiAgentProvider implements ProviderApi and wraps MessageHandler

2. Options for ProviderApi:
   - **Option A**: Extract an interface in `pi-agent-provider.ts` and have handler import from there
   - **Option B**: Use event-based communication (emit events, handler listens)
   - **Option C**: Move common utilities to a `src/services/` layer that both can import

This decouples handler from provider implementation details.

### Phase 5: Webview State Management (Staged)

**Create `src/webview/stores/` directory** - Migrate incrementally:

1. **`session-store.ts`** - Session state (`$state` module pattern for Svelte 5):
   ```ts
   // Svelte 5 uses $state within modules, accessed via $ prefix
   let messages = $state<Message[]>([]);
   let currentModel = $state<string | null>(null);
   // ... other session state
   
   export function setMessages(newMessages: Message[]) {
     messages = newMessages;
   }
   export function addMessage(msg: Message) {
     messages = [...messages, msg];
   }
   ```

2. **`model-store.ts`** - Model state:
   - `availableModels`, `favoriteModels`
   - update functions for model selection

3. **`ui-store.ts`** - UI state:
   - `activeTab`, `isListening`, `draftInputText`
   - dropdown modal visibility states

4. **Migration strategy for `App.svelte`**:
   - Phase 5a: Create stores alongside existing `$state` in App.svelte
   - Phase 5b: Replace `$state` declarations one-by-one, updating `$effect` blocks
   - Phase 5c: Remove duplicate type definitions (now import from shared types)
   - Phase 5d: Refactor large `handleVSCodeMessage` switch into message handlers

The store pattern for Svelte 5: use `$state()` in modules, export setters, import with `$` prefix in components.

### Phase 6: Extract Slash Commands Handler

**Create `src/webview/lib/slash-commands.ts`**:

```
- SlashCommand interface and registry
- Command definitions with handlers
- Navigation key handlers
- Type-safe command registry
```

### Phase 7: Extract Message Serialization

**Create `src/message-serializer.ts`**:

- Move shared serialization logic (messages, state) to prevent duplication
- Both extension host and webview use the same format
- Used by `sendSessionResources()`, `getSessionInfo()`, and session history flow

### Phase 8: Test Additions

Add unit tests alongside each extracted module in `src/test/unit/`:

- `voice-manager.test.ts` - Model download, platform resolution
- `pi-binary.test.ts` - Binary path resolution logic
- `session-resources.test.ts` - File mention resolution, context gathering
- `shell.test.ts` - Shell quoting, command building

Run after each phase to catch regressions early.

## File Changes Summary

| File | Action | Lines Change |
|------|--------|--------------|
| `src/pi-agent-provider.ts` | Refactor | -600 lines (original 2844 → ~2244) |
| `src/voice-manager.ts` | Create | +250 lines |
| `src/pi-binary.ts` | Create | +95 lines |
| `src/session-resources.ts` | Create | +125 lines |
| `src/utils/shell.ts` | Create | +55 lines |
| `src/protocol/types.ts` | Create | +35 lines |
| `src/protocol/handler.ts` | Create | +50 lines (decoupled) |
| `src/message-serializer.ts` | Create | +75 lines |
| `src/webview/types/index.ts` | Create | +55 lines |
| `src/webview/stores/session-store.ts` | Create | +60 lines |
| `src/webview/stores/model-store.ts` | Create | +40 lines |
| `src/webview/stores/ui-store.ts` | Create | +50 lines |
| `src/webview/lib/slash-commands.ts` | Create | +75 lines |

**Net change: ~+50 lines across ~10 new files** (code is reorganized, not removed; core logic preserved)

## Risks and Mitigation

1. **Breaking voice functionality** - Test on all platforms after extraction. The voice helper binary paths differ by platform; verify each artifact path.
2. **Changing message formats** - Keep existing message handling compatible. Any format changes require coordinated webview/provider updates.
3. **State synchronization** - Ensure stores properly sync with extension host state. Use a message bridge that maps `ProviderMessage` types to store updates.
4. **Svelte 5 store migration** - Staged migration (create alongside, then replace) avoids breaking the UI. Keep rollback path.
5. **Import cascade** - After moving symbols, update imports in `extension.ts`, `commands/`, and `sessions-tree.ts` via grep/sed script.

## Implementation Order

1. **Phase 0**: Create shared types and shell utilities (foundational, no risk)
2. **Phase 1**: Extract voice module (~300 lines, low risk)
3. **Phase 2**: Extract pi binary module (~100 lines, low risk)
4. **Phase 3**: Extract session resources (~150 lines, medium risk)
5. **Phase 4**: Refactor message handler to break circular dependency (medium risk)
6. **Phases 5-6**: Create webview stores and slash commands (staged, test thoroughly)
7. **Phase 7**: Extract message serializer (low risk)
8. **Phase 8**: Add unit tests after each module extraction
9. **Final**: Run full test suite and verify extension functionality