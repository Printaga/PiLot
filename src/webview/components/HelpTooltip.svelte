<script lang="ts">
  interface Props {
    text: string;
    title?: string;
    position?: "top" | "bottom" | "left" | "right";
  }

  let { text, title = "", position = "top" }: Props = $props();
  // SSR-safe unique id (stable across hydration, unlike Math.random).
  let uid = $props.id();
  const tooltipId = `help-tooltip-${uid}`;
  let visible = $state(false);
  let wrapper: HTMLElement | null = $state(null);

  // Keep focus only while it stays within the wrapper: focusout fires when
  // focus moves between the button and the wrapper, so checking relatedTarget
  // prevents flicker/hide while the button is still focused.
  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && wrapper?.contains(next)) return;
    visible = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && visible) {
      event.stopPropagation();
      visible = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="help-tooltip-wrapper"
  role="presentation"
  bind:this={wrapper}
  onmouseenter={() => (visible = true)}
  onmouseleave={() => (visible = false)}
  onfocusin={() => (visible = true)}
  onfocusout={handleFocusOut}
>
  <button
    class="help-icon-btn"
    aria-label="Help: {title || text}"
    aria-describedby={tooltipId}
    aria-expanded={visible}
    onclick={() => (visible = !visible)}
    tabindex="0"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  </button>

  <!-- Always in the DOM so aria-describedby always resolves; hidden visually
       (and from AT via the hidden attribute semantics) when not visible. -->
  <div class="tooltip-content tooltip-{position}" role="tooltip" id={tooltipId} hidden={!visible}>
    {#if title}
      <div class="tooltip-title">{title}</div>
    {/if}
    <div class="tooltip-text">{text}</div>
  </div>
</div>

<style>
  .help-tooltip-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .help-icon-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    color: var(--color-text-muted);
    opacity: 0.5;
    transition: all var(--transition-fast);
  }

  .help-icon-btn:hover,
  .help-icon-btn:focus-visible {
    opacity: 1;
    color: var(--color-primary);
    background: var(--accent-glow);
  }

  .tooltip-content {
    position: absolute;
    z-index: 1000;
    width: 260px;
    max-width: min(260px, 90vw);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid oklch(from var(--color-primary) l c h / 0.25);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px oklch(0% 0 0 / 0.2);
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--color-text);
    animation: tooltip-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes tooltip-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .tooltip-top {
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }
  .tooltip-bottom {
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }
  .tooltip-left {
    right: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
  }
  .tooltip-right {
    left: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
