<script lang="ts">
  import type { ImageContent, Message, ToolCallMessage } from "../types/index";

  interface CodeBlock {
    language: string;
    code: string;
    isMermaid: boolean;
  }

  interface Props {
    message: Message;
    searchQuery?: string;
  }

  let { message, searchQuery = "" }: Props = $props();

  let searchRegex = $derived.by(() => {
    if (!searchQuery.trim()) return undefined;
    const q = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(${q})`, "gi");
  });

  let thinkingExpanded = $state(false);
  let toolExpanded: Record<string, boolean> = $state({});
  let lightboxImage = $state<string | null>(null);
  let copiedCode = $state(false);
  let copiedMessage = $state(false);
  let showAbsoluteTime = $state(false);

  function openLightbox(dataUrl: string) {
    lightboxImage = dataUrl;
  }

  function closeLightbox() {
    lightboxImage = null;
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    copiedCode = true;
    setTimeout(() => (copiedCode = false), 1500);
  }

  function applyCode(code: string) {
    (window as any).vscode?.postMessage({
      type: "apply-code",
      data: { code },
    });
  }

  function previewDiff(code: string) {
    (window as any).vscode?.postMessage({
      type: "preview-diff",
      data: { code },
    });
  }

  function copyMessage() {
    navigator.clipboard.writeText(message.content);
    copiedMessage = true;
    setTimeout(() => (copiedMessage = false), 1500);
  }

  function openInEditor(code: string, language: string) {
    (window as any).vscode?.postMessage({
      type: "open-in-editor",
      data: { content: code, language },
    });
  }

  function toggleTimeFormat() {
    showAbsoluteTime = !showAbsoluteTime;
  }

  function getImageDataUrl(img: ImageContent): string {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const diffMin = Math.floor((now - timestamp) / 60000);
    if (showAbsoluteTime) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        " " + date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    if (diffMin < 1) return "now";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function toggleTool(toolCallId: string) {
    toolExpanded = { ...toolExpanded, [toolCallId]: !toolExpanded[toolCallId] };
  }

  // Initialize completed tools as collapsed by default
  // Use $state.snapshot() to read toolExpanded without creating reactive dependency
  // This breaks the circular read-write cycle that Svelte 5 $state creates
  $effect(() => {
    if (message.role === "system" && message.toolCalls) {
      const expanded = $state.snapshot(toolExpanded);
      const updates: Record<string, boolean> = {};
      for (const tc of message.toolCalls) {
        if (tc.status === "complete" && !(tc.toolCallId in expanded)) {
          updates[tc.toolCallId] = false;
        }
      }
      const keys = Object.keys(updates);
      if (keys.length > 0) {
        // Spread snapshot, not reactive proxy, to avoid creating new dependencies
        toolExpanded = { ...expanded, ...updates };
      }
    }
  });

  function parseContent(content: string): Array<string | CodeBlock> {
    const parts: Array<string | CodeBlock> = [];
    let lastIndex = 0;
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      parts.push({
        language: match[1] || "text",
        code: match[2],
        isMermaid: (match[1] || "") === "mermaid",
      });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }
    return parts;
  }

  function formatToolArgs(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null) {
        parts.push(`${key}=${formatArgValue(value)}`);
      }
    }
    return parts.slice(0, 5).join(" ");
  }

  function formatArgValue(value: unknown): string {
    if (typeof value === "string") {
      const display = value.length > 60 ? value.slice(0, 57) + "..." : value;
      return `"${display}"`;
    }
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return `[${value.length}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value).length}}`;
    return String(value);
  }

  const toolIconPaths: Record<string, string> = {
    read: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
    edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.12 2.12 0 0 1 3 3L12 16l-4 1 1-4z",
    write:
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6",
    bash: "M4 6h16M4 12h16M4 18h12",
    grep: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    find: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    ls: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  };
  const defaultToolIconPath =
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";
  const clipboardSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Render a markdown string to HTML. Handles the rich formatting the PI agent outputs. */
  function renderMarkdown(md: string, searchRegex?: RegExp): string {
    // Split out fenced code blocks first (they must not be processed)
    const codeBlocks: string[] = [];
    let processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
      codeBlocks.push(
        `<pre class="md-code"><code>${escapeHtml(code.trimEnd())}</code></pre>`,
      );
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });

    // Split into paragraphs (double newlines)
    const paragraphs = processed.split(/\n\n+/);
    const htmlParts: string[] = [];

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(trimmed)) {
        htmlParts.push('<hr class="md-hr">');
        continue;
      }

      // Headers
      let headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const slug = headerMatch[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        htmlParts.push(
          `<h${level} class="md-h" id="${slug}">${renderInline(headerMatch[2], searchRegex)}</h${level}>`,
        );
        continue;
      }

      // Blockquote
      if (trimmed.startsWith("> ")) {
        const lines = trimmed.split("\n");
        const quoteText = lines.map((l) => l.replace(/^> ?/, "")).join("<br>");
        htmlParts.push(
          `<blockquote class="md-quote">${renderInline(quoteText, searchRegex)}</blockquote>`,
        );
        continue;
      }

      // Unordered list
      if (/^[-*+]\s/.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter((l) => /^[-*+]\s/.test(l))
          .map((l) => `<li>${renderInline(l.replace(/^[-*+]\s+/, ""), searchRegex)}</li>`);
        htmlParts.push(`<ul class="md-ul">${items.join("")}</ul>`);
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter((l) => /^\d+\.\s/.test(l))
          .map((l) => `<li>${renderInline(l.replace(/^\d+\.\s+/, ""), searchRegex)}</li>`);
        htmlParts.push(`<ol class="md-ol">${items.join("")}</ol>`);
        continue;
      }

      // Table
      if (trimmed.includes("|") && /^\|?\s*[-:]+/.test(trimmed.split("\n")[1] || "")) {
        const rows = trimmed.split("\n").filter(l => l.includes("|"));
        if (rows.length >= 2) {
          const headerCells = rows[0].split("|").map(c => c.trim()).filter(Boolean);
          const bodyRows = rows.slice(2);
          let tableHtml = '<table class="md-table"><thead><tr>';
          for (const cell of headerCells) tableHtml += `<th>${renderInline(cell, searchRegex)}</th>`;
          tableHtml += '</tr></thead><tbody>';
          for (const row of bodyRows) {
            const cells = row.split("|").map(c => c.trim()).filter(Boolean);
            tableHtml += '<tr>';
            for (const cell of cells) tableHtml += `<td>${renderInline(cell, searchRegex)}</td>`;
            tableHtml += '</tr>';
          }
          tableHtml += '</tbody></table>';
          htmlParts.push(tableHtml);
          continue;
        }
      }

      // Regular paragraph
      htmlParts.push(`<p class="md-p">${renderInline(trimmed, searchRegex)}</p>`);
    }

    let html = htmlParts.join("");
    // Restore code blocks
    html = html.replace(
      /\x00CODE(\d+)\x00/g,
      (_, i) => codeBlocks[parseInt(i)] || "",
    );
    return html;
  }

  /** Render inline markdown: bold, italic, code, links, line breaks */
  function renderInline(text: string, searchRegex?: RegExp): string {
    // Escape HTML first
    let html = escapeHtml(text);
    // Search highlight — apply after escapeHtml so <mark> tags aren't double-escaped
    if (searchRegex) {
      html = html.replace(searchRegex, '<mark class="search-highlight">$1</mark>');
    }
    // Inline code (backticks) — must process before bold/italic
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    // Links [text](url)
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>',
    );
    // Line breaks (single newlines within paragraphs)
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function renderToolResult(toolCall: ToolCallMessage): string {
    const details = toolCall.result?.details;
    const content = toolCall.result?.content || "";

    // Read tool results
    if (toolCall.toolName === "read") {
      if (details?.entries && details.entries.length > 0) {
        let html = '<div class="read-tool">';
        for (const entry of details.entries) {
          html += `<div class="read-entry">`;
          html += `<div class="read-header"><span class="read-file">${escapeHtml(entry.filePath || "")}</span></div>`;
          html += `<pre class="read-content">${escapeHtml(entry.content || "")}</pre>`;
          html += `</div>`;
        }
        html += "</div>";
        return html;
      }
    }

    // Edit tool results
    if (
      toolCall.toolName === "edit" &&
      details?.edits &&
      details.edits.length > 0
    ) {
      let html = '<div class="edit-tool">';
      for (const edit of details.edits) {
        html += `<div class="edit-entry">`;
        html += `<span class="edit-file">${escapeHtml(edit.file || "")}</span>`;
        if (edit.lines)
          html += `: <span class="edit-lines">${edit.lines}</span>`;
        if (edit.diff) {
          html += `<pre class="edit-diff">${escapeHtml(edit.diff)}</pre>`;
        }
        html += `</div>`;
      }
      html += "</div>";
      return html;
    }

    // Bash tool results
    if (toolCall.toolName === "bash") {
      if (details?.output) {
        return `<div class="bash-tool"><pre class="bash-output ${details.exitCode !== 0 ? "bash-error" : ""}">${escapeHtml(details.output)}</pre></div>`;
      }
      // Try to get output from content
      return `<div class="bash-tool"><pre class="bash-output">${escapeHtml(content)}</pre></div>`;
    }

    // Grep tool results
    if (toolCall.toolName === "grep" && details?.matches) {
      let html = '<div class="grep-tool">';
      for (const match of details.matches) {
        html += `<div class="grep-entry">`;
        html += `<span class="grep-file">${escapeHtml(match.filePath || "")}</span>`;
        html += `<pre class="grep-line">${escapeHtml(match.line || "")}</pre>`;
        html += `</div>`;
      }
      html += "</div>";
      return html;
    }

    // Find tool results
    if (toolCall.toolName === "find" && details?.files) {
      let html = '<div class="find-tool">';
      for (const file of details.files) {
        html += `<div class="find-file">${escapeHtml(file)}</div>`;
      }
      html += "</div>";
      return html;
    }

    // Ls tool results
    if (toolCall.toolName === "ls" && details?.files) {
      let html = '<div class="ls-tool">';
      for (const file of details.files) {
        html += `<div class="ls-file">${escapeHtml(file.path || file)}</div>`;
      }
      html += "</div>";
      return html;
    }

    // Write tool results
    if (toolCall.toolName === "write") {
      if (details?.bytes !== undefined) {
        return `<div class="write-tool"><span class="write-status">Wrote ${details.bytes} bytes to ${escapeHtml(details.path || "")}</span></div>`;
      }
    }

    // Generic fallback
    return `<div class="generic-tool"><pre class="tool-output">${escapeHtml(content)}</pre></div>`;
  }
</script>

<div
  class="message-bubble"
  class:user={message.role === "user"}
  class:assistant={message.role === "assistant"}
  class:system={message.role === "system"}
  class:streaming={message.isStreaming}
>
  <div class="message-header">
    <div class="message-meta">
      <span class="role-icon">
        {#if message.role === "user"}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        {:else if message.role === "assistant"}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="2" y="2" width="20" height="20" rx="6" />
            <path d="M7 8h10M12 8v8M9 16h6" stroke-linecap="round" />
          </svg>
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        {/if}
      </span>
      <span class="role-name">{message.role}</span>
    </div>
    <div class="message-actions">
      {#if message.role === "assistant" && !message.isStreaming}
        <button class="copy-msg-btn" onclick={copyMessage} title="Copy message">
          {@html clipboardSvg}
          {#if copiedMessage}<span class="copy-check">✓</span>{/if}
        </button>
      {/if}
      <button class="time-toggle" onclick={toggleTimeFormat} title="Toggle timestamp format">
        <span class="message-time">{formatTimestamp(message.timestamp)}</span>
      </button>
    </div>
  </div>

  <div class="message-content">
    {#if message.toolCalls && message.toolCalls.length > 0}
      {#each message.toolCalls as toolCall}
        <div class="tool-call {toolCall.isError ? 'tool-error' : ''}">
          <div class="tool-header">
            <span class="tool-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d={toolIconPaths[toolCall.toolName] || defaultToolIconPath}
                />
              </svg>
            </span>
            <span class="tool-name">{toolCall.toolName}</span>
            <span class="tool-args">{formatToolArgs(toolCall.args)}</span>
            <span
              class="tool-status"
              class:done={toolCall.status === "complete" && !toolCall.isError}
              class:error={toolCall.isError}
              class:running={toolCall.status !== "complete"}
              >{toolCall.status === "complete"
                ? toolCall.isError
                  ? "failed"
                  : "done"
                : "running"}</span
            >
            {#if toolCall.status === "complete"}
              <button
                class="tool-toggle"
                onclick={() => toggleTool(toolCall.toolCallId)}
                aria-label="Toggle tool output"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class:rotated={toolExpanded[toolCall.toolCallId]}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            {/if}
          </div>
          {#if toolCall.status === "complete" && toolExpanded[toolCall.toolCallId]}
            <div class="tool-body">
              {@html renderToolResult(toolCall)}
            </div>
          {:else if toolCall.status !== "complete"}
            <div class="tool-body tool-pending">
              <div class="tool-loading">Executing tool...</div>
            </div>
          {/if}
        </div>
      {/each}
    {:else if message.role === "system"}
      <div
        class="system-box"
        class:is-error={message.content.startsWith("❌")}
        class:is-warning={message.content.startsWith("⚠")}
        class:is-success={message.content.startsWith("✅")}
      >
        {#if message.content.startsWith("❌")}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-error)"
            stroke-width="2.5"
            ><circle cx="12" cy="12" r="10" /><line
              x1="15"
              y1="9"
              x2="9"
              y2="15"
            /><line x1="9" y1="9" x2="15" y2="15" /></svg
          >
        {:else if message.content.startsWith("⚠")}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-warning)"
            stroke-width="2.5"
            ><path
              d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            /><line x1="12" y1="9" x2="12" y2="13" /><line
              x1="12"
              y1="17"
              x2="12.01"
              y2="17"
            /></svg
          >
        {:else if message.content.startsWith("✅")}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-success)"
            stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg
          >
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            ><circle cx="12" cy="12" r="10" /><line
              x1="12"
              y1="8"
              x2="12"
              y2="12"
            /><line x1="12" y1="16" x2="12.01" y2="16" /></svg
          >
        {/if}
        <span>{message.content}</span>
      </div>
    {:else}
      <div class="content-body">
        {#if message.role === "assistant" && message.thinking}
          <div class="thought-container" class:expanded={thinkingExpanded}>
            <button
              class="thought-toggle"
              onclick={() => (thinkingExpanded = !thinkingExpanded)}
              aria-expanded={thinkingExpanded}
            >
              <div class="thought-header">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  class="sparkle"
                >
                  <path
                    d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 7.5 0 0 1-8.313-12.454z"
                  />
                </svg>
                <span class="thought-label">Thinking Process</span>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                class="chevron"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {#if thinkingExpanded}
              <div class="thought-content">
                {@html renderMarkdown(message.thinking)}
              </div>
            {/if}
          </div>
          {#if message.content}
            <div class="content-spacer"></div>
          {/if}
        {/if}
        <div class="text-wrapper">
          {#if message.images && message.images.length > 0}
            <div class="message-images">
              {#each message.images as img}
                <button
                  class="image-thumb-btn"
                  onclick={() => openLightbox(getImageDataUrl(img))}
                >
                  <img
                    src={getImageDataUrl(img)}
                    alt={img.name || "Attached image"}
                    class="message-image-thumb"
                  />
                </button>
              {/each}
            </div>
          {/if}
          {#each parseContent(message.content) as part}
            {#if typeof part === "string"}
              {@html renderMarkdown(part, searchRegex)}
            {:else if part.isMermaid}
              <div class="mermaid-container">
                <pre class="mermaid">{part.code}</pre>
                <span class="mermaid-label">Diagram</span>
              </div>
            {:else}
              <div class="code-block-wrapper">
                <div class="code-header">
                  <span class="code-lang">{part.language}</span>
                  <div class="code-actions">
                    <button class="code-action-btn" onclick={() => applyCode(part.code)} title="Apply to active editor">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="code-action-btn" onclick={() => previewDiff(part.code)} title="Preview diff">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="8" height="16"/><rect x="14" y="4" width="8" height="16"/></svg>
                    </button>
                    <button class="code-action-btn" onclick={() => openInEditor(part.code, part.language)} title="Open in Editor">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </button>
                    <button class="code-action-btn" onclick={() => copyCode(part.code)} title="Copy code">
                      {@html clipboardSvg}
                      {#if copiedCode}<span class="copy-check">✓</span>{/if}
                    </button>
                  </div>
                </div>
                <pre class="language-{part.language}"><code>{part.code}</code
                  ></pre>
              </div>
            {/if}
          {/each}
          {#if message.isStreaming}
            <span class="streaming-cursor"></span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Lightbox overlay -->
{#if lightboxImage}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="lightbox-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Image preview"
    tabindex="0"
    onclick={closeLightbox}
    onkeydown={(e) => e.key === "Escape" && closeLightbox()}
  >
    <button
      class="lightbox-close"
      onclick={closeLightbox}
      aria-label="Close image preview"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
    <img src={lightboxImage} alt="Full-size preview" class="lightbox-image" />
  </div>
{/if}

<style>
  .message-bubble {
    max-width: 95%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    position: relative;
    border-left: 2px solid transparent;
  }

  .user {
    align-self: flex-end;
    border-right: 4px solid var(--color-primary);
    border-left: none;
  }
  .assistant {
    align-self: flex-start;
    border-left: 4px solid var(--color-border);
  }
  .system {
    align-self: center;
    width: 100%;
    max-width: 100%;
  }

  /* ── Images in messages ────────────────────── */
  .message-images {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }

  .image-thumb-btn {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    border-radius: 0;
    overflow: hidden;
    transition: transform var(--transition-fast);
  }

  .image-thumb-btn:hover {
    transform: translate(-2px, -2px);
    box-shadow: 2px 2px 0px var(--color-primary);
  }

  .message-image-thumb {
    display: block;
    max-width: 200px;
    max-height: 200px;
    border-radius: 0;
    border: 2px solid var(--color-border);
    object-fit: contain;
    background: var(--color-bg);
  }

  /* ── Lightbox ───────────────────────────────── */
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(9, 9, 11, 0.9);
    cursor: zoom-out;
  }

  .lightbox-close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    border-radius: 0;
    color: var(--color-text);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .lightbox-close:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .lightbox-image {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 0;
    box-shadow: var(--shadow-lg);
    border: 2px solid var(--color-border);
  }

  /* ── Header ─────────────────────────────────── */
  .message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-1);
    opacity: 0.8;
  }

  .message-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .role-icon {
    width: 24px;
    height: 24px;
    border-radius: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }
  .user .role-icon {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-color: var(--color-primary);
  }
  .system .role-icon {
    background: transparent;
    color: var(--color-text-muted);
    border: none;
  }

  .role-name {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .message-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  /* ── Content bubble ─────────────────────────── */
  .message-content {
    padding: var(--space-3) var(--space-4);
    border-radius: 0;
    font-size: var(--text-base);
    line-height: 1.65;
    position: relative;
    overflow: hidden;
  }

  .user .message-content {
    background: var(--color-surface-2);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  }

  .assistant .message-content {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  }
  .assistant.streaming .message-content {
    border-color: var(--color-primary);
    box-shadow: 4px 4px 0px var(--color-primary);
  }

  /* ── System message ─────────────────────────── */
  .system-box {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-radius: 0;
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    width: fit-content;
    margin: 0 auto;
    line-height: 1.5;
  }
  .system-box.is-error {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .system-box.is-warning {
    background: rgba(234, 179, 8, 0.1);
    border-color: var(--color-warning);
    color: var(--color-warning);
  }
  .system-box.is-success {
    background: rgba(34, 197, 94, 0.1);
    border-color: var(--color-success);
    color: var(--color-success);
  }

  /* ── Tool calls ─────────────────────────────── */
  .tool-call {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 0;
    overflow: hidden;
    margin: var(--space-2) 0;
  }
  .tool-call.tool-error {
    border-color: var(--color-error);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    font-family: var(--font-display);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: default;
    user-select: none;
    border-bottom: 1px solid var(--color-border);
  }

  .tool-icon {
    display: flex;
    align-items: center;
    color: var(--color-primary);
    flex-shrink: 0;
  }

  .tool-name {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .tool-args {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .tool-status {
    flex-shrink: 0;
    font-family: var(--font-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    background: var(--color-surface);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }
  .tool-status.done {
    background: rgba(34, 197, 94, 0.2);
    color: var(--color-success);
    border-color: var(--color-success);
  }
  .tool-status.error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--color-error);
    border-color: var(--color-error);
  }
  .tool-status.running {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-color: var(--color-primary);
  }

  .tool-toggle {
    padding: 3px;
    color: var(--color-text-muted);
    border-radius: 0;
    flex-shrink: 0;
    background: transparent;
    border: none;
  }
  .tool-toggle:hover {
    color: var(--color-primary);
    background: var(--color-surface);
  }
  .tool-toggle :global(svg) {
    transition: transform var(--transition-fast);
  }
  .tool-toggle .rotated {
    transform: rotate(180deg);
  }

  .tool-body {
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg);
  }

  .tool-pending {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }
  .tool-loading {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  /* Tool result sections */
  .tool-output,
  .read-content,
  .edit-diff,
  .bash-output {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 0;
    padding: var(--space-2) var(--space-3);
    margin: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    color: var(--color-text);
  }

  .read-entry {
    margin-bottom: var(--space-2);
  }
  .read-entry:last-child {
    margin-bottom: 0;
  }
  .read-header {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    margin-bottom: var(--space-1);
    font-weight: 600;
  }
  .read-content {
    max-height: 220px;
    overflow-y: auto;
  }
  .edit-diff {
    margin-top: var(--space-1);
  }
  .bash-output {
    color: var(--color-success);
  }
  .bash-error {
    color: var(--color-error);
  }

  .edit-file,
  .grep-file,
  .read-file,
  .find-file,
  .ls-file,
  .write-status {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-primary);
  }

  /* ── Thinking section ───────────────────────── */
  .thought-container {
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border);
    border-radius: 0;
    overflow: hidden;
    margin-bottom: var(--space-3);
    transition: all var(--transition-fast);
  }
  .thought-container.expanded {
    border: 1px solid var(--color-border);
  }

  .thought-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-muted);
    cursor: pointer;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
  }
  .thought-container.expanded .thought-toggle {
    border-bottom-color: var(--color-border);
  }
  .thought-toggle:hover {
    color: var(--color-text);
    background: var(--color-surface);
  }

  .thought-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .thought-label {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .thought-container .chevron {
    transition: transform var(--transition-fast);
  }
  .thought-container.expanded .chevron {
    transform: rotate(180deg);
  }
  .thought-content {
    padding: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-bg);
    font-family: var(--font-mono);
    line-height: 1.6;
    max-height: 240px;
    overflow-y: auto;
  }

  /* ── Text / code blocks ─────────────────────── */
  .text-wrapper {
    position: relative;
  }

  .code-block-wrapper {
    position: relative;
    margin: var(--space-3) 0;
    border-radius: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
  }
  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 6px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  .code-lang {
    font-family: var(--font-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .code-actions {
    display: flex;
    gap: 2px;
  }
  .code-action-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 9px;
  }
  .code-action-btn:hover {
    color: var(--color-primary);
    border-color: var(--color-border);
    background: var(--color-surface-2);
  }
  .copy-check {
    color: var(--color-success);
    font-weight: 700;
  }

  .message-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--transition-fast);
  }
  .message-bubble:hover .message-actions {
    opacity: 1;
  }
  .copy-msg-btn, .time-toggle {
    display: flex;
    align-items: center;
    padding: 2px 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .copy-msg-btn:hover, .time-toggle:hover {
    color: var(--color-primary);
    border-color: var(--color-border);
    background: var(--color-surface-2);
  }

  :global(.message-content pre) {
    background: var(--color-bg);
    border: none;
    border-radius: 0;
    padding: var(--space-3) var(--space-4);
    margin: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    color: var(--color-text);
  }
  .code-block-wrapper :global(pre) {
    padding-top: var(--space-2);
  }

  :global(.md-table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  :global(.md-table th),
  :global(.md-table td) {
    padding: 0.3em 0.6em;
    border: 1px solid var(--color-border);
    text-align: left;
  }
  :global(.md-table th) {
    background: var(--color-surface-2);
    font-weight: 700;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  :global(.md-table tr:hover td) {
    background: oklch(from var(--color-surface-2) l c h / 0.5);
  }

  .content-spacer {
    height: var(--space-3);
  }

  /* ── Streaming cursor ───────────────────────── */
  .streaming-cursor {
    display: inline-block;
    width: 6px;
    height: 15px;
    margin-left: 2px;
    vertical-align: text-bottom;
    background: var(--color-primary);
    border-radius: 1px;
    animation: cursor-blink 1s ease-in-out infinite;
  }
  @keyframes cursor-blink {
    0%,
    100% {
      opacity: 1;
      transform: scaleY(1);
    }
    50% {
      opacity: 0.2;
      transform: scaleY(0.3);
    }
  }

  /* ── Mermaid diagrams ───────────────────────── */
  .mermaid-container {
    position: relative;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin: var(--space-2) 0;
  }
  .mermaid-label {
    position: absolute;
    top: -7px;
    left: 10px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-primary);
    background: var(--color-bg);
    padding: 0 6px;
  }

  /* ── Markdown formatting ────────────────────── */
  :global(.md-h) {
    font-weight: 700;
    line-height: 1.35;
    margin: 1em 0 0.4em;
    color: var(--color-text);
  }
  :global(.md-h:first-child) {
    margin-top: 0;
  }
  :global(h1.md-h) {
    font-size: 1.35em;
  }
  :global(h2.md-h) {
    font-size: 1.2em;
    border-bottom: 1px solid oklch(from var(--color-border) l c h / 0.3);
    padding-bottom: 0.25em;
  }
  :global(h3.md-h) {
    font-size: 1.1em;
  }
  :global(h4.md-h) {
    font-size: 1.05em;
  }

  :global(.md-p) {
    margin: 0.5em 0;
    line-height: 1.65;
  }
  :global(.md-p:first-child) {
    margin-top: 0;
  }
  :global(.md-p:last-child) {
    margin-bottom: 0;
  }

  :global(.md-ul),
  :global(.md-ol) {
    margin: 0.4em 0;
    padding-left: 1.5em;
    line-height: 1.6;
  }
  :global(.md-ul li),
  :global(.md-ol li) {
    margin: 0.15em 0;
  }
  :global(.md-ul) {
    list-style: disc;
  }
  :global(.md-ol) {
    list-style: decimal;
  }

  :global(.md-quote) {
    margin: 0.5em 0;
    padding: 0.3em 0.8em;
    border-left: 3px solid oklch(from var(--color-primary) l c h / 0.4);
    color: var(--color-text-muted);
    font-style: italic;
  }

  :global(.md-link) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.md-link:hover) {
    opacity: 0.8;
  }

  :global(.md-hr) {
    border: none;
    border-top: 1px solid oklch(from var(--color-border) l c h / 0.25);
    margin: 0.8em 0;
  }

  :global(.md-code) {
    background: oklch(from var(--color-bg) l c h / 0.55);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    line-height: 1.55;
    overflow-x: auto;
    margin: 0.4em 0;
  }

  :global(.md-inline-code) {
    background: oklch(from var(--color-surface-2) l c h / 0.6);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  :global(.message-content strong) {
    font-weight: 700;
    color: inherit;
  }
  :global(.message-content em) {
    font-style: italic;
  }
</style>
