<script lang="ts">
  import MessageBubble from "./MessageBubble.svelte";
  import VoiceCapture from "./VoiceCapture.svelte";

  interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
  name?: string;
}

interface ToolCallResult {
    content?: string;
    details?: any;
    isError?: boolean;
  }

  interface ToolCallMessage {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: ToolCallResult;
    isError?: boolean;
    status: "pending" | "streaming" | "complete";
  }

  interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    thinking?: string;
    timestamp: number;
    isStreaming?: boolean;
    toolCalls?: ToolCallMessage[];
  }

  interface ContextFile {
    path: string;
  }

  interface Skill {
    name: string;
    description?: string;
  }

  interface ExtensionSourceInfo {
    name?: string;
    label?: string;
  }

  interface LoadedExtension {
    path: string;
    sourceInfo: ExtensionSourceInfo | null;
  }

  interface VSCodeExtension {
    id: string;
    name: string;
    version: string;
  }

  interface Package {
    source: string;
    path: string;
  }

  interface SessionResources {
    contextFiles: ContextFile[];
    contextFileCount: number;
    skills: Skill[];
    skillCount: number;
    extensions: LoadedExtension[];
    extensionCount: number;
    vscodeExtensions: VSCodeExtension[];
    vscodeExtensionCount: number;
    packages: Package[];
    packageCount: number;
  }

  const emptySessionResources: SessionResources = {
    contextFiles: [],
    contextFileCount: 0,
    skills: [],
    skillCount: 0,
    extensions: [],
    extensionCount: 0,
    vscodeExtensions: [],
    vscodeExtensionCount: 0,
    packages: [],
    packageCount: 0,
  };

  interface Props {
    messages: Message[];
    isStreaming: boolean;
    onSend: (text: string, images?: ImageContent[]) => void;
    onNewSession?: () => void;
    onAbort?: () => void;
    sessionResources?: SessionResources | null;
    onToggleVoice?: () => void;
    isListening?: boolean;
    onVoiceTranscription?: (text: string) => void;
    inputText?: string;
    tokensIn?: number;
    tokensOut?: number;
    tokensTotal?: number;
    tokensCacheRead?: number;
  }

  let {
    messages,
    isStreaming,
    onSend,
    onNewSession,
    onAbort = () => {},
    sessionResources = null,
    onToggleVoice = () => {},
    isListening = false,
    inputText = $bindable(""),
    tokensIn = 0,
    tokensOut = 0,
    tokensTotal = 0,
    tokensCacheRead = 0,
  }: Props = $props();
  let messagesContainer: HTMLDivElement | null = null;
  let transcriptWindowSize = $state(100);
  let visibleMessageCount = $state(100);
  let files = $state<string[]>([]);
  let images = $state<ImageContent[]>([]);
  let isDragging = $state(false);
  let showAutocomplete = $state(false);
  let autocompleteQuery = $state("");
  let selectedIndex = $state(0);
  let textareaEl: HTMLTextAreaElement | null = null;
  let showScrollBtn = $state(false);
  let userScrolledUp = false;

  // Internal slash command state
  let showSlashCommands = $state(false);
  let slashQuery = $state("");
  let selectedSlashIndex = $state(0);

  // Slash commands matching PI TUI
  const slashCommands = [
    {
      name: "/settings",
      description: "Open settings menu",
      action: "showSettings",
    },
    {
      name: "/model",
      description: "Select model (opens selector UI)",
      action: "switchModel",
    },
    {
      name: "/scoped-models",
      description: "Enable/disable models for Ctrl+P cycling",
      action: "scopedModels",
    },
    {
      name: "/export",
      description:
        "Export session (HTML default, or specify path: .html/.jsonl)",
      action: "export",
    },
    {
      name: "/import",
      description: "Import and resume a session from a JSONL file",
      action: "import",
    },
    {
      name: "/share",
      description: "Share session as a secret GitHub gist",
      action: "share",
    },
    {
      name: "/copy",
      description: "Copy last agent message to clipboard",
      action: "copy",
    },
    {
      name: "/name",
      description: "Set session display name",
      action: "setName",
    },
    {
      name: "/session",
      description: "Show session info and stats",
      action: "sessionInfo",
    },
    {
      name: "/changelog",
      description: "Show changelog entries",
      action: "changelog",
    },
    {
      name: "/hotkeys",
      description: "Show all keyboard shortcuts",
      action: "hotkeys",
    },
    {
      name: "/fork",
      description: "Create a new fork from a previous user message",
      action: "fork",
    },
    {
      name: "/clone",
      description: "Duplicate the current session at the current position",
      action: "clone",
    },
    {
      name: "/tree",
      description: "Navigate session tree (switch branches)",
      action: "tree",
    },
    {
      name: "/login",
      description: "Configure provider authentication",
      action: "login",
    },
    {
      name: "/logout",
      description: "Remove provider authentication",
      action: "logout",
    },
    { name: "/new", description: "Start a new session", action: "newSession" },
    {
      name: "/compact",
      description: "Manually compact the session context",
      action: "compact",
    },
    {
      name: "/resume",
      description: "Resume a different session",
      action: "resume",
    },
    {
      name: "/reload",
      description:
        "Reload keybindings, extensions, skills, prompts, and themes",
      action: "reload",
    },
    { name: "/quit", description: "Quit PI", action: "quit" },
  ];

  const resources = $derived(sessionResources ?? emptySessionResources);

  const hasSessionResources = $derived(
    Boolean(
      resources.contextFileCount > 0 ||
        resources.skillCount > 0 ||
        resources.extensionCount > 0 ||
        resources.packageCount > 0,
    ),
  );
  const contextTitle = $derived(
    resources.contextFiles.length > 0
      ? resources.contextFiles.map((f, i) => `${i + 1}. ${f.path}`).join("\n")
      : "No context files loaded",
  );
  const skillsTitle = $derived(
    resources.skills.length > 0
      ? resources.skills
          .map(
            (skill, i) =>
              `${i + 1}. ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`,
          )
          .join("\n")
      : "No skills loaded",
  );
  const extensionsTitle = $derived(
    resources.extensions.length > 0
      ? resources.extensions
          .map(
            (extension, i) =>
              `${i + 1}. ${extension.path}${extension.sourceInfo?.name ? ` (${extension.sourceInfo.name})` : ""}`,
          )
          .join("\n")
      : "No PI extensions loaded",
  );

  const packagesTitle = $derived(
    resources.packages.length > 0
      ? resources.packages.map((pkg, i) => `${i + 1}. ${pkg.source}`).join("\n")
      : "No packages loaded",
  );

  // Media asset URIs injected by the extension host
  let mediaIcon = $state('');
  let mediaKofi = $state('');

  $effect(() => {
    if (typeof window !== 'undefined') {
      mediaIcon = (window as any).__MEDIA_ICON__ || '';
      mediaKofi = (window as any).__MEDIA_KOFI__ || '';
    }
  });

  // Calculate visible messages for transcript window management
  const visibleMessages = $derived(messages.slice(-visibleMessageCount));
  const hasMoreMessages = $derived(messages.length > visibleMessageCount);

  // Filter files for autocomplete
  const filteredFiles = $derived(
    files
      .filter((f) => f.toLowerCase().includes(autocompleteQuery.toLowerCase()))
      .slice(0, 20),
  );

  // Filter slash commands based on query
  const filteredSlashCommands = $derived(
    slashCommands
      .filter((cmd) =>
        cmd.name.toLowerCase().includes(slashQuery.toLowerCase()),
      )
      .slice(0, 10),
  );

  // Smart auto-scroll: only scroll if user is near the bottom.
  // Shows a floating button when scrolled up.
  $effect(() => {
    const el = messagesContainer;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom || (!userScrolledUp && messages.length > 0)) {
      el.scrollTop = el.scrollHeight;
    }
    showScrollBtn = !isNearBottom && el.scrollHeight > el.clientHeight + 80;
  });

  function scrollToBottom() {
    userScrolledUp = false;
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    showScrollBtn = false;
  }

  function handleMessagesScroll() {
    const el = messagesContainer;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp = !isNearBottom;
    showScrollBtn = !isNearBottom && el.scrollHeight > el.clientHeight + 80;
  }

  // Handle messages from extension — listener always installed regardless of
  // vscode API availability (it may be set after this component first mounts).
  $effect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data;
      if (type === "add-file-to-chat") {
        addPathToInput(data.path);
      }
      if (type === "workspace-files") {
        files = data.files || [];
      }
      if (type === "files-attached") {
        // Insert attached file paths at cursor position
        console.log("[ChatPanel] files-attached received, paths:", data?.paths);
        if (data?.paths && data.paths.length > 0) {
          const cursorPos = textareaEl?.selectionStart || inputText.length;
          const textBeforeCursor = inputText.slice(0, cursorPos);
          const textAfterCursor = inputText.slice(cursorPos);

          // Build the @ mention for each file
          const fileMentions = data.paths.map((p: string) => "@" + p).join(" ");
          const newText =
            textBeforeCursor +
            (textBeforeCursor ? " " : "") +
            fileMentions +
            " " +
            textAfterCursor;
          console.log("[ChatPanel] files-attached: setting inputText to:", newText);
          inputText = newText;
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Handle voice transcriptions from parent dispatch
  $effect(() => {
    function handleVoiceTranscription(event: CustomEvent<string>) {
      const text = event.detail;
      if (!text) return;

      // Focus the textarea and insert text at cursor
      textareaEl?.focus();
      const cursorPos = textareaEl?.selectionStart || inputText.length;
      const textBeforeCursor = inputText.slice(0, cursorPos);
      const textAfterCursor = inputText.slice(cursorPos);
      inputText = textBeforeCursor + text + textAfterCursor;

      // Close any open dropdowns
      closeAutocomplete();
      closeSlashCommands();
    }

    window.addEventListener(
      "voice-transcription",
      handleVoiceTranscription as EventListener,
    );
    return () =>
      window.removeEventListener(
        "voice-transcription",
        handleVoiceTranscription as EventListener,
      );
  });

  function handleSubmit() {
    const text = inputText.trim();
    const hasImages = images.length > 0;

    if (!text && !hasImages) return;

    // Check if this is a slash command (text-only slash commands)
    if (text.startsWith("/") && !hasImages) {
      handleSlashCommand(text);
      inputText = "";
      return;
    }

    const imagesToSend = hasImages ? [...images] : undefined;
    images = [];
    onSend(text, imagesToSend);
    inputText = "";
    visibleMessageCount = transcriptWindowSize;
  }

  function handleSlashCommand(text: string) {
    // Forward directly to prompt - the provider will intercept slash commands
    onSend(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle paste (Ctrl+V / Cmd+V) — we use the textarea's native paste
    // but intercept it in the onpaste handler for images

    // Handle slash command navigation
    if (showSlashCommands) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedSlashIndex = Math.min(
          selectedSlashIndex + 1,
          filteredSlashCommands.length - 1,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedSlashIndex = Math.max(selectedSlashIndex - 1, 0);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (filteredSlashCommands.length > 0) {
          const cmd = filteredSlashCommands[selectedSlashIndex];
          if (cmd) {
            inputText = cmd.name + " ";
            showSlashCommands = false;
            slashQuery = "";
            // Auto-submit the slash command
            handleSubmit();
          }
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashCommands();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showAutocomplete && filteredFiles.length > 0) {
        selectFile(filteredFiles[selectedIndex]);
        return;
      }
      handleSubmit();
    }
    if (e.key === "Escape" && showAutocomplete) {
      e.preventDefault();
      closeAutocomplete();
    }
    if (showAutocomplete) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredFiles.length - 1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
      }
    }
  }

  function handleInput() {
    // Check for @ mention
    const cursorPos = textareaEl?.selectionStart || 0;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@\S*$/);

    // Check for slash command
    const slashMatch = textBeforeCursor.match(/\/\S*$/);

    if (slashMatch && !atMatch) {
      // Slash command takes precedence and text starts with /
      if (inputText.startsWith("/")) {
        slashQuery = slashMatch[0].slice(1) || "";
        showSlashCommands = true;
        selectedSlashIndex = 0;
        closeAutocomplete();
        return;
      }
    } else if (atMatch) {
      autocompleteQuery = atMatch[1] || "";
      showAutocomplete = true;
      selectedIndex = 0;
      // Request workspace files if not loaded
      if (files.length === 0) {
        requestWorkspaceFiles();
      }
      closeSlashCommands();
      return;
    }

    closeAutocomplete();
    closeSlashCommands();
  }

  function requestWorkspaceFiles() {
    const vscode = (window as any).vscode;
    if (vscode?.postMessage) {
      vscode.postMessage({ type: "get-workspace-files" });
    }
  }

  function closeAutocomplete() {
    showAutocomplete = false;
    autocompleteQuery = "";
  }

  function closeSlashCommands() {
    showSlashCommands = false;
    slashQuery = "";
  }

  function handleAttachFile() {
    const vscode = (window as any).vscode;
    if (vscode?.postMessage) {
      vscode.postMessage({ type: "openFileAttachmentDialog" });
    }
  }

  // ── Drag-and-drop handlers ────────────────────────────────
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if we're actually leaving the container, not entering a child
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (target && !target.contains(related)) {
      isDragging = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;

    const files_list = e.dataTransfer?.files;
    if (!files_list || files_list.length === 0) return;

    for (let i = 0; i < files_list.length; i++) {
      const file = files_list[i];
      if (file.type.startsWith("image/")) {
        readImageFile(file);
      }
    }
  }

  // ── Paste handler ─────────────────────────────────────────
  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          readImageFile(blob, "clipboard");
        }
        break;
      }
    }
  }

  function readImageFile(file: File, name?: string) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      // Strip the data:...;base64 prefix to store just the base64
      const base64Match = data.match(/^data:([^;]+);base64,(.+)$/);
      if (base64Match) {
        images = [...images, {
          type: "image",
          data: base64Match[2],
          mimeType: base64Match[1],
          name: name || file.name || "pasted-image"
        }];
      }
    };
    reader.readAsDataURL(file);
  }

  function removeImage(index: number) {
    images = images.filter((_, i) => i !== index);
  }

  function getImageDataUrl(img: ImageContent): string {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  function addPathToInput(path: string) {
    if (!textareaEl) return;

    const cursorPos = textareaEl.selectionStart || inputText.length;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const textAfterCursor = inputText.slice(cursorPos);

    // Find the @ mention to replace
    const match = textBeforeCursor.match(/@\S*$/);
    if (match && match.index !== undefined) {
      const beforeMention = inputText.slice(0, match.index);
      inputText = beforeMention + "@" + path + " " + textAfterCursor;
      closeAutocomplete();
    } else {
      // No @ mention at cursor — insert @path directly
      inputText = textBeforeCursor +
        (textBeforeCursor ? " " : "") +
        "@" + path + " " +
        textAfterCursor;
      // Auto-focus and place cursor after the inserted mention
      requestAnimationFrame(() => {
        const pos = textBeforeCursor.length + path.length + 2;
        textareaEl?.setSelectionRange(pos, pos);
        textareaEl?.focus();
      });
    }
  }

  function selectFile(filepath: string) {
    if (!textareaEl) return;

    const cursorPos = textareaEl.selectionStart || inputText.length;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const textAfterCursor = inputText.slice(cursorPos);

    // Find the @ mention to replace
    const match = textBeforeCursor.match(/@\S*$/);
    if (match && match.index !== undefined) {
      const beforeMention = inputText.slice(0, match.index);
      inputText = beforeMention + "@" + filepath + " " + textAfterCursor;
      closeAutocomplete();

      // Focus back on textarea
      setTimeout(() => {
        textareaEl?.focus();
      }, 0);
    }
  }

  function handleShowMore() {
    visibleMessageCount = Math.min(
      visibleMessageCount + transcriptWindowSize,
      messages.length,
    );
  }
</script>

<div class="chat-panel">
  {#if hasSessionResources}
    <div class="resources-info">
      <span class="resources-header">SESSION CONTEXT</span>
      <div class="resources-grid">
        {#if resources.contextFileCount > 0}
          <div class="resource-badge" title={contextTitle} data-type="context">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              ><path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
              /><polyline points="14 2 14 8 20 8" /></svg
            >
            <span>{resources.contextFileCount} Files</span>
          </div>
        {/if}
        {#if resources.skillCount > 0}
          <div class="resource-badge" title={skillsTitle} data-type="skill">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              ><polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              /></svg
            >
            <span>{resources.skillCount} Skills</span>
          </div>
        {/if}
        {#if resources.extensionCount > 0}
          <div
            class="resource-badge"
            title={extensionsTitle}
            data-type="extensions"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              ><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect
                x="2"
                y="14"
                width="20"
                height="8"
                rx="2"
                ry="2"
              /><line x1="6" y1="6" x2="6.01" y2="6" /><line
                x1="6"
                y1="18"
                x2="6.01"
                y2="18"
              /></svg
            >
            <span>{resources.extensionCount} Exts</span>
          </div>
        {/if}
        {#if resources.packageCount > 0}
          <div
            class="resource-badge"
            title={packagesTitle}
            data-type="packages"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              ><path
                d="M21 16.5c0 .552-.448 1-1 1H4c-.552 0-1-.448-1-1V8.5c0-.552.448-1 1-1h16c.552 0 1 .448 1 1v8zM21 8.5V6c0-.552-.448-1-1-1H4c-.552 0-1 .448-1 1v2.5M4 12h16"
              /></svg
            >
            <span>{resources.packageCount} Packages</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if isDragging}
    <div
      class="drop-zone-overlay"
      role="dialog"
      aria-label="Drop zone for images"
      ondragover={(e) => { e.preventDefault(); e.stopPropagation(); }}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      <div class="drop-zone-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span class="drop-zone-text">Drop images here</span>
        <span class="drop-zone-hint">Supported: PNG, JPG, GIF, WebP</span>
      </div>
    </div>
  {/if}

  <div
    class="messages"
    bind:this={messagesContainer}
    onscroll={handleMessagesScroll}
  >
    {#if messages.length === 0}
      <div class="empty-state">
        <div class="hero-graphic">
          <div class="orb"></div>
          {#if mediaIcon}
            <img src={mediaIcon} alt="PiLot Studio" class="logo-image" />
          {:else}
            <svg
              width="80"
              height="80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-primary)"
              stroke-width="1"
            >
              <rect x="2" y="2" width="20" height="20" rx="6" />
              <path d="M7 8h10M12 8v8M9 16h6" stroke-linecap="round" />
            </svg>
          {/if}
        </div>
        <h1>PiLot Studio for VS Code</h1>
        <p class="subtitle">
          An unofficial GUI for the
          <a href="https://pi.dev/" target="_blank" rel="noopener noreferrer"
            >PI coding agent</a
          >. Type a message below or use <kbd>/</kbd> for commands.
        </p>

        <div class="setup-card">
          <div class="setup-header">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Getting Started</span>
          </div>
          <p class="setup-text">
            This extension requires the PI coding agent CLI. Install it
            globally:
          </p>
          <button
            class="setup-code"
            onclick={() =>
              navigator.clipboard?.writeText(
                "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
              )}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigator.clipboard?.writeText('npm install -g --ignore-scripts @earendil-works/pi-coding-agent'); } }}
          >
            <span class="code-prompt">$</span>
            npm install -g --ignore-scripts @earendil-works/pi-coding-agent
            <svg
              class="copy-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
              />
            </svg>
          </button>
          <p class="setup-note">
            After installation, make sure the <code>pi</code> command is available
            on your PATH.
          </p>
        </div>

        {#if mediaKofi}
          <a
            href="https://ko-fi.com/O4H020U50P"
            target="_blank"
            rel="noopener noreferrer"
            class="kofi-link"
          >
            <img src={mediaKofi} alt="Support on Ko-fi" />
          </a>
        {/if}

        <div class="quick-actions">
          {#if onNewSession}
            <button class="primary-action" onclick={onNewSession}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                ><line x1="12" y1="5" x2="12" y2="19" /><line
                  x1="5"
                  y1="12"
                  x2="19"
                  y2="12"
                /></svg
              >
              New Session
            </button>
          {/if}
          <div class="action-group">
            <button
              onclick={() => onSend("What files are in the current project?")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                /></svg
              >
              List Files
            </button>
            <button
              onclick={() => onSend("Explain the architecture of this project")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg
              >
              Architecture
            </button>
          </div>
        </div>
      </div>
    {:else}
      {#each visibleMessages as message, i (i)}
        <MessageBubble {message} />
      {/each}

      {#if hasMoreMessages}
        <button class="show-more-btn" onclick={handleShowMore}>
          Show more...
        </button>
      {/if}

      {#if isStreaming}
        <div class="streaming-indicator">
          <div class="typing-animation">
            <span></span><span></span><span></span>
          </div>
          <span class="streaming-text">PI is processing...</span>
        </div>
      {/if}
    {/if}
  </div>

  {#if showScrollBtn}
    <button
      class="scroll-bottom-btn"
      onclick={scrollToBottom}
      title="Scroll to bottom"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  {/if}

  <div class="input-container" role="region" aria-label="Chat input area" ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
    {#if images.length > 0}
      <div class="image-preview-bar">
        {#each images as img, i}
          <div class="image-preview-item">
            <img src={getImageDataUrl(img)} alt={img.name || 'Attached image'} class="image-preview-thumb" />
            <button class="image-preview-remove" onclick={() => removeImage(i)} title="Remove image">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <span class="image-preview-name">{img.name || 'image'}</span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="input-wrapper">
      <VoiceCapture {isListening} onToggle={onToggleVoice} />
      <button
        class="attach-btn"
        onclick={handleAttachFile}
        title="Attach file (Ctrl+Shift+A)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
          />
        </svg>
      </button>
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        oninput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          handleInput();
        }}
        placeholder="Type a message... / for commands, @ to mention files"
        rows="1"
      ></textarea>
      {#if isStreaming}
        <button class="abort-btn" onclick={onAbort} title="Stop generation">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      {/if}
      <button
        class="send-btn"
        onclick={handleSubmit}
        disabled={!inputText.trim() && images.length === 0}
        title="Send (Enter)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      </button>
    </div>

    {#if showAutocomplete && filteredFiles.length > 0}
      <div class="autocomplete-dropdown">
        {#each filteredFiles as file, i}
          <button
            class="autocomplete-item"
            class:selected={i === selectedIndex}
            onclick={() => selectFile(file)}
            onmouseenter={() => (selectedIndex = i)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
              />
            </svg>
            <span class="file-path">{file}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if showSlashCommands && filteredSlashCommands.length > 0}
      <div class="autocomplete-dropdown slash-commands-dropdown">
        {#each filteredSlashCommands as cmd, i}
          <button
            class="autocomplete-item slash-command-item"
            class:selected={i === selectedSlashIndex}
            onclick={() => {
              inputText = cmd.name + " ";
              showSlashCommands = false;
              handleSubmit();
            }}
            onmouseenter={() => (selectedSlashIndex = i)}
          >
            <span class="slash-cmd-name">{cmd.name}</span>
            <span class="slash-cmd-desc">{cmd.description}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="status-bar">
    <div class="status-left">
      <span class="status-item" title="Tokens consumed this session">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z"
          />
          <path d="M12 6v6l4 2" />
        </svg>
        <span class="token-label">In</span>
        <span class="token-value">{tokensIn.toLocaleString()}</span>
      </span>
      <span class="status-sep">|</span>
      <span class="status-item" title="Tokens generated this session">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        <span class="token-label">Out</span>
        <span class="token-value">{tokensOut.toLocaleString()}</span>
      </span>
      <span class="status-sep">|</span>
      <span class="status-item" title="Cache read tokens this session">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="2 10 22 10" />
        </svg>
        <span class="token-label">CACHE</span>
        <span class="token-value">{tokensCacheRead.toLocaleString()}</span>
      </span>
      <span class="status-sep">|</span>
      <span class="status-item" title="Total tokens used this session">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span class="token-label">Total</span>
        <span class="token-value">{tokensTotal.toLocaleString()}</span>
      </span>
    </div>
  </div>
</div>

<style>
  /* ── Drop zone overlay ─────────────────────── */
  .drop-zone-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: oklch(from var(--color-bg) l c h / 0.85);
    backdrop-filter: blur(4px);
    animation: drop-zone-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes drop-zone-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .drop-zone-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8);
    border: 2px dashed var(--color-primary);
    border-radius: var(--radius-xl);
    background: var(--accent-glow);
    color: var(--color-primary);
  }

  .drop-zone-text {
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .drop-zone-hint {
    font-size: var(--text-xs);
    opacity: 0.6;
  }

  /* ── Image preview bar ─────────────────────── */
  .image-preview-bar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0 var(--space-2);
    flex-wrap: wrap;
  }

  .image-preview-item {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid oklch(from var(--color-primary) l c h / 0.3);
    background: var(--color-surface-2);
    flex-shrink: 0;
  }

  .image-preview-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .image-preview-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    background: oklch(0% 0 0 / 0.6);
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .image-preview-item:hover .image-preview-remove {
    opacity: 1;
  }

  .image-preview-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    font-size: 8px;
    color: white;
    background: oklch(0% 0 0 / 0.5);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: transparent;
    position: relative;
  }

  .resources-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-4);
    background: oklch(from var(--color-primary) l c h / 0.03);
    border-bottom: 1px solid oklch(from var(--color-border) l c h / 0.15);
  }

  .resources-header {
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .resources-grid {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .resource-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2);
    background: oklch(from var(--color-surface-2) l c h / 0.5);
    border: 1px solid oklch(from var(--color-border) l c h / 0.2);
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted);
    transition: all var(--transition-interactive);
  }

  .resource-badge:hover {
    border-color: var(--color-primary);
    background: var(--accent-glow);
    color: var(--color-primary);
  }

  .resource-badge svg {
    opacity: 0.6;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    scrollbar-gutter: stable;
    scroll-behavior: smooth;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--space-8);
    gap: var(--space-4);
    animation: msg-fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes msg-fade-in {
    from {
      opacity: 0;
      transform: translateY(24px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .hero-graphic {
    position: relative;
    margin-bottom: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .orb {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 120px;
    height: 120px;
    background: radial-gradient(
      circle,
      var(--color-primary) 0%,
      transparent 70%
    );
    opacity: 0.12;
    filter: blur(20px);
    animation: orb-pulse 5s ease-in-out infinite;
  }

  @keyframes orb-pulse {
    0%,
    100% {
      opacity: 0.1;
      transform: translate(-50%, -50%) scale(1);
    }
    50% {
      opacity: 0.18;
      transform: translate(-50%, -50%) scale(1.1);
    }
  }

  .logo-image {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-lg);
    object-fit: contain;
  }

  .kofi-link {
    display: inline-block;
    margin-top: var(--space-2);
    transition: transform var(--transition-interactive);
  }

  .kofi-link:hover {
    transform: scale(1.05);
  }

  .kofi-link img {
    height: 36px;
    width: auto;
  }

  .empty-state h1 {
    font-size: var(--text-xl);
    font-weight: 800;
    letter-spacing: -0.03em;
    background: linear-gradient(
      135deg,
      var(--color-text),
      oklch(from var(--color-text) l c h / 0.4)
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .empty-state p {
    color: var(--color-text-muted);
    max-width: 340px;
    line-height: 1.6;
    font-size: var(--text-sm);
    text-align: center;
  }

  .empty-state .subtitle {
    max-width: 400px;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: 1.7;
  }

  .empty-state .subtitle a {
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 600;
    border-bottom: 1px solid transparent;
    transition: border-color var(--transition-fast);
  }

  .empty-state .subtitle a:hover {
    border-bottom-color: var(--color-primary);
  }

  .empty-state .subtitle kbd {
    display: inline-block;
    padding: 0 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    background: oklch(from var(--color-surface-2) l c h / 0.5);
    border: 1px solid oklch(from var(--color-border) l c h / 0.3);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    line-height: 1.6;
  }

  /* ── Setup card ── */

  .setup-card {
    background: oklch(from var(--color-surface) l c h / 0.6);
    border: 1px solid oklch(from var(--color-border) l c h / 0.25);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
    max-width: 480px;
    width: 100%;
    text-align: left;
  }

  .setup-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .setup-header svg {
    color: var(--color-primary);
    opacity: 0.8;
  }

  .setup-text {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.6;
    margin-bottom: var(--space-2);
  }

  .setup-code {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: oklch(0% 0 0 / 0.3);
    border: 1px solid oklch(from var(--color-border) l c h / 0.2);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    cursor: pointer;
    transition: all var(--transition-interactive);
    user-select: all;
    word-break: break-all;
    line-height: 1.5;
    appearance: none;
    -webkit-appearance: none;
    text-align: left;
    width: auto;
  }

  .setup-code:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .setup-code:hover {
    border-color: var(--color-primary);
    background: oklch(0% 0 0 / 0.4);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .code-prompt {
    color: var(--color-text-muted);
    opacity: 0.5;
    user-select: none;
    flex-shrink: 0;
  }

  .setup-code .copy-icon {
    margin-left: auto;
    opacity: 0.4;
    flex-shrink: 0;
    transition: opacity var(--transition-fast);
  }

  .setup-code:hover .copy-icon {
    opacity: 0.8;
    color: var(--color-primary);
  }

  .setup-note {
    font-size: 10px;
    color: var(--color-text-muted);
    opacity: 0.6;
    line-height: 1.5;
    margin-top: var(--space-2);
  }

  .setup-note code {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 4px;
    background: oklch(0% 0 0 / 0.2);
    border-radius: var(--radius-sm);
  }

  .quick-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
    width: 100%;
    max-width: 280px;
  }

  .action-group {
    display: flex;
    gap: var(--space-2);
  }

  .action-group button {
    flex: 1;
  }

  .quick-actions button {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid oklch(from var(--color-border) l c h / 0.3);
    border-radius: var(--radius-lg);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text);
    transition: all var(--transition-interactive);
  }

  .quick-actions button:hover {
    border-color: var(--color-primary);
    background: var(--accent-glow);
    color: var(--color-primary);
  }

  .primary-action {
    background: var(--color-primary) !important;
    color: var(--color-text-inverse) !important;
    border: none !important;
    box-shadow: 0 4px 14px oklch(from var(--color-primary) l c h / 0.3);
    padding: var(--space-3) var(--space-4) !important;
    font-size: var(--text-sm) !important;
    font-weight: 700 !important;
  }

  .primary-action:hover {
    background: var(--color-primary-hover) !important;
    box-shadow: 0 6px 20px oklch(from var(--color-primary) l c h / 0.4);
    color: var(--color-text-inverse) !important;
  }

  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: oklch(from var(--color-primary) l c h / 0.06);
    border: 1px solid oklch(from var(--color-primary) l c h / 0.12);
    border-radius: var(--radius-full);
    width: fit-content;
    animation: msg-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-bottom: var(--space-2);
    margin-left: var(--space-2);
  }

  .typing-animation {
    display: flex;
    gap: 3px;
    align-items: flex-end;
    padding: 2px 0;
  }

  .typing-animation span {
    width: 5px;
    height: 5px;
    background: var(--color-primary);
    border-radius: 50%;
    animation: dot-bounce 1.4s ease-in-out infinite;
  }

  .typing-animation span:nth-child(2) {
    animation-delay: 0.16s;
  }
  .typing-animation span:nth-child(3) {
    animation-delay: 0.32s;
  }

  @keyframes dot-bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-5px);
      opacity: 1;
    }
  }

  .streaming-text {
    color: var(--color-primary);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .input-container {
    padding: var(--space-3) var(--space-4) var(--space-4);
    position: relative;
    z-index: 20;
    border-top: 1px solid oklch(from var(--color-border) l c h / 0.15);
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface);
    border: 1px solid oklch(from var(--color-border) l c h / 0.4);
    border-radius: var(--radius-xl);
    transition: all var(--transition-interactive);
    box-shadow: 0 2px 12px oklch(0% 0 0 / 0.06);
    max-width: 100%;
  }

  .input-wrapper:focus-within {
    border-color: var(--color-primary);
    box-shadow:
      0 0 0 3px var(--accent-glow),
      0 4px 16px oklch(0% 0 0 / 0.08);
    background: oklch(from var(--color-surface) l c h / 1);
  }

  textarea {
    flex: 1;
    background: transparent;
    border: none;
    padding: var(--space-2) var(--space-1);
    resize: none;
    min-height: 26px;
    max-height: 300px;
    font-size: var(--text-base);
    line-height: 1.5;
    color: var(--color-text);
    box-shadow: none;
  }

  textarea:focus {
    box-shadow: none;
    background: transparent;
  }

  textarea::placeholder {
    color: var(--color-text-muted);
    opacity: 0.5;
    font-style: italic;
  }

  .send-btn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-radius: var(--radius-md);
    margin-bottom: 2px;
    margin-right: 2px;
    transition: all var(--transition-bounce);
    box-shadow: 0 2px 8px oklch(from var(--color-primary) l c h / 0.2);
  }

  .send-btn:hover:not(:disabled) {
    transform: scale(1.08);
    background: var(--color-primary-hover);
    box-shadow: 0 4px 16px oklch(from var(--color-primary) l c h / 0.45);
  }

  .send-btn:disabled {
    background: var(--color-surface-2);
    color: var(--color-text-muted);
    transform: none;
    box-shadow: none;
  }

  .abort-btn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    background: var(--color-error);
    color: white;
    border-radius: var(--radius-md);
    margin-bottom: 2px;
    margin-right: 2px;
    transition: all var(--transition-bounce);
    box-shadow: 0 2px 8px oklch(from var(--color-error) l c h / 0.3);
  }

  .abort-btn:hover {
    transform: scale(1.08);
    box-shadow: 0 4px 16px oklch(from var(--color-error) l c h / 0.5);
  }

  /* ── Status bar ── */

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 var(--space-4);
    background: oklch(from var(--color-surface) l c h / 0.5);
    border-top: 1px solid oklch(from var(--color-border) l c h / 0.15);
    flex-shrink: 0;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted);
    cursor: default;
    white-space: nowrap;
  }

  .status-item svg {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .status-item:hover {
    color: var(--color-text);
  }

  .status-item:hover svg {
    opacity: 0.8;
  }

  .token-label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 9px;
    opacity: 0.6;
  }

  .token-value {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    color: var(--color-text);
    font-size: 10px;
  }

  .status-sep {
    color: oklch(from var(--color-border) l c h / 0.3);
    font-size: 10px;
    user-select: none;
  }

  .attach-btn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    margin-bottom: 2px;
    transition: all var(--transition-interactive);
  }

  .attach-btn:hover:not(:disabled) {
    background: var(--surface-tint);
    color: var(--color-primary);
    border-color: oklch(from var(--color-primary) l c h / 0.2);
  }

  .attach-btn:disabled {
    opacity: 0.4;
  }

  /* Autocomplete dropdown */
  .autocomplete-dropdown {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    left: var(--space-4);
    right: var(--space-4);
    background: var(--color-surface);
    border: 1px solid oklch(from var(--color-primary) l c h / 0.2);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 30px oklch(0% 0 0 / 0.2);
    max-height: 220px;
    overflow-y: auto;
    z-index: 100;
    animation: dropdown-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: none;
    text-align: left;
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--accent-glow);
    color: var(--color-primary);
  }

  .autocomplete-item svg {
    opacity: 0.5;
    flex-shrink: 0;
  }

  /* Slash commands dropdown */
  .slash-commands-dropdown {
    max-height: 280px;
  }

  .slash-command-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: var(--space-2) var(--space-4);
  }

  .slash-cmd-name {
    font-weight: 700;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .slash-cmd-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  /* Scroll-to-bottom floating button */
  .scroll-bottom-btn {
    position: absolute;
    bottom: calc(var(--space-16) + var(--space-4));
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 36px;
    background: var(--color-surface);
    border: 1px solid oklch(from var(--color-primary) l c h / 0.3);
    border-radius: var(--radius-full);
    color: var(--color-primary);
    box-shadow: 0 4px 16px oklch(0% 0 0 / 0.15);
    z-index: 15;
    animation: scroll-btn-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    transition: all var(--transition-interactive);
  }

  @keyframes scroll-btn-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .scroll-bottom-btn:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-color: var(--color-primary);
    box-shadow: 0 4px 20px oklch(from var(--color-primary) l c h / 0.4);
  }
</style>
