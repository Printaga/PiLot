<script lang="ts">
  let {
    note,
    checkError,
    actionError,
    errors,
    onDismiss,
  }: {
    note: string;
    checkError: string;
    actionError: string;
    errors: string[];
    onDismiss: () => void;
  } = $props();
</script>

{#if note}
  <div class="notice">{note}</div>
{/if}
{#if checkError}
  <div class="notice error">{checkError}</div>
{/if}
{#if actionError}
  <div class="notice error">
    {actionError}
    <button class="dismiss-btn" onclick={onDismiss}>Dismiss</button>
  </div>
{/if}
{#if errors.length > 0}
  <div class="notice error">
    <strong>Config errors</strong>
    {#each errors as error (error)}
      <div class="config-error">{error}</div>
    {/each}
  </div>
{/if}

<style>
  .notice {
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    border-radius: var(--radius-md);
    background: color-mix(in oklch, var(--color-warning) 10%, transparent);
    border: 1px solid color-mix(in oklch, var(--color-warning) 28%, transparent);
    color: var(--color-text);
    font-size: var(--text-xs);
    line-height: 1.45;
    flex-shrink: 0;
  }

  .notice.error {
    background: color-mix(in oklch, var(--color-error, #e5534b) 9%, transparent);
    border-color: color-mix(in oklch, var(--color-error, #e5534b) 30%, transparent);
  }

  .config-error {
    margin-top: 4px;
    font-family: var(--font-mono);
    white-space: pre-wrap;
  }

  .dismiss-btn {
    margin-left: var(--space-2);
    padding: 0 var(--space-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
