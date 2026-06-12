<script lang="ts">
  import { onMount } from "svelte";

  interface SessionItem {
    id: string;
    label: string;
    timestamp: number;
    messageCount: number;
  }

  let sessions = $state<SessionItem[]>([]);
  let loading = $state(true);
  let activeSessionId = $state<string | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let searchQuery = $state("");
  let selectionMode = $state(false);
  let selectedSessionIds = $state<Set<string>>(new Set());

  const filteredSessions = $derived(
    searchQuery
      ? sessions.filter((s) =>
          s.label?.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : sessions,
  );

  onMount(() => {
    window.addEventListener("message", handleMessage);
    sendMessage({ type: "listSessions" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  });

  function handleMessage(event: MessageEvent) {
    const { type, data } = event.data;
    if (type === "sessions-list") {
      sessions = data || [];
      loading = false;
    } else if (type === "ready" && data?.sessions) {
      sessions = data.sessions || [];
      loading = false;
    } else if (type === "session-updated") {
      activeSessionId = data?.sessionId || null;
      sendMessage({ type: "listSessions" });
    }
  }

  function sendMessage(msg: any) {
    if (typeof (window as any).vscode?.postMessage === "function") {
      (window as any).vscode.postMessage(msg);
    }
  }

  function selectSession(id: string) {
    selectedNodeId = id;
    activeSessionId = id;
    sendMessage({ type: "switchSession", data: { sessionId: id } });
  }

  function newSession() {
    selectedNodeId = null;
    sendMessage({ type: "newSession" });
  }

  function formatTime(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      selectedNodeId = null;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = filteredSessions;
      const currentIdx = list.findIndex((n) => n.id === selectedNodeId);
      let nextIdx =
        e.key === "ArrowDown"
          ? Math.min(currentIdx + 1, list.length - 1)
          : Math.max(currentIdx - 1, 0);
      if (currentIdx === -1) nextIdx = 0;
      if (list[nextIdx]) {
        selectedNodeId = list[nextIdx].id;
        document
          .getElementById(`session-${list[nextIdx].id}`)
          ?.scrollIntoView({ block: "nearest" });
      }
    }
    if (e.key === "Enter" && selectedNodeId) {
      selectSession(selectedNodeId);
    }
  }

  function toggleSelectionMode() {
    selectionMode = !selectionMode;
    selectedSessionIds = new Set();
  }

  function toggleSessionSelection(id: string) {
    const next = new Set(selectedSessionIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedSessionIds = next;
  }

  function selectAllSessions(ids: string[]) {
    selectedSessionIds = new Set(ids);
  }

  function clearSelection() {
    selectedSessionIds = new Set();
  }

function forkSession(id: string) {
		sendMessage({ type: "forkSession", data: { fromNodeId: id } });
	}

  function deleteSession(id: string) {
    sendMessage({
      type: "deleteSessions",
      data: { sessionIds: [id] },
    });
  }

  function deleteSelectedSessions() {
    if (selectedSessionIds.size === 0) return;
    sendMessage({
      type: "deleteSessions",
      data: { sessionIds: Array.from(selectedSessionIds) },
    });
    clearSelection();
  }

  $effect(() => {
    if (!loading && sessions.length > 0) {
      if (!selectionMode) {
        selectedSessionIds = new Set();
      }
    }
  });
</script>

<div
  class="session-panel"
  onkeydown={handleKeydown}
  role="list"
  aria-label="Sessions"
  tabindex="0"
>
  <div class="session-header">
    <div class="header-top">
      <span class="title">Sessions</span>
      <div class="header-actions">
        <button
          class="add-btn"
          onclick={newSession}
          title="New Session (Ctrl+N)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <line x1="12" y1="5" x2="12" y2="19" /><line
              x1="5"
              y1="12"
              x2="19"
              y2="12"
            />
          </svg>
        </button>
      </div>
    </div>

  <div class="selection-bar">
    <button
      class="selection-toggle"
      class:active={selectionMode}
      onclick={toggleSelectionMode}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        {#if selectionMode}
          <path d="M8 12l3 3 5-6" />
        {/if}
      </svg>
      <span>Select</span>
    </button>
    {#if !selectionMode && selectedNodeId}
      <button
        class="selection-action danger"
        onclick={() => deleteSession(selectedNodeId!)}
      >
        Delete
      </button>
    {/if}
    {#if selectionMode && selectedSessionIds.size > 0}
      <span class="selection-count">{selectedSessionIds.size} selected</span>
      <button
        class="selection-action"
        onclick={() => selectAllSessions(sessions.map((session) => session.id))}
      >
        Select all
      </button>
      <button
        class="selection-action danger"
        onclick={deleteSelectedSessions}
      >
        Delete selected
      </button>
      <button class="selection-action" onclick={clearSelection}>
        Clear
      </button>
    {/if}
  </div>

    <div class="search-bar">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        class="search-icon"
      >
        <circle cx="11" cy="11" r="8" /><line
          x1="21"
          y1="21"
          x2="16.65"
          y2="16.65"
        />
      </svg>
      <input
        type="text"
        placeholder="Search sessions..."
        bind:value={searchQuery}
        class="search-input"
      />
    </div>
  </div>

  <div class="list">
    {#if loading}
      <div class="empty">
        <div class="spinner"></div>
        <span>Loading sessions...</span>
      </div>
    {:else if sessions.length === 0}
      <div class="empty">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          opacity="0.4"
        >
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>No sessions yet</span>
        <button class="start-btn" onclick={newSession}>Start a session</button>
      </div>
    {:else}
      {#each filteredSessions as session}
        <div
          id="session-{session.id}"
          class="session-row"
          class:active={activeSessionId === session.id}
          class:selected={selectedNodeId === session.id}
          class:selection-active={selectionMode}
          onclick={() => {
            if (selectionMode) {
              toggleSessionSelection(session.id);
            } else {
              selectSession(session.id);
            }
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              if (selectionMode) {
                toggleSessionSelection(session.id);
              } else {
                selectSession(session.id);
              }
            }
            if (e.key === "Delete" && e.ctrlKey) forkSession(session.id);
          }}
          role="button"
          tabindex="0"
        >
          {#if selectionMode}
            <button
              class="selection-checkbox"
              class:checked={selectedSessionIds.has(session.id)}
              onclick={(e) => {
                e.stopPropagation();
                toggleSessionSelection(session.id);
              }}
              aria-label="Toggle selection for {session.label || 'session'}"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="2"
                  stroke="currentColor"
                />
                {#if selectedSessionIds.has(session.id)}
                  <path d="M8 12l3 3 5-6" stroke="currentColor" />
                {/if}
              </svg>
            </button>
          {/if}
          <div class="session-icon">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              />
            </svg>
          </div>
          <div class="info">
            <span class="label">{session.label || "Untitled Session"}</span>
            <span class="meta"
              >{session.messageCount} messages · {formatTime(
                session.timestamp,
              )}</span
            >
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="list-footer">
    {#if sessions.length > 0}
      <span class="footer-info"
        >{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span
      >
      <span class="footer-hint">Ctrl+Click to fork</span>
    {/if}
  </div>
</div>

<style>
  .session-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: transparent;
    outline: none;
  }

  .session-header {
    padding: var(--space-3) var(--space-4) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-bottom: 2px solid var(--color-border);
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: 800;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .header-actions {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }

  .add-btn {
    width: 24px;
    height: 24px;
    background: var(--color-surface-2);
    color: var(--color-primary);
    border-radius: 0;
    border: 1px solid var(--color-primary);
  }

  .add-btn:hover {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    transform: translate(-1px, -1px);
    box-shadow: 2px 2px 0px rgba(0, 0, 0, 1);
  }

  .search-bar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    color: var(--color-text-muted);
    opacity: 0.5;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 4px 8px 4px 24px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--color-surface-2);
    border: 1px solid transparent;
    border-radius: 0;
  }

  .search-input:focus {
    border-color: var(--color-primary);
    background: var(--color-surface);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--accent-glow);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .start-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .start-btn:hover {
    filter: brightness(1.1);
  }

  .session-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    border-radius: 0;
    cursor: pointer;
    transition: all var(--transition-fast);
    border: 1px solid transparent;
    min-height: 36px;
  }

  .session-row:hover {
    background: var(--color-surface-2);
    border-color: var(--color-border);
  }

  .session-row.selected {
    background: var(--color-surface-2);
    border-color: var(--color-primary);
  }

  .session-row.active {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .session-row.active .meta,
  .session-row.active .session-icon,
  .session-row.active .label {
    color: var(--color-text-inverse);
  }

  .session-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--color-primary);
    background: var(--color-surface-2);
    border-radius: 0;
    flex-shrink: 0;
    border: 1px solid var(--color-border);
  }

  .session-row.active .session-icon {
    background: var(--color-primary-active);
    border-color: var(--color-text-inverse);
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: transparent;
    border: none;
    text-align: left;
    padding: 0;
  }

  .label {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .selection-bar {
    padding: var(--space-1) var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
  }

  .selection-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-muted);
    border-radius: 0;
    font-size: 11px;
    font-weight: 600;
  }

  .selection-toggle.active {
    border-color: var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text);
  }

  .selection-count {
    font-size: 11px;
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .selection-action {
    margin-left: auto;
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-muted);
    border-radius: 0;
    font-size: 11px;
    font-weight: 600;
  }

  .selection-action:hover {
    border-color: var(--color-border);
    background: var(--color-surface-2);
  }

  .selection-action.danger {
    color: #ff7b72;
  }

  .selection-action.danger:hover {
    border-color: #ff7b72;
    background: rgba(255, 123, 114, 0.15);
  }

  .selection-checkbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .selection-checkbox.checked {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .session-row.selection-active .session-icon,
  .session-row.selection-active .info {
    opacity: 0.6;
  }

  .list-footer {
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid oklch(from var(--color-border) l c h / 0.15);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-info {
    font-size: 10px;
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .footer-hint {
    font-size: 9px;
    color: var(--color-text-muted);
    opacity: 0.5;
  }
</style>
