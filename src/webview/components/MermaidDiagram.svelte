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
	/** cache: source string -> rendered svg (or null = failed) */
	const renderCache = new Map<string, string | null>();

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

	async function renderDiagram(source: string) {
		if (renderCache.has(source)) {
			const cached = renderCache.get(source);
			renderedSvg = cached ?? null;
			hasError = cached === null;
			isLoading = false;
			return;
		}
		isLoading = true;
		hasError = false;
		try {
			const mod = await ensureMermaid();
			const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
			const { svg } = await mod.default.render(id, source);
			renderedSvg = svg;
			renderCache.set(source, svg);
		} catch (e) {
			// Parse/render failure: fall back to showing the raw source.
			renderCache.set(source, null);
			hasError = true;
			renderedSvg = null;
		} finally {
			isLoading = false;
		}
	}

	// Re-render whenever the fence source changes (handles streaming updates);
	// unchanged sources are served from the cache. Initial + every change.
	$effect(() => {
		const src = code;
		let cancelled = false;
		void renderDiagram(src).then(() => {
			if (cancelled) return;
		});
		return () => {
			cancelled = true;
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
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
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
