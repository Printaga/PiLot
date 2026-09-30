<script lang="ts">
  import { onMount } from "svelte";
  import { parseHostMessage, asString, postToHost } from "../messages";

  type Props = { sessionResources?: { sessionId?: string } | null };
  let { sessionResources = null }: Props = $props();

  let systemPrompt = $state("");
  let hasPrompt = $state(false);
  let isLoading = $state(true);
  let copyState = $state<"idle" | "ok" | "fail">("idle");
  let wordWrap = $state(false);
  // Panel-local request counter: drops out-of-order/stale replies during a
  // session switch so the previous session's prompt can never overwrite the
  // current one (postMessage preserves host-side ordering).
  let latestRequestId = 0;
  let requestId = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  // Request the prompt on mount and whenever the session resources refresh
  // (which follows session switches/restarts, so the panel follows the active
  // session without needing its own event subscription).
  $effect(() => {
    const res = sessionResources;
    // No session => the host never answers (`sendSystemPrompt` returns early);
    // show the empty state instead of spinning forever.
    isLoading = res != null;
    if (res == null) {
      systemPrompt = "";
      hasPrompt = false;
      return;
    }
    requestId = ++latestRequestId;
    postToHost({ type: "getSystemPrompt" });
  });

  // Backstop: bound the wait so a dropped reply cannot strand the panel in the
  // loading state (the host has several silent no-answer paths).
  $effect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => (isLoading = false), 3000);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      const msg = parseHostMessage(event);
      if (!msg || msg.type !== "system-prompt") return;
      // Drop replies that belong to a superseded request.
      if (requestId !== latestRequestId) return;
      systemPrompt = asString(msg.data.prompt);
      hasPrompt = systemPrompt.length > 0;
      isLoading = false;
    }
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (copyTimer) clearTimeout(copyTimer);
    };
  });

  let charCount = $derived(systemPrompt.length);
  let lineCount = $derived(systemPrompt.split("\n").length);
  let tokenEstimate = $derived(Math.ceil(systemPrompt.length / 4));

  let copyLabel = $derived(
    copyState === "ok" ? "Copied!" : copyState === "fail" ? "Copy failed" : "Copy",
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(systemPrompt);
      copyState = "ok";
    } catch {
      copyState = "fail";
    }
    // Track + reset the handle: stacked timers previously reset the feedback
    // early, and an untracked timer survived teardown.
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyState = "idle";
    }, 2000);
  }
</script>

<div class="system-prompt-panel">
  <div class="panel-header">
    <h3>System Prompt</h3>
    <p class="section-description">
      Live prompt sent to the model for this session, including SYSTEM.md, settings overrides, and
      extension modifications. Updates when a new run starts.
    </p>
    <div class="panel-actions">
      <button
        class="action-btn"
        onclick={copyPrompt}
        disabled={!hasPrompt}
        title="Copy the system prompt to the clipboard"
      >
        {copyLabel}
      </button>
      <button
        class="action-btn"
        class:active={wordWrap}
        aria-pressed={wordWrap}
        onclick={() => (wordWrap = !wordWrap)}
        title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
      >
        Wrap
      </button>
    </div>
  </div>

  {#if isLoading}
    <div class="prompt-status">Loading system prompt…</div>
  {:else if !hasPrompt}
    <div class="prompt-status">
      No system prompt available. Start a session (e.g. send a message) and reopen this tab.
    </div>
  {:else}
    <pre class="prompt-view" class:nowrap={!wordWrap}>{systemPrompt}</pre>
    <div class="prompt-meta">
      {charCount} chars · {lineCount} lines · ~{tokenEstimate} tokens
    </div>
  {/if}
</div>

<style>
  .system-prompt-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
  }

  .panel-header {
    margin-bottom: var(--space-3);
  }

  h3 {
    font-size: var(--text-lg);
    font-weight: 600;
    margin-bottom: var(--space-2);
  }

  .section-description {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--space-3);
  }

  .panel-actions {
    display: flex;
    gap: var(--space-2);
  }

  .action-btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--color-surface-hover, rgba(128, 128, 128, 0.15));
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.active {
    background: var(--color-accent, rgba(90, 130, 255, 0.25));
  }

  .prompt-status {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-4);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-sm);
  }

  .prompt-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface, rgba(128, 128, 128, 0.06));
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    user-select: text;
  }

  .prompt-view.nowrap {
    white-space: pre;
  }

  .prompt-meta {
    margin-top: var(--space-2);
    font-size: var(--text-xs, 11px);
    color: var(--color-text-muted);
  }
</style>
