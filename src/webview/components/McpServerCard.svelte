<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import {
    scopeLabel,
    stateClass,
    stateLabel,
    type McpExposure,
    type McpServer,
  } from "../mcp-display";
  import McpServerControls from "./McpServerControls.svelte";
  import McpTools from "./McpTools.svelte";

  let {
    server,
    busy = false,
    onToggle,
    onExposure,
    onLogin,
    onLogout,
    onRemove,
  }: {
    server: McpServer;
    busy?: boolean;
    onToggle: () => void;
    onExposure: (exposure: McpExposure) => void;
    onLogin: () => void;
    onLogout: () => void;
    onRemove: () => void;
  } = $props();

  const expanded = new SvelteSet<string>();
  const serverExpanded = $derived(expanded.has(server.name));

  function toggleExpanded() {
    if (serverExpanded) expanded.delete(server.name);
    else expanded.add(server.name);
  }
</script>

<div class="server-card" class:disabled={!server.enabled}>
  <div class="server-header">
    <button
      class="server-name"
      onclick={toggleExpanded}
      title={server.description || server.transport}
    >
      {server.name}
    </button>
    <span class="scope-badge" data-scope={server.scope}>{scopeLabel(server)}</span>
    <span class="state-badge {stateClass(server)}">{stateLabel(server)}</span>
    {#if server.resources}
      <span class="resource-badge">resources</span>
    {/if}
  </div>

  {#if server.description}
    <div class="server-description">{server.description}</div>
  {/if}
  <div class="server-transport" title={server.transport}>{server.transport}</div>

  <McpServerControls {server} {busy} {onToggle} {onExposure} {onLogin} {onLogout} {onRemove} />

  <McpTools {server} expanded={serverExpanded} onToggle={toggleExpanded} />

  {#if server.error}
    <pre class="server-error">{server.error}</pre>
  {/if}

  {#if server.override}
    <div class="override-note">Project override: {server.override}</div>
  {/if}
</div>

<style>
  .server-card {
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }

  .server-card.disabled {
    opacity: 0.72;
  }

  .server-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .server-name {
    padding: 0;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 650;
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .server-name:hover {
    text-decoration: underline;
  }

  .scope-badge,
  .state-badge,
  .resource-badge,
  .tool-chip {
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.6;
  }

  .scope-badge {
    background: var(--color-surface-2);
    color: var(--color-text-muted);
  }

  .scope-badge[data-scope="project"] {
    color: var(--color-primary);
    background: color-mix(in oklch, var(--color-primary) 12%, transparent);
  }

  .scope-badge[data-scope="extension"] {
    color: var(--color-warning);
    background: color-mix(in oklch, var(--color-warning) 12%, transparent);
  }

  .state-badge.state-ok {
    color: var(--color-success);
    background: color-mix(in oklch, var(--color-success) 12%, transparent);
  }

  .state-badge.state-warn {
    color: var(--color-warning);
    background: color-mix(in oklch, var(--color-warning) 12%, transparent);
  }

  .state-badge.state-error {
    color: var(--color-error, #e5534b);
    background: color-mix(in oklch, var(--color-error, #e5534b) 12%, transparent);
  }

  .state-badge.state-disabled,
  .state-badge.state-idle {
    color: var(--color-text-muted);
    background: var(--color-surface-2);
  }

  .resource-badge {
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .server-description {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .server-transport {
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .server-error {
    margin: var(--space-2) 0 0;
    padding: var(--space-2);
    max-height: 120px;
    overflow: auto;
    background: color-mix(in oklch, var(--color-error, #e5534b) 7%, transparent);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .override-note {
    margin-top: var(--space-2);
    font-size: 10px;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
</style>
