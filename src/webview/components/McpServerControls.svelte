<script lang="ts">
  import { EXPOSURES, EXPOSURE_HELP, type McpExposure, type McpServer } from "../mcp-display";

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
</script>

<div class="server-controls">
  <label class="inline-control">
    <span>Exposure</span>
    <select
      value={server.exposure}
      disabled={busy}
      title={EXPOSURE_HELP[server.exposure]}
      onchange={(event) => onExposure(event.currentTarget.value as McpExposure)}
    >
      {#each EXPOSURES as exposure (exposure)}
        <option value={exposure}>{exposure}</option>
      {/each}
    </select>
  </label>
  <button class="toggle-btn" onclick={onToggle} disabled={busy}>
    {server.enabled ? "Disable" : "Enable"}
  </button>
  {#if server.state === "needs-auth"}
    <button class="login-btn" onclick={onLogin} disabled={busy}>
      {busy ? "Waiting for browser…" : "Sign in"}
    </button>
  {:else if server.scope !== "extension"}
    <button
      class="text-btn"
      onclick={onLogout}
      disabled={busy}
      title="Delete stored OAuth credentials"
    >
      Sign out
    </button>
  {/if}
  {#if server.scope !== "extension"}
    <button class="remove-btn" onclick={onRemove} disabled={busy}>Remove</button>
  {/if}
</div>

<style>
  .server-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .inline-control {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .inline-control select {
    padding: 2px var(--space-1);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: 10px;
  }

  .toggle-btn,
  .login-btn,
  .remove-btn,
  .text-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .login-btn {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .toggle-btn:hover,
  .text-btn:hover {
    background: var(--color-surface-2);
  }

  .login-btn:hover {
    background: color-mix(in oklch, var(--color-primary) 85%, black);
  }

  .remove-btn:hover {
    color: var(--color-error, #e5534b);
    border-color: var(--color-error, #e5534b);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .text-btn {
    padding: 2px var(--space-1);
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    text-decoration: underline;
  }
</style>
