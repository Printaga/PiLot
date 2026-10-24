<script lang="ts">
  import type { McpServer } from "../mcp-display";

  let {
    server,
    expanded,
    onToggle,
  }: {
    server: McpServer;
    expanded: boolean;
    onToggle: () => void;
  } = $props();

  const visibleTools = $derived(expanded ? server.tools : server.tools.slice(0, 6));
</script>

{#if server.tools.length > 0}
  <div class="tools">
    {#each visibleTools as tool (tool)}
      <span class="tool-chip" title={server.toolExposure?.[tool] || server.exposure}>
        {tool}
        {#if server.toolExposure?.[tool]}
          <em>[{server.toolExposure[tool]}]</em>
        {/if}
      </span>
    {/each}
    {#if server.tools.length > 6}
      <button class="more-btn" onclick={onToggle}>
        {expanded ? "Show less" : `+${server.tools.length - 6} more`}
      </button>
    {/if}
  </div>
{/if}

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: var(--space-2);
  }

  .tool-chip {
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.6;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-chip em {
    opacity: 0.75;
    font-style: normal;
  }

  .more-btn {
    padding: 1px var(--space-1);
    background: transparent;
    border: none;
    color: var(--color-primary);
    font-size: 10px;
    cursor: pointer;
  }
</style>
