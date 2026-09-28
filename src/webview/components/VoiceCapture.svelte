<script lang="ts">
  interface Props {
    isListening: boolean;
    onToggle: () => void;
  }

  // Purely presentational: the listening state is owned by App.svelte, which
  // handles the `voice-listening-changed` host message and passes it down.
  // Writing to a `$props()` binding here is unsupported in Svelte 5, so this
  // component must not mutate it.
  let { isListening, onToggle }: Props = $props();
</script>

<button
  class="voice-btn"
  class:listening={isListening}
  onclick={onToggle}
  title={isListening ? "Stop dictation" : "Start dictation (Ctrl+Shift+;)"}
  aria-label={isListening ? "Stop dictation" : "Start dictation"}
  aria-pressed={isListening}
>
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    {#if isListening}
      <rect x="2" y="2" width="20" height="20" rx="4" />
    {:else}
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    {/if}
  </svg>
</button>

<style>
  .voice-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    transition:
      background-color var(--transition-interactive),
      border-color var(--transition-interactive),
      color var(--transition-interactive);
  }

  .voice-btn:hover {
    border-color: var(--color-primary);
    background: var(--surface-tint);
  }

  .voice-btn.listening {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }
</style>
