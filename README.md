# PiLot Studio for VS Code

![PiLot Studio logo](media/icon.png)

## Your PI coding companion for VS Code and VSCodium

Integrate the powerful PI coding agent directly into VS Code with a beautiful Svelte-based GUI.

[![Release](https://badgen.net/github/release/Printaga/PiLot?label=Release&icon=github)](https://github.com/Printaga/PiLot/releases/latest) [![GitHub Repo stars](https://img.shields.io/github/stars/Printaga/PiLot)](https://github.com/Printaga/PiLot)

**Working on macOS, Linux, and Windows.**

## Screenshots

![PiLot Studio in action](media/screenshot.png)

---

## Features

- 💬 **Chat Interface** — Interactive conversations with PI in a native VS Code panel
- 🌳 **Session Tree** — Navigate and branch through your conversation history
- 🤖 **15+ AI Providers** — Support for Anthropic, OpenAI, Google, Ollama, Groq, and more
- 🔧 **Customizable Tools** — Enable, disable, or restrict PI's capabilities per session
- 📦 **PI Packages** — Install extensions, skills, and prompt templates from the community
- 🎙️ **Local Dictation** — On-device speech-to-text powered by whisper.cpp (macOS, Windows, Linux)
- ⚙️ **Deep VS Code Integration** — Right-click context menus, keyboard shortcuts, editor tabs
- 🧠 **Thinking Levels** — Control reasoning depth (off → minimal → low → medium → high → xhigh)
- 🔄 **Model Cycling** — Quick-switch between models without leaving the chat
- 🎨 **Beautiful UI** — Modern, responsive interface built with Svelte 5 with extensive customization
- 📎 **File & Image Attachments** — Drag-and-drop or paste files and images into chat
- 📋 **Context Auto-Attach** — Automatically include editor context, selection, and diagnostics
- 🏷️ **`@` File Mentions** — Type `@` to mention files and folders in your workspace

## Requirements

- **VS Code** 1.85.0 or higher (or Codium 1.85.0+)
- **PI CLI** — Install the `pi` coding agent on your system
- An API key for your preferred AI provider (Anthropic, OpenAI, etc.)

> `Node.js 24.16.0+` is only required for local development of this extension, not for installing or using it in VS Code.

## Getting Started

1. **Install PI** — Follow the [PI installation guide](https://pi.dev) to install the `pi` CLI on your machine.
2. **Install the extension** from the VS Code Extensions view by searching for `PiLot Studio`, or use the Marketplace listing once the final publisher page is live.
3. **Configure your provider** — Set your API key as an environment variable:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   # or
   export OPENAI_API_KEY=sk-...
   ```
4. **Open PiLot Studio** — Press `Ctrl+Shift+Alt+P` (or `Cmd+Shift+Alt+P` on macOS) to open the PiLot Studio panel.
5. **Start a conversation** — Type your message and press Enter.

## Commands

| Command                | ID                                    | Description                           |
| ---------------------- | ------------------------------------- | ------------------------------------- |
| Open Agent             | `pi-agent.openPanel`                  | Open the PiLot Studio sidebar panel   |
| New Session            | `pi-agent.newSession`                 | Start a new conversation              |
| New Chat in Editor     | `pi-agent.newChatInEditor`            | Open a chat session in an editor tab  |
| Open Session in Editor | `pi-agent.openCurrentSessionInEditor` | Move current session to an editor tab |
| Cycle Model            | `pi-agent.cycleModel`                 | Cycle through available models        |
| Cycle Thinking Level   | `pi-agent.cycleThinkingLevel`         | Cycle through reasoning levels        |
| Focus Chat Input       | `pi-agent.focusInput`                 | Focus the chat input box              |
| Edit Last Message      | `pi-agent.editLastMessage`            | Edit and resend your last message     |
| Open Settings          | `pi-agent.openSettings`               | Open extension settings               |
| Toggle Dictation       | `pi-agent.toggleVoiceCapture`         | Toggle microphone dictation           |
| Add File to Chat       | `pi-agent.addFileToChat`              | Add a file to the current chat        |
| Explain Code           | `pi-agent.explainCode`                | Explain selected code with PI         |
| Refactor Code          | `pi-agent.refactorCode`               | Refactor selected code with PI        |
| Analyze Project        | `pi-agent.analyzeProject`             | Analyze a project folder with PI      |
| List Resources         | `pi-agent.listResources`              | List loaded PI resources              |
| Install Resource       | `pi-agent.installResource`            | Install a PI resource                 |
| Remove Resource        | `pi-agent.removeResource`             | Remove a PI resource                  |
| Update Resources       | `pi-agent.updateResources`            | Update all PI resources               |
| Manage Resources       | `pi-agent.manageResources`            | Open the resource management UI       |
| Show Diagnostics Log   | `pi-agent.showDiagnosticsLog`         | Show diagnostics output channel       |
| Export Diagnostics Log | `pi-agent.exportDiagnosticsLog`       | Export diagnostics to a file          |

## Keyboard Shortcuts

| Shortcut           | Action                                     |
| ------------------ | ------------------------------------------ |
| `Ctrl+Shift+Alt+P` | Open PiLot Studio panel                    |
| `Ctrl+Shift+I`     | Focus chat input                           |
| `Ctrl+Shift+Alt+N` | New session (when sidebar is focused)      |
| `Ctrl+Shift+;`     | Toggle dictation                           |
| `Ctrl+Shift+A`     | Add file to chat (when sidebar is focused) |

> macOS: Replace `Ctrl` with `Cmd`.

## Context Menus

### Editor: Right-click on selected code

- **Explain Code with PI** — Get an explanation of the selected code
- **Refactor Code with PI** — Get refactoring suggestions

### Explorer: Right-click on a folder

- **Analyze Project with PI** — Analyze the project structure

### Explorer: Right-click on any file

- **Add File to Chat** — Attach the file to the current conversation

## Settings

The extension provides extensive configuration under the `pi-agent.*` namespace:

### Runtime

- `pi-agent.binaryPath` — Custom `pi` executable path
- `pi-agent.agentDir` — Custom agent directory
- `pi-agent.offline` — Start pi in offline mode
- `pi-agent.autoUpdate` — Automatically update pi when a new version is available

### Sessions

- `pi-agent.thinkingLevel` — Default reasoning level (off, minimal, low, medium, high, xhigh)
- `pi-agent.autoCompact` — Enable automatic context compaction
- `pi-agent.autoRetry` — Enable automatic retry for transient errors
- `pi-agent.restoreLastSession` — Restore last chat session on startup
- `pi-agent.messageHistory.enabled` — Enable per-session prompt history recall

### Tools

- `pi-agent.toolPreset` — Tool access mode (default, review, none, custom)
- `pi-agent.customTools` — Specific tools to allow in custom mode
- `pi-agent.autoExpandSmallEdits` — Auto-expand small edit blocks
- `pi-agent.autoExpandEditLineThreshold` — Line count threshold for auto-expand

### Prompts

- `pi-agent.disableContextFiles` — Disable AGENTS.md/CLAUDE.md loading
- `pi-agent.systemPrompt` — Override pi's default system prompt
- `pi-agent.appendSystemPrompts` — Append extra text to the active system prompt

### Resources

- `pi-agent.extraExtensions` — Additional extension paths
- `pi-agent.extraSkills` — Additional skill paths
- `pi-agent.extraPromptTemplates` — Additional prompt template paths

### Discovery

- `pi-agent.disableExtensionDiscovery` — Disable automatic extension discovery
- `pi-agent.disableSkillDiscovery` — Disable skill discovery
- `pi-agent.disablePromptTemplateDiscovery` — Disable prompt template discovery

### Context

- `pi-agent.context.autoAttach` — Auto-attach editor context to prompts
- `pi-agent.context.includeEditor` — Include editor metadata
- `pi-agent.context.includeSelection` — Include selected text
- `pi-agent.context.includeDiagnostics` — Include diagnostics
- `pi-agent.context.includeGit` — Include git status

### Dictation

- `pi-agent.voice.enabled` — Show/hide the microphone dictation button
- `pi-agent.voice.model` — Choose dictation model (tiny-q5_1, tiny, base-q5_1, etc.)

### Diagnostics

- `pi-agent.diagnostics.enabled` — Enable high-signal diagnostic logging

### Style

- `pi-agent.fontSize` — Font size in the sidebar panel
- `pi-agent.fontFamily` — Font family in the sidebar panel
- `pi-agent.fontWeight` — Font weight in the sidebar panel
- `pi-agent.fontStyle` — Font style in the sidebar panel

## Dictation

The extension bundles [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) and native voice helpers for on-device speech-to-text.

Dictation runs **entirely locally** — no audio data ever leaves your device.

**Supported platforms:**

- macOS
- Windows x64 & ARM64
- Linux x64 & ARM64

**Usage:**

1. Click the microphone button in the chat input or use the `Toggle Dictation` command.
2. Grant microphone permission when prompted (first use only).
3. The first dictation model download requires internet; subsequent use is fully offline.

Configure the dictation model via `pi-agent.voice.model` (default: `tiny-q5_1`).

## Troubleshooting

### PI is not detected

- Ensure `pi` is installed and available on your `PATH`.
- Set `pi-agent.binaryPath` to the absolute path of the `pi` executable.
- Check that your `pi` version is compatible with the extension.

### Provider requests fail

- Verify your API keys are set as environment variables or in pi's configuration.
- After updating a key, restart the extension so the spawned process picks up the new environment.

### Dictation is unavailable

- Check that `pi-agent.voice.enabled` is turned on.
- Allow microphone access for VS Code in your OS privacy settings.
- Enable `pi-agent.diagnostics.enabled` and check the **PiLot Studio Diagnostics** output channel for details.

### Sessions or history look wrong

- Verify `pi-agent.agentDir` points to the correct directory.
- If you switch agent directories, restart the extension to keep the running process and file-backed history aligned.

## Diagnostics

Diagnostics are **off by default**. Enable `pi-agent.diagnostics.enabled` when troubleshooting.

When enabled, the extension writes high-signal progress and error logs to the **PiLot Studio Diagnostics** output channel, including lifecycle events, startup/runtime errors, model and thinking-level changes, compaction activity, token statistics, resource actions, and dictation state.

Use **PiLot Studio: Show Diagnostics Log** to inspect the current log, or **PiLot Studio: Export Diagnostics Log...** to save it to a file.

## Architecture

```
pilots-studio/
├── src/
│   ├── extension.ts              # Extension entry point & command registration
│   ├── pi-agent-provider.ts      # Main provider — session lifecycle, settings sync, IPC
│   ├── message-handler.ts        # Webview ↔ extension message routing
│   ├── sessions-tree.ts          # Native VS Code tree view for session history
│   └── webview/                  # Svelte 5 UI application
│       ├── App.svelte            # Root component
│       └── components/           # Reusable UI components
├── media/
│   ├── icon.svg                  # Vector icon source
│   ├── icon.png                  # Marketplace and README icon
│   ├── kofi.webp                 # Sponsorship artwork
│   ├── kofi3.webp                # Alternate sponsorship artwork
│   └── voice/                    # Bundled dictation helpers and voice assets
├── dist/                         # Compiled extension output
└── dist-tsc/                     # Test compiler output
```

## Development

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Build the Svelte webview
pnpm run webview:build

# Watch mode
pnpm run watch

# Run tests
pnpm test

# Lint
pnpm run lint

# Package for distribution (.vsix)
pnpm run package
```

### Quick Build Command

```bash
pnpm run build    # Builds webview + compiles TS in one step
```

## Technologies

- **VS Code Extension API** — Native VS Code integration
- **Svelte 5** — Reactive UI framework with runes
- **Vite 8** — Fast build tooling and HMR
- **TypeScript 6** — Type-safe development
- **ESBuild** — Fast bundling
- **PI SDK** — [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## Contributing

Contributions are welcome! Please feel free to:

- [Open an issue](https://github.com/Printaga/PiLot/issues) for bug reports or feature requests
- [Submit a pull request](https://github.com/Printaga/PiLot/pulls) with improvements

## License

[Apache-2.0](./LICENSE)
