<script lang="ts">
  import { onMount } from "svelte";
  import { postToHost, parseHostMessage, asString, asArray } from "../messages";
  import {
    ageLabel,
    filesFromPayload,
    normalizeServer,
    type McpAddRequest,
    type McpExposure,
    type McpFiles,
    type McpServer,
  } from "../mcp-display";
  import McpAddForm from "./McpAddForm.svelte";
  import McpNotices from "./McpNotices.svelte";
  import McpServerCard from "./McpServerCard.svelte";

  let servers = $state<McpServer[]>([]);
  let errors = $state<string[]>([]);
  let note = $state("");
  let checkError = $state("");
  let checkedAt = $state<number | null>(null);
  let clock = $state(Date.now());
  let files = $state<McpFiles>({
    global: "",
    project: "",
    projectExists: false,
    projectTrusted: false,
  });
  let isLoading = $state(true);
  let isChecking = $state(false);
  let actionError = $state("");
  let busyName = $state<string | null>(null);
  let searchQuery = $state("");
  let showAdd = $state(false);

  const filteredServers = $derived(
    servers.filter((server) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        server.name.toLowerCase().includes(q) ||
        server.description.toLowerCase().includes(q) ||
        server.transport.toLowerCase().includes(q)
      );
    }),
  );
  const connectedCount = $derived(servers.filter((s) => s.state === "connected").length);
  const needsAttention = $derived(
    servers.filter((s) => s.state === "needs-auth" || s.state === "failed" || s.error).length,
  );

  let stateTimer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    postToHost({ type: "getMcpServers" });
    // `pi mcp list` connects every enabled server. Keep the configured list
    // visible immediately and let the live state fill in when it arrives.
    isChecking = true;
    postToHost({ type: "checkMcpServers" });
    stateTimer = setInterval(() => {
      // Re-render the "checked Ns ago" label.
      clock = Date.now();
    }, 10_000);
    return () => {
      if (stateTimer) clearInterval(stateTimer);
    };
  });

  $effect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = parseHostMessage(event);
      if (!message) return;
      handleMessage(message.type, message.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  function handleMessage(type: string, data: unknown) {
    if (type === "mcp-servers") {
      applyPayload(data);
      return;
    }
    if (type === "mcp-servers-updated") {
      handleUpdated();
      return;
    }
    handleHostError(type, data);
  }

  function hostErrorMessage(data: unknown): string {
    const record = (typeof data === "object" && data !== null ? data : {}) as Record<
      string,
      unknown
    >;
    return asString(record.message);
  }

  function handleHostError(type: string, data: unknown) {
    if (type !== "error") return;
    const messageText = hostErrorMessage(data);
    if (!messageText) return;
    actionError = messageText;
    busyName = null;
    isChecking = false;
  }

  function handleUpdated() {
    // A mutation finished on the host. Refresh both the files and the live
    // state so the panel never keeps a stale enable/exposure badge.
    if (busyName === "__add") showAdd = false;
    postToHost({ type: "getMcpServers" });
    isChecking = true;
    postToHost({ type: "checkMcpServers" });
  }

  function applyPayload(raw: unknown) {
    const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    servers = asArray<McpServer>(data.servers, (value): value is McpServer => {
      return !!value && typeof value === "object" && typeof (value as McpServer).name === "string";
    }).map(normalizeServer);
    errors = asArray<string>(data.errors, (value): value is string => typeof value === "string");
    files = filesFromPayload(data.files);
    note = asString(data.note);
    // The host sends one payload for the fast config list and one for the
    // connection check. Only the latter carries `checkedAt`, so a quick config
    // reply must not clear the "Checking…" state of a check still running.
    if (typeof data.checkedAt === "number") {
      checkError = asString(data.checkError);
      checkedAt = data.checkedAt;
      isChecking = false;
      busyName = null;
    } else if (!isChecking) {
      // No check in flight (a config-only refresh): the reply is final.
      // While a check is running the config reply arrives first and must
      // not clear the per-server spinner early.
      busyName = null;
    }
    isLoading = false;
  }

  function refresh(withCheck = true) {
    isLoading = true;
    postToHost({ type: "getMcpServers" });
    if (withCheck) {
      isChecking = true;
      postToHost({ type: "checkMcpServers" });
    }
  }

  function openConfig(scope: "global" | "project") {
    postToHost({ type: "openMcpConfig", data: { scope } });
  }

  function setEnabled(server: McpServer) {
    actionError = "";
    busyName = server.name;
    postToHost({
      type: "updateMcpServerConfig",
      data: {
        name: server.name,
        patch: { enabled: !server.enabled },
        ...(server.scope === "project" ? { scope: "project" } : {}),
      },
    });
  }

  function setExposure(server: McpServer, exposure: McpExposure) {
    actionError = "";
    busyName = server.name;
    postToHost({
      type: "updateMcpServerConfig",
      data: {
        name: server.name,
        patch: { exposure },
        ...(server.scope === "project" ? { scope: "project" } : {}),
      },
    });
  }

  function removeServer(server: McpServer) {
    const where = server.scope === "project" ? "project" : "global";
    if (!window.confirm(`Remove MCP server "${server.name}" from the ${where} config?`)) return;
    actionError = "";
    busyName = server.name;
    postToHost({
      type: "removeMcpServer",
      data: { name: server.name, scope: where },
    });
  }

  function loginServer(server: McpServer) {
    actionError = "";
    busyName = server.name;
    postToHost({ type: "loginMcpServer", data: { name: server.name } });
  }

  function logoutServer(server: McpServer) {
    actionError = "";
    busyName = server.name;
    postToHost({ type: "logoutMcpServer", data: { name: server.name } });
  }

  function addServer(input: McpAddRequest) {
    actionError = "";
    busyName = "__add";
    postToHost({ type: "addMcpServer", data: input });
  }

  function checkedLabel(): string {
    if (isChecking) return "Checking connections…";
    if (checkError) return "Connection check failed";
    if (!checkedAt) return "Live state not checked";
    return ageLabel(checkedAt, clock);
  }
</script>

<div class="mcp-panel">
  <div class="panel-header">
    <div>
      <h2>MCP Servers</h2>
      <p class="panel-description">
        Model Context Protocol servers from PI's global <code>mcp.json</code> and, in trusted
        projects, <code>.pi/mcp.json</code>.
      </p>
    </div>
    <button class="icon-btn" onclick={() => refresh()} title="Refresh servers" disabled={isLoading}>
      ↻
    </button>
  </div>

  <div class="summary-row">
    <span class="summary-item"><strong>{servers.length}</strong> configured</span>
    <span class="summary-item ok"><strong>{connectedCount}</strong> connected</span>
    {#if needsAttention > 0}
      <span class="summary-item warn"><strong>{needsAttention}</strong> need attention</span>
    {/if}
  </div>

  <div class="file-row">
    <button
      class="config-btn"
      onclick={() => openConfig("global")}
      title={`Main user config (all projects): ${files.global}`}
    >
      Open main mcp.json
    </button>
    <button class="config-btn" onclick={() => openConfig("project")} title={files.project}>
      Open project mcp.json
    </button>
    <button class="check-btn" onclick={() => refresh()} disabled={isChecking}>
      {isChecking ? "Checking…" : "Check connections"}
    </button>
  </div>

  <div class="status-line">
    <span class:checking={isChecking}>{checkedLabel()}</span>
    {#if files.project && !files.projectTrusted}
      <span class="trust-note">Project config ignored until the workspace is trusted</span>
    {/if}
  </div>
  <div class="reload-hint">
    Changes apply to new sessions; use <code>/reload</code> to reconnect the current one.
  </div>

  <McpNotices {note} {checkError} {actionError} {errors} onDismiss={() => (actionError = "")} />

  <div class="toolbar">
    <input
      class="search-input"
      type="text"
      placeholder="Search servers…"
      bind:value={searchQuery}
    />
    <button class="add-btn" onclick={() => (showAdd = !showAdd)}>
      {showAdd ? "Cancel" : "+ Add server"}
    </button>
  </div>

  {#if showAdd}
    <McpAddForm {files} busy={busyName === "__add"} onSubmit={addServer} />
  {/if}

  <div class="server-list">
    {#if isLoading}
      <div class="empty-state">Loading MCP servers…</div>
    {:else if servers.length === 0}
      <div class="empty-state">
        <strong>No MCP servers configured</strong>
        <p>
          Add a server here or edit mcp.json directly. PI connects enabled servers automatically.
        </p>
        <button class="add-btn" onclick={() => (showAdd = true)}>Add your first server</button>
      </div>
    {:else if filteredServers.length === 0}
      <div class="empty-state">No servers match “{searchQuery}”.</div>
    {:else}
      {#each filteredServers as server (server.name)}
        <McpServerCard
          {server}
          busy={busyName === server.name}
          onToggle={() => setEnabled(server)}
          onExposure={(exposure) => setExposure(server, exposure)}
          onLogin={() => loginServer(server)}
          onLogout={() => logoutServer(server)}
          onRemove={() => removeServer(server)}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .mcp-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .panel-description {
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: 16px;
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--color-surface-2);
  }

  .summary-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    flex-shrink: 0;
  }

  .summary-item {
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .summary-item strong {
    color: var(--color-text);
  }

  .summary-item.ok strong {
    color: var(--color-success);
  }

  .summary-item.warn strong {
    color: var(--color-warning);
  }

  .file-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .config-btn,
  .check-btn,
  .add-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .config-btn:hover,
  .check-btn:hover,
  .add-btn:hover {
    background: var(--color-surface-2);
  }

  .add-btn {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .add-btn:hover {
    background: color-mix(in oklch, var(--color-primary) 85%, black);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .checking {
    color: var(--color-primary);
  }

  .trust-note {
    color: var(--color-warning);
  }

  .reload-hint {
    margin: calc(-1 * var(--space-1)) 0 var(--space-2);
    font-size: 10px;
    color: var(--color-text-muted);
    line-height: 1.4;
    flex-shrink: 0;
  }

  .toolbar {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-2) 0 var(--space-3);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    font-size: var(--text-sm);
  }

  .server-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-right: 2px;
  }

  .empty-state {
    padding: var(--space-5) var(--space-4);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
    line-height: 1.5;
  }

  .empty-state strong {
    display: block;
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .empty-state p {
    margin: 0 0 var(--space-3);
  }

  .empty-state .add-btn {
    font-size: var(--text-sm);
  }
</style>
