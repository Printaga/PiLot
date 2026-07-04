<script lang="ts">
  import MessageBubble from "./MessageBubble.svelte";
  import { tick } from "svelte";
  import VoiceCapture from "./VoiceCapture.svelte";
  import ContextIndicator from "./ContextIndicator.svelte";
  import ResourceBadge from "./ResourceBadge.svelte";
  import HelpTooltip from "./HelpTooltip.svelte";
  import StatusLine from "./StatusLine.svelte";
  import type { ImageContent, Message } from "../types/index";

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
  interface PromptTemplate {
    name: string;
    description?: string;
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
    prompts: PromptTemplate[];
    promptCount: number;
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
    prompts: [],
    promptCount: 0,
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
    inputText?: string;
    inputImages?: ImageContent[];
    tokensIn?: number;
    tokensOut?: number;
    tokensTotal?: number;
    tokensCacheRead?: number;
    contextPercent?: number | null;
    contextTokens?: number | null;
    contextWindow?: number;
    editRequestIndex?: number | null;
    autoCompaction?: boolean;
    onCompact?: () => void;
    onEditMessage?: (index: number, newText: string) => void;
    onForkMessage?: (entryId: string) => void;
    onShowExport?: () => void;
    onShowPromptTemplates?: () => void;
    previousResourceCount?: Record<string, number>;
    activityStatuses?: Record<
      string,
      { text: string; type: "extension" | "tool" | "system"; timestamp: number }
    >;
    footerCwd?: string;
    footerGitBranch?: string | null;
    footerSessionName?: string | null;
    isBinaryAvailable?: boolean;
    piCliVersion?: string | null;
  }

  let {
    editRequestIndex = null,
    messages,
    isStreaming,
    onSend,
    onNewSession,
    onAbort = () => {},
    sessionResources = null,
    onToggleVoice = () => {},
    isListening = false,
    inputText = $bindable(""),
    inputImages = $bindable([] as ImageContent[]),
    tokensIn = 0,
    tokensOut = 0,
    tokensTotal = 0,
    tokensCacheRead = 0,
    contextPercent = null,
    contextTokens = null,
    contextWindow = 0,
    autoCompaction = true,
    onCompact = () => {},
    onEditMessage = () => {},
    onForkMessage = () => {},
    onShowExport = () => {},
    onShowPromptTemplates = () => {},
    previousResourceCount = {},
    activityStatuses = {},
    footerCwd = "",
    footerGitBranch = null,
    footerSessionName = null,
    isBinaryAvailable = false,
    piCliVersion = null,
  }: Props = $props();

  // Setup status: shown in empty state, content adapts after ready data arrives

  let messagesContainer: HTMLDivElement | null = null;
  let transcriptWindowSize = $state(100);
  let visibleMessageCount = $state(100);
  let files = $state<string[]>([]);
  let isDragging = $state(false);
  let showAutocomplete = $state(false);
  let autocompleteQuery = $state("");
  let selectedIndex = $state(0);
  let textareaEl: HTMLTextAreaElement | null = null;
  let lastAutoTextareaHeight = 0;
  let userResizedTextarea = false;
  let showScrollBtn = $state(false);
  let userScrolledUp = false;

  // Chat search state
  let searchQuery = $state("");
  let showSearch = $state(false);
  let currentSearchIdx = $state(0);

  // Message editing state (Feature 7)
  let editingMessageIndex = $state<number | null>(null);
  let editText = $state("");

  // Handle edit-last-message request from VS Code command
  $effect(() => {
    const idx = editRequestIndex;
    if (idx !== null && idx !== undefined) {
      tick().then(() => {
        startEditFromIndex(idx);
      });
    }
  });

  const resources = $derived(sessionResources ?? emptySessionResources);
  const hasSessionResources = $derived(
    Boolean(
      resources.contextFileCount > 0 ||
        resources.skillCount > 0 ||
        resources.promptCount > 0 ||
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
      ? resources.skills.map((s, i) => `${i + 1}. ${s.name}`).join("\n")
      : "No skills loaded",
  );
  const promptsTitle = $derived(
    resources.prompts.length > 0
      ? resources.prompts
          .map(
            (p, i) =>
              `${i + 1}. ${p.name}${p.description ? ` — ${p.description}` : ""}`,
          )
          .join("\n")
      : "No prompts loaded",
  );
  const packagesTitle = $derived(
    resources.packages.length > 0
      ? resources.packages.map((pkg, i) => `${i + 1}. ${pkg.source}`).join("\n")
      : "No packages loaded",
  );

  let mediaIcon = $state("");
  let mediaKofi = $state("");

  $effect(() => {
    if (typeof window !== "undefined") {
      mediaIcon = (window as any).__MEDIA_ICON__ || "";
      mediaKofi = (window as any).__MEDIA_KOFI__ || "";
    }
  });

  const visibleMessages = $derived(messages.slice(-visibleMessageCount));
  const hasMoreMessages = $derived(messages.length > visibleMessageCount);
  const filteredFiles = $derived(
    files
      .filter((f) => f.toLowerCase().includes(autocompleteQuery.toLowerCase()))
      .slice(0, 20),
  );

  // Auto-scroll logic
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
    if (messagesContainer)
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    showScrollBtn = false;
  }

  function handleMessagesScroll() {
    const el = messagesContainer;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp = !isNearBottom;
    showScrollBtn = !isNearBottom && el.scrollHeight > el.clientHeight + 80;
  }

  // Handle messages from extension
  $effect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data;
      if (type === "add-file-to-chat") addPathToInput(data.path);
      if (type === "workspace-files") files = data.files || [];
      if (type === "files-attached") {
        if (data?.paths && data.paths.length > 0) {
          const cursorPos = textareaEl?.selectionStart || inputText.length;
          const textBeforeCursor = inputText.slice(0, cursorPos);
          const textAfterCursor = inputText.slice(cursorPos);
          const fileMentions = data.paths.map((p: string) => "@" + p).join(" ");
          inputText =
            textBeforeCursor +
            (textBeforeCursor ? " " : "") +
            fileMentions +
            " " +
            textAfterCursor;
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Voice transcriptions
  $effect(() => {
    function handleVoiceTranscription(event: CustomEvent<string>) {
      const text = event.detail;
      if (!text) return;
      textareaEl?.focus();
      const cursorPos = textareaEl?.selectionStart || inputText.length;
      inputText =
        inputText.slice(0, cursorPos) + text + inputText.slice(cursorPos);
      closeAutocomplete();
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

  $effect(() => {
    if (!textareaEl) return;
    lastAutoTextareaHeight = textareaEl.getBoundingClientRect().height;
  });

  function handleSubmit() {
    const text = inputText.trim();
    const hasImages = inputImages.length > 0;
    if (!text && !hasImages) return;

    const imagesToSend = hasImages ? [...inputImages] : undefined;
    inputImages = [];
    onSend(text, imagesToSend);
    inputText = "";
    visibleMessageCount = transcriptWindowSize;
  }

  // Message editing (Feature 7)
  function startEditFromIndex(index: number) {
    const msg = messages[index];
    if (msg && msg.role === "user") {
      editingMessageIndex = index;
      editText = typeof msg.content === "string" ? msg.content : "";
      // Scroll the message into view
      tick().then(() => {
        const el = document.querySelector(`[data-msg-index="${index}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  function cancelEdit() {
    editingMessageIndex = null;
    editText = "";
  }

  function saveEdit() {
    if (editingMessageIndex !== null && editText.trim()) {
      onEditMessage(editingMessageIndex, editText);
      editingMessageIndex = null;
      editText = "";
    }
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === "Escape") {
      cancelEdit();
    }
  }

  function focusSearchInput() {
    requestAnimationFrame(() => {
      const si =
        messagesContainer?.querySelector<HTMLInputElement>(".search-input");
      si?.focus();
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      showSearch = !showSearch;
      if (!showSearch) searchQuery = "";
      if (showSearch) focusSearchInput();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showAutocomplete && filteredFiles.length > 0) {
        selectFile(filteredFiles[selectedIndex]);
        return;
      }
      handleSubmit();
    }
    if (e.key === "Escape") {
      if (showSearch) {
        showSearch = false;
        searchQuery = "";
        return;
      }
      if (showAutocomplete) {
        e.preventDefault();
        closeAutocomplete();
      }
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

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Ignore keydowns from the textarea (handled by handleKeydown)
    if (e.target === textareaEl) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      showSearch = !showSearch;
      if (!showSearch) searchQuery = "";
      if (showSearch) focusSearchInput();
    }
  }

  const searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages
      .map((m, i) => ({ index: i, message: m }))
      .filter(({ message }) => message.content.toLowerCase().includes(q));
  });

  // Reset search nav index when query changes
  $effect(() => {
    searchQuery;
    currentSearchIdx = 0;
  });

  function goToNextMatch() {
    if (searchResults.length <= 1) return;
    currentSearchIdx = (currentSearchIdx + 1) % searchResults.length;
    scrollToMatch(searchResults[currentSearchIdx].index);
  }

  function goToPrevMatch() {
    if (searchResults.length <= 1) return;
    currentSearchIdx =
      (currentSearchIdx - 1 + searchResults.length) % searchResults.length;
    scrollToMatch(searchResults[currentSearchIdx].index);
  }

  function scrollToMatch(msgIndex: number) {
    if (!messagesContainer) return;
    // Auto-expand visible range if target message is hidden
    if (msgIndex < messages.length - visibleMessageCount) {
      visibleMessageCount = messages.length - msgIndex + 10;
      // Wait for Svelte to render the newly visible messages before scrolling
      requestAnimationFrame(() => {
        if (!messagesContainer) return;
        const el2 = messagesContainer.querySelector(
          `[data-msg-index="${msgIndex}"]`,
        );
        if (el2) el2.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const el = messagesContainer.querySelector(
      `[data-msg-index="${msgIndex}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleInput() {
    const cursorPos = textareaEl?.selectionStart || 0;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@\S*$/);

    if (atMatch) {
      autocompleteQuery = atMatch[1] || "";
      showAutocomplete = true;
      selectedIndex = 0;
      if (files.length === 0) requestWorkspaceFiles();
      return;
    }
    closeAutocomplete();
  }

  function requestWorkspaceFiles() {
    const vscode = (window as any).vscode;
    if (vscode?.postMessage)
      vscode.postMessage({ type: "get-workspace-files" });
  }

  function closeAutocomplete() {
    showAutocomplete = false;
    autocompleteQuery = "";
  }

  function handleAttachFile() {
    const vscode = (window as any).vscode;
    if (vscode?.postMessage)
      vscode.postMessage({ type: "openFileAttachmentDialog" });
  }

  // Drag-and-drop
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) isDragging = true;
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (target && !target.contains(related)) isDragging = false;
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    const files_list = e.dataTransfer?.files;
    if (!files_list || files_list.length === 0) return;
    for (let i = 0; i < files_list.length; i++) {
      const file = files_list[i];
      if (file.type.startsWith("image/")) readImageFile(file);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) readImageFile(blob, "clipboard");
        break;
      }
    }
  }

  function readImageFile(file: File, name?: string) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      const base64Match = data.match(/^data:([^;]+);base64,(.+)$/);
      if (base64Match) {
        inputImages = [
          ...inputImages,
          {
            type: "image",
            data: base64Match[2],
            mimeType: base64Match[1],
            name: name || file.name || "pasted-image",
          },
        ];
      }
    };
    reader.readAsDataURL(file);
  }

  function removeImage(index: number) {
    inputImages = inputImages.filter((_, i) => i !== index);
  }
  function getImageDataUrl(img: ImageContent): string {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  function addPathToInput(path: string) {
    if (!textareaEl) return;
    const cursorPos = textareaEl.selectionStart || inputText.length;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const textAfterCursor = inputText.slice(cursorPos);
    const match = textBeforeCursor.match(/@\S*$/);
    if (match && match.index !== undefined) {
      inputText =
        inputText.slice(0, match.index) + "@" + path + " " + textAfterCursor;
      closeAutocomplete();
    } else {
      inputText =
        textBeforeCursor +
        (textBeforeCursor ? " " : "") +
        "@" +
        path +
        " " +
        textAfterCursor;
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
    const match = textBeforeCursor.match(/@\S*$/);
    if (match && match.index !== undefined) {
      inputText =
        inputText.slice(0, match.index) +
        "@" +
        filepath +
        " " +
        textAfterCursor;
      closeAutocomplete();
      setTimeout(() => textareaEl?.focus(), 0);
    }
  }

  function handleShowMore() {
    visibleMessageCount = Math.min(
      visibleMessageCount + transcriptWindowSize,
      messages.length,
    );
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="chat-panel" onkeydown={handleGlobalKeydown} role="application">
  {#if hasSessionResources}
    <div class="resources-info">
      <span class="resources-header">CONTEXT</span>
      <div class="resources-grid">
        <ResourceBadge
          type="files"
          count={resources.contextFileCount}
          previousCount={previousResourceCount.files}
          title={contextTitle}
        />
        <ResourceBadge
          type="skills"
          count={resources.skillCount}
          previousCount={previousResourceCount.skills}
          title={skillsTitle}
        />
        <ResourceBadge
          type="prompts"
          count={resources.promptCount}
          previousCount={previousResourceCount.prompts}
          title={promptsTitle}
        />
        <ResourceBadge
          type="packages"
          count={resources.packageCount}
          previousCount={previousResourceCount.packages}
          title={packagesTitle}
        />
      </div>
      <HelpTooltip
        text="Resources loaded in the current session. Badges pulse when resources change."
        title="Session Resources"
        position="bottom"
      />
    </div>
  {/if}

  {#if isDragging}
    <div
      class="drop-zone-overlay"
      role="dialog"
      aria-label="Drop zone for images"
      tabindex="0"
      ondragover={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      <div class="drop-zone-content">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
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
    {#if showSearch}
      <div class="search-bar">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          ><circle cx="11" cy="11" r="8" /><line
            x1="21"
            y1="21"
            x2="16.65"
            y2="16.65"
          /></svg
        >
        <input
          type="text"
          placeholder="Search messages... (Ctrl+F)"
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchResults.length > 0}
          <button
            class="search-nav"
            onclick={goToPrevMatch}
            aria-label="Previous match"
            disabled={searchResults.length <= 1}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"><polyline points="15 18 9 12 15 6" /></svg
            >
          </button>
          <span class="search-count"
            >{currentSearchIdx + 1}/{searchResults.length}</span
          >
          <button
            class="search-nav"
            onclick={goToNextMatch}
            aria-label="Next match"
            disabled={searchResults.length <= 1}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"><polyline points="9 18 15 12 9 6" /></svg
            >
          </button>
        {:else}
          <span class="search-count">0 matches</span>
        {/if}
        <button
          class="search-close"
          onclick={() => {
            showSearch = false;
            searchQuery = "";
          }}
          aria-label="Close search"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            ><line x1="18" y1="6" x2="6" y2="18" /><line
              x1="6"
              y1="6"
              x2="18"
              y2="18"
            /></svg
          >
        </button>
      </div>
    {/if}
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
          >. Type a message below to start.
        </p>

        {#if piCliVersion && isBinaryAvailable}
          <div class="setup-card ready">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-success)"
              stroke-width="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>PI CLI <span class="version-tag">v{piCliVersion}</span></span>
          </div>
        {:else}
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
              <HelpTooltip
                text="This extension requires the PI CLI. Install it globally with npm and ensure the 'pi' command is on your PATH."
                title="Setup Help"
              />
            </div>
            <button
              class="setup-code"
              onclick={() =>
                navigator.clipboard.writeText(
                  "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
                )}
            >
              <span class="code-prompt">$</span> npm install -g --ignore-scripts
              @earendil-works/pi-coding-agent
              <svg
                class="copy-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path
                  d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                />
              </svg>
            </button>
          </div>
        {/if}

        {#if mediaKofi}
          <div class="kofi-section">
            <span class="kofi-label">Support this project</span>
            <a
              href="https://ko-fi.com/O4H020U50P"
              target="_blank"
              rel="noopener noreferrer"
              class="kofi-link"
            >
              <img src={mediaKofi} alt="Support on Ko-fi" />
            </a>
          </div>
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
              >
                <line x1="12" y1="5" x2="12" y2="19" /><line
                  x1="5"
                  y1="12"
                  x2="19"
                  y2="12"
                />
              </svg>
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
              >
                <path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                />
              </svg>
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
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Architecture
            </button>
            <button onclick={() => onSend("Help me debug this issue")}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                />
              </svg>
              Debug Issue
            </button>
            <button
              onclick={() => onSend("Write tests for the main functionality")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="9 11 12 14 22 4" />
                <path
                  d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                />
              </svg>
              Write Tests
            </button>
          </div>
        </div>
      </div>
    {:else}
      {#if hasMoreMessages}
        <button class="show-more-btn" onclick={handleShowMore}>
          Show more ({messages.length - visibleMessageCount} older messages)
        </button>
      {/if}

      {#each visibleMessages as message, i (i)}
        <div class="message-wrapper" data-msg-index={messages.indexOf(message)}>
          <MessageBubble
            {message}
            searchQuery={showSearch ? searchQuery : ""}
            {onForkMessage}
          />
        </div>
      {/each}

      <!-- Editing overlay (Feature 7) -->
      {#if editingMessageIndex !== null}
        <div class="edit-message-overlay">
          <div class="edit-message-card">
            <div class="edit-header">
              <span class="edit-title">Edit Message</span>
              <button
                class="edit-close"
                onclick={cancelEdit}
                aria-label="Close edit"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" /><line
                    x1="6"
                    y1="6"
                    x2="18"
                    y2="18"
                  />
                </svg>
              </button>
            </div>
            <textarea
              bind:value={editText}
              onkeydown={handleEditKeydown}
              class="edit-textarea"
              rows="3"
            ></textarea>
            <div class="edit-actions">
              <button class="edit-cancel-btn" onclick={cancelEdit}
                >Cancel</button
              >
              <button
                class="edit-save-btn"
                onclick={saveEdit}
                disabled={!editText.trim()}>Save & Resend</button
              >
            </div>
          </div>
        </div>
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

    <button
      class="scroll-bottom-btn"
      class:visible={showScrollBtn}
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
  </div>

  <div
    class="input-container"
    role="region"
    aria-label="Chat input area"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if inputImages.length > 0}
      <div class="image-preview-bar">
        {#each inputImages as img, i}
          <div class="image-preview-item">
            <img
              src={getImageDataUrl(img)}
              alt={img.name || "Attached image"}
              class="image-preview-thumb"
            />
            <button
              class="image-preview-remove"
              onclick={() => removeImage(i)}
              title="Remove image"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
              >
                <line x1="18" y1="6" x2="6" y2="18" /><line
                  x1="6"
                  y1="6"
                  x2="18"
                  y2="18"
                />
              </svg>
            </button>
            <span class="image-preview-name">{img.name || "image"}</span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="input-wrapper">
      <div class="input-actions">
        <VoiceCapture {isListening} onToggle={onToggleVoice} />
        <button
          class="action-btn"
          onclick={onShowPromptTemplates}
          title="Prompt Templates"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line
              x1="3"
              y1="9"
              x2="21"
              y2="9"
            /><line x1="9" y1="21" x2="9" y2="9" />
          </svg>
        </button>
        <button
          class="action-btn"
          onclick={handleAttachFile}
          title="Attach file (Ctrl+Shift+A)"
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
              d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
            />
          </svg>
        </button>
        <button
          class="action-btn"
          onclick={onShowExport}
          title="Export session"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        oninput={(e) => {
          const el = e.currentTarget;
          const currentHeight = el.getBoundingClientRect().height;
          if (
            lastAutoTextareaHeight > 0 &&
            Math.abs(currentHeight - lastAutoTextareaHeight) > 4
          ) {
            userResizedTextarea = true;
          }

          const maxHeight = 320;
          if (userResizedTextarea) {
            const desired = Math.min(el.scrollHeight, maxHeight);
            if (desired > currentHeight + 1) {
              el.style.height = `${desired}px`;
              lastAutoTextareaHeight = desired;
            }
          } else {
            el.style.height = "auto";
            const desired = Math.min(el.scrollHeight, maxHeight);
            el.style.height = `${desired}px`;
            lastAutoTextareaHeight = desired;
          }
          handleInput();
        }}
        placeholder="Type a message... @ to mention files"
        rows="4"
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
        disabled={!inputText.trim() && inputImages.length === 0}
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
          <rect x="2" y="4" width="20" height="16" rx="2" /><polyline
            points="2 10 22 10"
          />
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
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle
            cx="9"
            cy="7"
            r="4"
          />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path
            d="M16 3.13a4 4 0 0 1 0 7.75"
          />
        </svg>
        <span class="token-label">Total</span>
        <span class="token-value">{tokensTotal.toLocaleString()}</span>
      </span>
      <ContextIndicator
        percent={contextPercent}
        {contextTokens}
        {contextWindow}
        {autoCompaction}
        {onCompact}
      />
    </div>
  </div>
  <StatusLine
    cwd={footerCwd}
    gitBranch={footerGitBranch}
    sessionName={footerSessionName}
    activities={activityStatuses}
  />
</div>

<style>
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
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
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
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    background: oklch(from var(--color-primary) l c h / 0.03);
    border-bottom: 1px solid oklch(from var(--color-border) l c h / 0.15);
    position: relative;
    z-index: 10;
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
    gap: var(--space-1);
    flex-wrap: wrap;
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

  .messages :global(.search-bar) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 0;
    margin-bottom: var(--space-2);
    flex-shrink: 0;
  }
  .messages :global(.search-bar svg) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .messages :global(.search-input) {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    outline: none;
  }
  .messages :global(.search-count) {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }
  .messages :global(.search-close) {
    display: flex;
    align-items: center;
    padding: 2px;
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: 0;
  }
  .messages :global(.search-close:hover) {
    color: var(--color-primary);
  }
  .messages :global(.search-nav) {
    display: flex;
    align-items: center;
    padding: 2px;
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: 0;
  }
  .messages :global(.search-nav:hover) {
    color: var(--color-primary);
  }
  .messages :global(.search-nav:disabled) {
    opacity: 0.3;
    cursor: default;
  }
  .messages :global(.search-highlight) {
    background: oklch(from var(--color-warning) l c h / 0.3);
    color: var(--color-text);
    padding: 0 1px;
    border-radius: 2px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--space-8);
    gap: var(--space-5);
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
    margin-bottom: var(--space-3);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    border: 2px solid var(--color-border);
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
  .kofi-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .kofi-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    opacity: 0.5;
  }
  .kofi-link {
    display: inline-block;
    transition: transform var(--transition-interactive);
  }
  .kofi-link:hover {
    transform: scale(1.05);
  }
  .kofi-link img {
    height: 28px;
    width: auto;
  }
  .empty-state h1 {
    font-size: var(--text-2xl);
    font-weight: 800;
    letter-spacing: -0.03em;
    font-family: var(--font-display);
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

  .setup-card {
    background: oklch(from var(--color-surface) l c h / 0.6);
    border: 1px solid oklch(from var(--color-border) l c h / 0.25);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
    max-width: 480px;
    width: 100%;
    text-align: left;
    transition: all var(--transition-interactive);
  }
  .setup-card.ready {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    border-color: oklch(from var(--color-success) l c h / 0.25);
    background: oklch(from var(--color-success) l c h / 0.06);
  }
  .setup-card.ready svg {
    flex-shrink: 0;
  }
  .version-tag {
    color: var(--color-text);
    font-weight: 700;
    font-family: var(--font-mono);
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

  .quick-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
    width: 100%;
    max-width: 340px;
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

  /* ── Message wrapper with edit button ───────────────── */
  .message-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* ── Edit message overlay ───────────────── */
  .edit-message-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: oklch(from var(--color-bg) l c h / 0.7);
    backdrop-filter: blur(4px);
  }
  .edit-message-card {
    width: 400px;
    max-width: 90%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: 0 16px 48px oklch(0% 0 0 / 0.3);
  }
  .edit-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .edit-title {
    font-weight: 700;
    font-size: var(--text-sm);
  }
  .edit-close {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
  }
  .edit-close:hover {
    background: var(--surface-tint);
    color: var(--color-text);
  }
  .edit-textarea {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .edit-cancel-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }
  .edit-save-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .edit-save-btn:hover:not(:disabled) {
    filter: brightness(1.1);
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
    border-top: 2px solid var(--color-border);
    background: var(--color-bg);
  }
  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    border-radius: 0;
    transition: all var(--transition-fast);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
    max-width: 100%;
  }
  .input-wrapper:focus-within {
    border-color: var(--color-primary);
    box-shadow: 4px 4px 0px var(--color-primary);
    background: var(--color-surface);
    transform: translate(-2px, -2px);
  }
  textarea {
    flex: 1;
    background: transparent;
    border: none;
    padding: var(--space-2) var(--space-1);
    resize: vertical;
    overflow-y: auto;
    min-height: 100px;
    max-height: 40vh;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--color-text);
    box-shadow: none;
    vertical-align: top;
  }
  textarea:focus {
    box-shadow: none;
    background: transparent;
    transform: none;
  }
  textarea::placeholder {
    color: var(--color-text-muted);
    opacity: 0.5;
    font-style: italic;
  }

  .input-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 0 0 2px 0;
    flex-shrink: 0;
  }

  .input-actions :global(.voice-btn) {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 0;
  }

  .action-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 0;
    color: var(--color-text-muted);
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .action-btn:hover:not(:disabled) {
    background: var(--color-surface);
    color: var(--color-primary);
    border-color: var(--color-primary);
    transform: translate(-2px, -2px);
    box-shadow: 2px 2px 0px var(--color-primary);
  }

  .send-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border: 2px solid var(--color-primary);
    border-radius: 0;
    transition: all var(--transition-fast);
    box-shadow: 2px 2px 0px rgba(0, 0, 0, 1);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .send-btn:hover:not(:disabled) {
    transform: translate(-2px, -2px);
    background: var(--color-primary-hover);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 1);
  }
  .send-btn:disabled {
    background: var(--color-surface-2);
    border-color: var(--color-border);
    color: var(--color-text-muted);
    transform: none;
    box-shadow: none;
  }
  .abort-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: var(--color-error);
    color: white;
    border: 2px solid var(--color-error);
    border-radius: 0;
    transition: all var(--transition-fast);
    box-shadow: 2px 2px 0px rgba(0, 0, 0, 1);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .abort-btn:hover {
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 1);
  }

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 var(--space-4);
    background: var(--color-surface-2);
    border-top: 1px solid var(--color-border);
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
    font-family: var(--font-display);
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
    letter-spacing: 0.04em;
    font-size: 9px;
    opacity: 0.6;
  }
  .token-value {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--color-text);
    font-size: 10px;
  }
  .status-sep {
    color: var(--color-border);
    font-size: 10px;
    user-select: none;
  }

  .autocomplete-dropdown {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    left: var(--space-4);
    right: var(--space-4);
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    border-radius: 0;
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 1);
    max-height: 220px;
    overflow-y: auto;
    z-index: 100;
  }
  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }
  .autocomplete-item svg {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .show-more-btn {
    padding: var(--space-2) var(--space-4);
    text-align: center;
    color: var(--color-primary);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: 600;
    border-radius: 0;
    border: 1px solid var(--color-primary);
    background: transparent;
    cursor: pointer;
    transition: all var(--transition-fast);
    align-self: center;
  }
  .show-more-btn:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    transform: translate(-2px, -2px);
    box-shadow: 2px 2px 0px rgba(0, 0, 0, 1);
  }

  .scroll-bottom-btn {
    position: sticky;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 32px;
    background: var(--color-surface);
    border: 2px solid var(--color-primary);
    border-radius: 0;
    color: var(--color-primary);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 1);
    z-index: 15;
    margin: 0 auto;
    flex-shrink: 0;
    transition: all var(--transition-fast);
    opacity: 0;
    pointer-events: none;
    align-self: center;
  }
  .scroll-bottom-btn.visible {
    opacity: 1;
    pointer-events: auto;
  }
  .scroll-bottom-btn:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    transform: translateX(-50%) translateY(-2px);
    box-shadow: 6px 6px 0px rgba(0, 0, 0, 1);
  }
</style>
