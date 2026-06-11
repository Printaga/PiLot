# Skill Management GUI - Implementation Plan

## Overview

This plan outlines the implementation of a dedicated Skills tab in the PiLot Studio sidebar for managing PI CLI skills. Skills are specialized agent instructions that provide domain-specific expertise and workflows.

## Current State Analysis

### How PI CLI Handles Skills

#### 1. Skill Discovery Paths (from `DefaultResourceLoader`)

Skills are discovered from multiple locations in order of priority:

1. **Built-in skills** - Packaged with PI CLI itself
2. **User skills directory** - `~/.pi/agent/skills/`
3. **Project skills directory** - `.pi/skills/` within workspace
4. **Package skills** - Skills bundled inside installed npm packages (under `pi.skills` in package.json)
5. **Extra skills paths** - Configured via `pi-agent.extraSkills` VS Code setting

#### 2. Skill File Location

- Skills are stored as `SKILL.md` files in directories
- Each skill directory must contain a `SKILL.md` file with YAML frontmatter:
  ```yaml
  ---
  name: skill-name
  description: "Brief description of skill functionality and when to invoke"
  ---
  ```
- Skills can also be bundled in npm packages with `pi.skills` array in package.json

#### 3. Skill Settings in VS Code Configuration

Currently configured in `package.json` (lines 447-456):

```json
"pi-agent.extraSkills": {
  "type": "array",
  "items": { "type": "string", "format": "uri" },
  "default": [],
  "markdownDescription": "Additional skill paths to pass to pi on startup..."
}

"pi-agent.disableSkillDiscovery": {
  "type": "boolean",
  "default": false,
  "markdownDescription": "Start `pi` with `--no-skills`, which disables skill discovery and loading."
}
```

#### 4. Skill Data Structure (from `ResourceLoader.getSkills()`)

```typescript
// Skill object structure
interface Skill {
  name: string;
  description: string;
  path: string; // Full path to SKILL.md file
  sourceInfo?: {
    source: string; // Package source (npm:, github:, etc.)
    name: string; // Package name
    label: string; // Human-readable label
  };
}
```

### Current GUI Integration

- Skills are **displayed** in `PiPackagesPanel.svelte` (lines 290-297) when viewing installed packages
- Skills are **sent to webview** in `sendSessionResources()` (pi-agent-provider.ts:1094-1098)
- Skills are **received and stored** in App.svelte via `session-resources` message (line 280)
- No dedicated management UI exists - skills can only be installed via package install

### Slash Commands Related to Skills

Skills are invoked via slash commands in the chat:

- `/skillname` - Invokes a specific skill
- `/skills` - Lists available skills (in PI CLI TUI)
- `/help` - Shows all available commands including skills

---

## Proposed Implementation

### Phase 1: Skills Tab Component

Create a new `SkillsPanel.svelte` component following the pattern of `PiPackagesPanel.svelte` and `ToolsPanel.svelte`.

#### 1.1 Component Structure

```svelte
<!-- src/webview/components/SkillsPanel.svelte -->
<script lang="ts">
  // State
  let skills = $state<SkillInfo[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let searchQuery = $state('');

  // Derived
  let filteredSkills = $derived(skills.filter(s => ...));

  // Handlers
  function installSkill(source: string);
  function removeSkill(skillPath: string);
  function refreshSkills();
  function viewSkillDetails(skill: SkillInfo);
</script>
```

#### 1.2 SkillInfo Interface

```typescript
interface SkillInfo {
  name: string;
  description: string;
  sourceName: string | null; // Package name or 'local'
  source: string; // Full source path
  installed: boolean;
  isEnabled: boolean; // Based on discovery settings
  path?: string; // Local path if installed
}
```

### Phase 2: Extension Host Integration

Add new message types in `MessageHandler.handle()` and API in `ProviderApi`:

#### 2.1 New ProviderApi Methods

Add to `src/protocol/types.ts`:

```typescript
// New methods to add to ProviderApi interface
getAllSkills(): Promise<Array<{
  name: string;
  description: string;
  sourceName: string | null;
  path: string;
}>>;
installSkill(source: string): Promise<void>;
removeSkill(name: string): Promise<void>;
enableSkill(name: string, enabled: boolean): Promise<void>;
```

#### 2.2 Message Handler Cases

Add to `src/message-handler.ts`:

```typescript
case "getAllSkills":
  result = await this.provider.getAllSkills();
  this.sendSkillsList(result);
  break;

case "installSkill":
  await this.provider.installSkill(message.data.source);
  // Refresh skills list after install
  const skills = await this.provider.getAllSkills();
  this.sendSkillsList(skills);
  break;

case "removeSkill":
  await this.provider.removeSkill(message.data.name);
  // Refresh skills list
  const skills = await this.provider.getAllSkills();
  this.sendSkillsList(skills);
  break;
```

### Phase 3: Skill Marketplace Integration

Leverage the existing npm registry search to show available skills:

#### 3.1 npm Registry Query

Skills can be discovered via:

- `https://registry.npmjs.org/-/v1/search?text=keywords:pi-skill` - skills tagged with `pi-skill`
- `https://registry.npmjs.org/-/v1/search?text=pi-package` - all pi packages (skills are included in `pi.skills` field)

#### 3.2 Skill Detection Logic

```typescript
// In PiPackagesPanel.svelte fetchMarketplacePackages()
if (o.package.pi?.skills?.length) types.push("skills");

// Each skill in package:
{
  name: string;
  description: string;
}
```

### Phase 4: Feature Requirements

#### 4.1 Installed Skills View

- List all currently loaded skills with descriptions
- Show source package or local path
- Display skill type badges (local/package/bundled)
- Enable/disable toggle per skill
- Remove/uninstall button for package skills
- Refresh button to reload skills

#### 4.2 Available Skills View

- Search skills from npm registry (pi-skill keyword)
- Filter by type, name, description
- Install button for each skill
- Show version, publisher, downloads
- Link to npm package page

#### 4.3 Skill Details View

- Full description and usage
- Source code preview (for local skills)
- Configuration options specific to skill
- Enable/disable toggle

### Phase 5: Sidebar Navigation

Add Skills tab to the sidebar in `App.svelte`:

```svelte
<!-- Add after Packages button (line 1164) -->
<button
  onclick={() => (activeTab = "skills")}
  class:active={activeTab === "skills"}
  title="Skills (8)"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
</button>
```

Update `activeTab` type (line 20-28):

```typescript
let activeTab = $state<
  | "chat"
  | "sessions"
  | "models"
  | "providers"
  | "tools"
  | "packages"
  | "skills" // NEW
  | "settings"
>("chat");
```

Update keyboard shortcut (line 180):

```typescript
case "8":
  activeTab = "skills";
  break;
```

### Phase 6: Settings Integration

Add skill-specific settings to `SettingsPanel.svelte`:

- "Enable skill discovery" checkbox (tied to `pi-agent.disableSkillDiscovery` inverted)
- "Extra skill paths" array editor (tied to `pi-agent.extraSkills`)
- "Auto-install recommended skills" option

---

## Implementation Details

### Files to Modify/Create

| File                                          | Action                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `src/webview/components/SkillsPanel.svelte`   | **CREATE** - New skills tab component                                 |
| `src/webview/App.svelte`                      | MODIFY - Add skills tab, update activeTab type, add keyboard shortcut |
| `src/protocol/types.ts`                       | MODIFY - Add new ProviderApi methods                                  |
| `src/message-handler.ts`                      | MODIFY - Add message handler cases                                    |
| `src/pi-agent-provider.ts`                    | MODIFY - Implement skill management methods                           |
| `src/webview/components/SettingsPanel.svelte` | MODIFY - Add skill settings section                                   |

### Skill Installation Flow

1. User clicks "Install" in Available Skills view
2. Webview sends `installSkill` message with npm package name
3. Extension spawns `pi install npm:package-name` command
4. On completion, reload session resources
5. Refresh skills list in webview

### Skill Removal Flow

1. User clicks "Remove" for a package-installed skill
2. Webview sends `removeSkill` message with skill name
3. Extension removes from `extraSkills` setting or uninstalls package
4. Session reload happens automatically
5. Refresh skills list

### Skill Enable/Disable Flow

1. User toggles enable state
2. If local skill: add/remove from `extraSkills` setting
3. If package skill: set/unset `disableSkillDiscovery` flag (affects all)
4. Session reload required
5. Update UI state

---

## UI Mockup

### Skills Tab Layout

```
┌─────────────────────────────────────┐
│ ┌──────────┐ ┌───────────────┐      │
│ │Installed │ │  Available    │      │
│ └──────────┘ └───────────────┘      │
│                                     │
│ Search: [_______________] ↻        │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ skill-name                        │ │
│ │ Description of what this skill   │ │
│ │ does...                           │ │
│ │ [skill] [local]  [toggle on/off]  │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ another-skill                     │ │
│ │ Another useful skill...            │ │
│ │ [skill] [npm:publisher/pkg] [✓]   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ └─────────────────────────────────┘ │
│   Browse all skills at pi.dev/skills │
└─────────────────────────────────────┘
```

---

## Risks and Considerations

### 1. Skill Discovery Timing

Skills are discovered at session creation time. Changes require session reload, which may interrupt user workflow. Consider:

- Showing a "Reload required" banner after skill changes
- Providing option to reload without creating new session

### 2. Skill Invocation from GUI

Currently skills are only invoked via slash commands in chat. Future enhancement could add:

- Buttons to invoke specific skills directly
- Skill templates for common use cases

### 3. Skill Configuration

Some skills may have their own configuration. Consider:

- Reading skill manifest for configuration schema
- Providing a generic key-value editor per skill

### 4. Conflict Detection

Skills from different sources may have naming conflicts. Consider:

- Warning when multiple skills define same slash command
- Showing source priority in UI

---

## Estimated Effort

- Phase 1 (Skills Tab Component): 2-3 hours
- Phase 2 (Extension Host Integration): 1-2 hours
- Phase 3 (Marketplace Integration): 1 hour (reuse existing npm search logic)
- Phase 4 (Settings Integration): 1 hour
- Testing and refinement: 1-2 hours

**Total: ~6-8 hours**

---

## Success Criteria

1. Skills tab appears in sidebar with icon and keyboard shortcut
2. Installed skills are listed with descriptions and sources
3. Available skills can be browsed and installed
4. Skills can be enabled/disabled (local skills)
5. Skill count reflects in ActivityBar/ResourceBadge
6. Changes persist across sessions
7. Works with both local and package-installed skills
