<script lang="ts">
	interface Model {
		id: string;
		provider: string;
		name: string;
	}

	interface ProviderAuth {
		provider: string;
		name: string;
		configured: boolean;
		status: string;
	}

	interface Props {
		models: Model[];
		currentModel: string | null;
		favoriteModels: string[];
		providers: ProviderAuth[];
		onSelect: (modelId: string) => void;
		onToggleFavorite: (modelId: string) => void;
		onOpenConfigFile: (file: "auth" | "models" | "settings") => void;
		onRefresh?: () => void;
	}

	let { models, currentModel, favoriteModels, providers = [], onSelect, onToggleFavorite, onOpenConfigFile, onRefresh }: Props = $props();

	const configuredProviderNames = $derived(
		new Set(providers.filter((p) => p.configured).map((p) => p.provider))
	);

	const configuredModels = $derived(
		models.filter((m) => configuredProviderNames.has(m.provider))
	);

	let selectedProvider = $state('all');
	let searchQuery = $state('');

	const providerNames = $derived(getProviders());

	function getProviders(): string[] {
		const providerSet = new Set(configuredModels.map((m) => m.provider));
		return ['all', ...Array.from(providerSet)];
	}

	const filteredModels = $derived.by(() => {
		if (!configuredModels) return [];
		
		let result = [...configuredModels];

		if (selectedProvider !== 'all') {
			result = result.filter((m) => m.provider === selectedProvider);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(m) => m.name.toLowerCase().includes(query) || m.provider.toLowerCase().includes(query)
			);
		}

		return result;
	});

	function selectModel(modelId: string) {
		onSelect(modelId);
	}

	</script>

<div class="model-selector">
	<div class="selector-header">
		<div class="title-row">
			<h3>Select Model</h3>
			<span class="badge">{configuredModels.length} Models</span>
			<div class="title-actions">
				<button
					class="btn small icon-btn"
					onclick={() => onRefresh?.()}
					title="Refresh model list"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
					</svg>
				</button>
				<button
					class="btn small config-btn"
					onclick={() => onOpenConfigFile('models')}
					title="Open models.json for manual editing"
				>
					Open models.json
				</button>
			</div>
		</div>
		
		<div class="controls">
			<div class="search-box">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<circle cx="11" cy="11" r="8" />
					<line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<input type="text" bind:value={searchQuery} placeholder="Filter by name or provider..." />
				{#if searchQuery}
					<button class="clear-btn" onclick={() => searchQuery = ''} aria-label="Clear filter" title="Clear filter">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
							<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				{/if}
			</div>

			<div class="filter-scroll">
				<div class="filter-chips">
					{#each providerNames as provider}
						<button
							class="chip"
							class:active={selectedProvider === provider}
							onclick={() => (selectedProvider = provider)}
						>
							{provider === 'all' ? 'All Providers' : provider}
						</button>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<div class="model-grid">
		{#each filteredModels as model}
			<div
				class="model-item"
				class:selected={currentModel === model.id}
				onclick={() => selectModel(model.id)}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && selectModel(model.id)}
			>
				<div class="item-main">
					<div class="item-header">
						<span class="provider-pill">{model.provider}</span>
						<button
							class="fav-btn"
							class:active={favoriteModels.includes(model.id)}
							onclick={(e) => { e.stopPropagation(); onToggleFavorite(model.id); }}
							title={favoriteModels.includes(model.id) ? 'Remove from favorites' : 'Add to favorites'}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill={favoriteModels.includes(model.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
								<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
							</svg>
						</button>
					</div>
					<div class="model-name">{model.name}</div>
				</div>
				
				{#if currentModel === model.id}
					<div class="selected-indicator">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
							<polyline points="20 6 9 17 4 12" />
						</svg>
						<span>Selected</span>
					</div>
				{/if}
			</div>
		{/each}

		{#if filteredModels.length === 0}
			<div class="empty-list">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
					<circle cx="12" cy="12" r="10" /><path d="M8 15h8" />
				</svg>
				<p>No models match your criteria</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.model-selector {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: var(--space-4);
		padding: var(--space-4);
		overflow-y: auto;
		overflow-x: hidden;
		background: transparent;
	}

	.selector-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.title-actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	h3 {
		font-size: var(--text-lg);
		font-weight: 800;
		letter-spacing: -0.01em;
	}

	.badge {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		background: var(--surface-tint);
		color: var(--color-primary);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		border: 1px solid var(--glass-border);
	}

	.config-btn {
		white-space: nowrap;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0 var(--space-3);
		height: 32px;
		transition: all var(--transition-interactive);
	}

	.search-box:focus-within {
		border-color: var(--color-primary);
		background: var(--color-surface);
		box-shadow: 0 0 0 2px var(--accent-glow);
	}

	.search-box svg {
		color: var(--color-text-muted);
		margin-right: var(--space-2);
	}

	.search-box input {
		flex: 1;
		background: transparent;
		border: none;
		padding: 0;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.clear-btn {
		padding: 4px;
		color: var(--color-text-muted);
	}

	.clear-btn:hover { color: var(--color-text); }

	.filter-scroll {
		overflow: visible;
	}

	.filter-chips {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.chip {
		white-space: nowrap;
		padding: 4px 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		transition: all var(--transition-interactive);
	}

	.chip:hover { border-color: var(--color-primary); color: var(--color-text); }

	.chip.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-text-inverse);
		box-shadow: 0 4px 8px oklch(from var(--color-primary) l c h / 0.2);
	}

	.model-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 2px;
	}

	.model-item {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		text-align: left;
		transition: all var(--transition-interactive);
		position: relative;
		cursor: pointer;
	}

	.item-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	.model-item:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
		transform: translateY(-1px);
		box-shadow: var(--shadow-sm);
	}

	.model-item.selected {
		border-color: var(--color-primary);
		background: var(--accent-glow);
	}

	.item-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}

	.provider-pill {
		font-size: 9px;
		font-weight: 800;
		text-transform: uppercase;
		color: var(--color-primary);
		opacity: 0.8;
	}

	.fav-btn {
		color: var(--color-text-muted);
		padding: 4px;
		border-radius: var(--radius-sm);
	}

	.fav-btn:hover { background: oklch(from var(--color-text) l c h / 0.1); color: var(--color-warning); }
	.fav-btn.active { color: var(--color-warning); }

	.model-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.selected-indicator {
		position: absolute;
		top: -1px;
		right: -1px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: var(--color-primary);
		color: var(--color-text-inverse);
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		border-radius: 0 var(--radius-lg) 0 var(--radius-lg);
	}

	.empty-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-12);
		gap: var(--space-4);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
