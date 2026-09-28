<script lang="ts">
  /**
   * Renders a mermaid code fence as an SVG diagram.
   *
   * The mermaid library is lazy-loaded on first use (dynamic import), so
   * messages without diagrams never pay the bundle cost. Diagrams are rendered
   * with `securityLevel: "strict"` and always fall back to the raw source on
   * parse/render failure. Render output is cached by source text so unchanged
   * fences are not re-rendered on every streaming update.
   */

  interface Props {
    code: string;
  }

  let { code }: Props = $props();

  /** Lazily-initialized mermaid module (shared across all diagram instances). */
  let mermaidModule: typeof import("mermaid") | null = null;
  let mermaidInitialized = false;
  /** cache: source string -> rendered svg (or null = failed), LRU-bounded */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- memo cache, intentionally non-reactive
  const renderCache = new Map<string, string | null>();
  /** Upper bound on cached diagrams: SVG strings are large, and a long session
   *  with many edited fences would otherwise grow without limit. */
  const RENDER_CACHE_MAX_ENTRIES = 30;

  let renderedSvg = $state<string | null>(null);
  let hasError = $state(false);
  let isLoading = $state(true);

  async function ensureMermaid() {
    if (mermaidModule) return mermaidModule;
    const mod = await import("mermaid");
    mermaidModule = mod;
    if (!mermaidInitialized) {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
      });
      mermaidInitialized = true;
    }
    return mod;
  }

  function cacheSet(source: string, svg: string | null) {
    // LRU: refresh insertion order, then evict the oldest beyond the cap.
    renderCache.delete(source);
    renderCache.set(source, svg);
    while (renderCache.size > RENDER_CACHE_MAX_ENTRIES) {
      const oldest = renderCache.keys().next().value;
      if (oldest === undefined) break;
      renderCache.delete(oldest);
    }
  }

  /** Serve a cached render; returns true when state was applied. */
  function applyCachedRender(source: string, isCurrent: () => boolean): boolean {
    if (!renderCache.has(source)) return false;
    if (!isCurrent()) return true; // superseded: nothing to apply, done
    const cached = renderCache.get(source);
    renderedSvg = cached ?? null;
    hasError = cached === null;
    isLoading = false;
    return true;
  }

  /** Render fresh, cache it, and apply it — only if still the newest render. */
  async function renderFresh(source: string, isCurrent: () => boolean) {
    isLoading = true;
    hasError = false;
    try {
      const mod = await ensureMermaid();
      const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
      const { svg } = await mod.default.render(id, source);
      cacheSet(source, svg);
      // Only the newest render may write state: a superseded render finishing
      // out of order must not clobber the current diagram.
      if (!isCurrent()) return;
      renderedSvg = svg;
      isLoading = false;
    } catch {
      // Parse/render failure: fall back to showing the raw source.
      cacheSet(source, null);
      if (!isCurrent()) return;
      hasError = true;
      renderedSvg = null;
      isLoading = false;
    }
  }

  async function renderDiagram(source: string, isCurrent: () => boolean) {
    if (applyCachedRender(source, isCurrent)) return;
    if (!isCurrent()) return;
    await renderFresh(source, isCurrent);
  }

  // Re-render whenever the fence source changes (handles streaming updates);
  // unchanged sources are served from the cache. The token guard closes the
  // stale-render race: a slower older render never overwrites the newer one.
  $effect(() => {
    const src = code;
    let current = true;
    void renderDiagram(src, () => current).catch(() => {
      /* renderDiagram never rejects; keep the effect failure-free regardless */
    });
    return () => {
      current = false;
    };
  });
</script>

<div class="mermaid-diagram" class:error={hasError} class:loading={isLoading}>
  {#if isLoading && !renderedSvg}
    <div class="mermaid-loading">Rendering diagram…</div>
  {:else if hasError}
    <pre class="mermaid-source">{code}</pre>
    <span class="mermaid-error-hint">Could not render diagram</span>
  {:else if renderedSvg}
    {@html renderedSvg}
  {/if}
</div>

<style>
  .mermaid-diagram {
    position: relative;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin: var(--space-2) 0;
    overflow-x: auto;
  }
  .mermaid-diagram :global(svg) {
    max-width: 100%;
    height: auto;
  }
  .mermaid-loading {
    color: var(--color-muted);
    font-size: 12px;
  }
  .mermaid-source {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .mermaid-error-hint {
    display: block;
    margin-top: var(--space-2);
    font-size: 11px;
    color: var(--color-warning);
  }
  .mermaid-diagram.loading {
    opacity: 0.6;
  }
</style>
