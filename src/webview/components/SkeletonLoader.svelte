<script lang="ts">
  interface Props {
    type?: "card" | "list" | "text" | "circle" | "bar";
    count?: number;
    height?: string;
    width?: string;
  }

  // Left undefined by default: the per-type fallbacks (`width ?? "32px"`,
  // `height ?? "8px"`) are only reachable when the caller omits them. Defaulting
  // here to "auto"/"100%" made the circle and bar variants render with
  // height:auto (zero height -> invisible).
  let { type = "card", count: rawCount = 1, height, width }: Props = $props();

  const MAX_COUNT = 50;
  // Coerce before clamping: a string "8" from an untyped/hostile caller must
  // render 8 blocks, not silently 1. Clamped before `Array(count)`: a
  // negative/fractional value throws a RangeError and a huge value can hang
  // the renderer.
  const count = $derived.by(() => {
    const n = Number(rawCount);
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, Math.floor(n))) : 1;
  });

  // CSS-length allow-list: these values are interpolated into an inline style
  // attribute and plausibly arrive from host messages, so anything that is not
  // a plain length/percentage/auto must never reach the style attribute.
  const CSS_SIZE_RE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch)$/i;
  function safeSize(value: string | undefined, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (trimmed === "auto" || trimmed === "0") return trimmed;
    return CSS_SIZE_RE.test(trimmed) ? trimmed : fallback;
  }
</script>

<div class="skeleton-group" role="status" aria-busy="true" aria-label="Loading">
  {#if type === "card"}
    {#each Array(count) as _, i (i)}
      <div
        class="skeleton skeleton-card"
        style="height: {safeSize(height, 'auto')}; width: {safeSize(width, '100%')};"
      >
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-text"></div>
        <div class="skeleton-line skeleton-line-text short"></div>
      </div>
    {/each}
  {:else if type === "list"}
    {#each Array(count) as _, i (i)}
      <div class="skeleton skeleton-list-item" style="width: {safeSize(width, '100%')};">
        <div class="skeleton-list-icon" aria-hidden="true"></div>
        <div class="skeleton-list-content">
          <div class="skeleton-line skeleton-line-title"></div>
          <div class="skeleton-line skeleton-line-text short"></div>
        </div>
      </div>
    {/each}
  {:else if type === "text"}
    {#each Array(count) as _, i (i)}
      <div
        class="skeleton skeleton-text-block"
        style="height: {safeSize(height, 'auto')}; width: {safeSize(width, '100%')};"
      >
        <div class="skeleton-line skeleton-line-text"></div>
        <div class="skeleton-line skeleton-line-text"></div>
        <div class="skeleton-line skeleton-line-text short"></div>
      </div>
    {/each}
  {:else if type === "circle"}
    {#each Array(count) as _, i (i)}
      <div
        class="skeleton skeleton-circle"
        style="width: {safeSize(width, '32px')}; height: {safeSize(height ?? width, '32px')};"
      ></div>
    {/each}
  {:else if type === "bar"}
    {#each Array(count) as _, i (i)}
      <div
        class="skeleton skeleton-bar"
        style="height: {safeSize(height, '8px')}; width: {safeSize(width, '100%')};"
      ></div>
    {/each}
  {/if}
</div>

<style>
  .skeleton {
    background: oklch(from var(--color-border) l c h / 0.15);
    border-radius: var(--radius-md);
    overflow: hidden;
    position: relative;
  }

  .skeleton::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      oklch(from var(--color-border) l c h / 0.08) 50%,
      transparent 100%
    );
    animation: skeleton-shimmer 1.8s ease-in-out infinite;
    transform: translateX(-100%);
    /* Promote the sweep to its own compositor layer: with up to 50 blocks per
     * instance the transform animation otherwise drives main-thread paint. */
    will-change: transform;
  }

  @keyframes skeleton-shimmer {
    to {
      transform: translateX(100%);
    }
  }

  /* Respect the OS reduce-motion preference: the shimmer is an infinite
   * animation; freeze it while keeping the placeholder shapes visible. */
  @media (prefers-reduced-motion: reduce) {
    .skeleton::after {
      animation: none;
      will-change: auto;
    }
  }

  .skeleton-group:empty {
    display: none;
  }

  .skeleton-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    min-height: 80px;
  }

  .skeleton-list-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    min-height: 48px;
  }

  .skeleton-list-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background: oklch(from var(--color-border) l c h / 0.2);
    flex-shrink: 0;
  }

  .skeleton-list-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: transparent;
  }

  .skeleton-text-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  .skeleton-line {
    height: 10px;
    border-radius: var(--radius-full);
    background: oklch(from var(--color-border) l c h / 0.2);
  }

  .skeleton-line-title {
    width: 60%;
  }

  .skeleton-line-text {
    width: 100%;
  }

  .skeleton-line-text.short {
    width: 40%;
  }

  .skeleton-circle {
    border-radius: 50%;
  }

  .skeleton-bar {
    border-radius: var(--radius-full);
  }
</style>
