<script lang="ts">
	interface Model {
		id: string;
		provider: string;
		name: string;
	}

	interface Props {
		currentModel: string | null;
		modelName: string;
		providerName: string;
		thinkingLevel: string;
		onNewSession?: () => void;
		isStreaming?: boolean;
		favoriteModels: string[];
		models: Model[];
		onSelectFavorite: (modelId: string) => void;
		onThinkingLevelChange: (level: string) => void;
		onRenameSession?: () => void;
		onSwitchToModels?: () => void;
		onRunUpdate?: () => void;
		hasUpdates?: boolean;
		piUpdateAvailable?: string | null;
		packageUpdateCount?: number;
	}

	let {
		currentModel = null,
		modelName = '',
		providerName = '',
		thinkingLevel = 'medium',
		onNewSession,
		isStreaming = false,
		favoriteModels = [],
		models = [],
		onSelectFavorite,
		onThinkingLevelChange,
		onRenameSession = () => {},
		onSwitchToModels = () => {},
		onRunUpdate = () => {},
		hasUpdates = false,
		piUpdateAvailable = null,
		packageUpdateCount = 0
	}: Props = $props();

	let showFavDropdown = $state(false);
	let favWrapperEl = $state<HTMLElement | null>(null);
	let showThinkDropdown = $state(false);
	let thinkWrapperEl = $state<HTMLElement | null>(null);

	const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

	$effect(() => {
		if (!showThinkDropdown) return;

		function handleClick(e: MouseEvent) {
			if (thinkWrapperEl && !thinkWrapperEl.contains(e.target as Node)) {
				showThinkDropdown = false;
			}
		}

		const id = setTimeout(() => {
			document.addEventListener('click', handleClick);
		}, 0);

		return () => {
			clearTimeout(id);
			document.removeEventListener('click', handleClick);
		};
	});

	$effect(() => {
		if (!showFavDropdown) return;

		function handleClick(e: MouseEvent) {
			if (favWrapperEl && !favWrapperEl.contains(e.target as Node)) {
				showFavDropdown = false;
			}
		}

		// Delay adding listener so the click that opened dropdown doesn't close it
		const id = setTimeout(() => {
			document.addEventListener('click', handleClick);
		}, 0);

		return () => {
			clearTimeout(id);
			document.removeEventListener('click', handleClick);
		};
	});

	const favModelDetails = $derived(
		favoriteModels.map(id => models.find(m => m.id === id)).filter(Boolean) as Model[]
	);

	function getUpdateTitle(piVersion: string | null | undefined, pkgCount: number): string {
		if (!piVersion && pkgCount === 0) {
			return "Check for updates";
		}
		const parts: string[] = [];
		if (piVersion) parts.push(`PI CLI v${piVersion} available`);
		if (pkgCount > 0) parts.push(`${pkgCount} package update(s)`);
		return `Updates Available\n${parts.join("\n")}\n\nClick to run pi update`;
	}

	let mediaIcon = $state(
		typeof window !== 'undefined' ? ((window as any).__MEDIA_ICON__ as string | undefined) ?? '' : ''
	);

</script>

<header class="header">
	<div class="header-left">
		<div class="logo" title="PiLot Studio">
			{#if mediaIcon}
				<img src={mediaIcon} alt="PiLot Studio" class="logo-image" />
			{:else}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
					<rect x="2" y="2" width="20" height="20" rx="6" stroke="var(--color-primary)" stroke-width="2" />
					<path d="M7 8h10M12 8v8M9 16h6" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" />
					<circle cx="12" cy="12" r="10" stroke="var(--accent-glow)" stroke-width="4" opacity="0.2" />
				</svg>
			{/if}
		</div>

		{#if currentModel}
			<div class="model-info" title={`Model: ${modelName}\nProvider: ${providerName}\nThinking: ${thinkingLevel}\n\nClick to change model`} onclick={onSwitchToModels} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && onSwitchToModels()}>
				<span class="provider-tag">{providerName}</span>
				<span class="model-name">{modelName}</span>
			</div>
		{/if}

		{#if favoriteModels.length > 0}
			<div class="fav-wrapper" bind:this={favWrapperEl}>
				<button
					class="fav-btn"
					onclick={() => (showFavDropdown = !showFavDropdown)}
					title="Quick-select favorite models"
					data-active={showFavDropdown}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
					</svg>
					<span class="fav-badge">{favoriteModels.length}</span>
				</button>

				{#if showFavDropdown}
					<div class="dropdown fav-dropdown">
						<div class="dropdown-header">Favorites</div>
						<div class="dropdown-content">
							{#each favModelDetails as m}
								<button
									class="dropdown-item"
									class:active={currentModel === m.id}
									onclick={() => {
										onSelectFavorite(m.id);
										showFavDropdown = false;
									}}
								>
									<div class="item-meta">
										<span class="item-provider">{m.provider}</span>
										<span class="item-name">{m.name}</span>
									</div>
									{#if currentModel === m.id}
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
											<polyline points="20 6 9 17 4 12" />
										</svg>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="header-right">
		<button class="new-session-btn" onclick={onNewSession} title="New Session">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
				<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
			</svg>
		</button>
		<button class="rename-session-btn" onclick={onRenameSession} title="Rename Session">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
				<path d="M18.5 8.5a2.121 2.121 0 0 1 3 3L12 20l-4 1 1-4h5.5z" />
			</svg>
		</button>
		<button
			class="update-btn"
			class:has-updates={hasUpdates}
			onclick={onRunUpdate}
			title={getUpdateTitle(piUpdateAvailable, packageUpdateCount)}
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
			</svg>
			{#if hasUpdates && packageUpdateCount > 0}
				<span class="update-badge">{packageUpdateCount}</span>
			{/if}
		</button>
		
		<div class="think-wrapper" bind:this={thinkWrapperEl}>
			<button
				class="think-btn"
				onclick={() => (showThinkDropdown = !showThinkDropdown)}
				title="Change thinking level"
				data-active={showThinkDropdown}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z" />
					<path d="M12 6v6l4 2" />
				</svg>
				<span class="think-value">{thinkingLevel}</span>
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="chevron">
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showThinkDropdown}
				<div class="dropdown think-dropdown">
					<div class="dropdown-header">Thinking Intensity</div>
					<div class="dropdown-content">
						{#each thinkingLevels as level}
							<button
								class="dropdown-item"
								class:active={thinkingLevel === level}
								onclick={() => {
									onThinkingLevelChange(level);
									showThinkDropdown = false;
								}}
							>
								<span class="item-name">{level}</span>
								{#if thinkingLevel === level}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
										<polyline points="20 6 9 17 4 12" />
									</svg>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>


	</div>
</header>

<style>
	.header {
		height: 48px;
		background: oklch(from var(--color-surface) l c h / 0.4);
		backdrop-filter: blur(24px);
		border-bottom: 1px solid var(--glass-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-5);
		gap: var(--space-4);
		z-index: 1000;
		box-shadow: 0 1px 12px oklch(0% 0 0 / 0.1);
	}

	.header-left, .header-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.logo {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		transition: all var(--transition-bounce);
		cursor: default;
	}

	.logo-image {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		object-fit: contain;
	}

	.logo:hover {
		transform: scale(1.1) rotate(2deg);
		filter: drop-shadow(0 0 8px var(--accent-glow));
	}

	.model-info {
		display: flex;
		flex-direction: column;
		padding: var(--space-1) var(--space-3);
		background: var(--surface-tint);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		line-height: 1.2;
		flex-shrink: 1;
		min-width: 0;
		transition: all var(--transition-interactive);
	}

	.model-info:hover {
		border-color: var(--color-primary);
		background: var(--accent-glow);
	}

	.provider-tag {
		font-size: 9px;
		color: var(--color-primary);
		text-transform: uppercase;
		font-weight: 800;
		letter-spacing: 0.08em;
	}

	.model-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.fav-wrapper, .think-wrapper {
		position: relative;
	}

	.fav-btn, .think-btn {
		height: 30px;
		padding: 0 var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		transition: all var(--transition-interactive);
	}

	.fav-btn:hover, .think-btn:hover,
	.fav-btn[data-active="true"], .think-btn[data-active="true"] {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--surface-tint);
		box-shadow: 0 2px 8px var(--accent-glow);
	}

	.fav-badge {
		background: var(--color-primary);
		color: var(--color-text-inverse);
		font-size: 10px;
		font-weight: 700;
		padding: 0 5px;
		border-radius: var(--radius-full);
		margin-left: -2px;
		box-shadow: 0 2px 4px oklch(0% 0 0 / 0.2);
	}

	.think-value {
		text-transform: capitalize;
		margin: 0 2px;
	}

	.chevron {
		opacity: 0.5;
		transition: transform var(--transition-interactive);
	}

	.think-btn[data-active="true"] .chevron {
		transform: rotate(180deg);
		opacity: 1;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 8px);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		z-index: 1000;
		min-width: 200px;
		animation: slide-down 0.2s cubic-bezier(0, 0, 0.2, 1);
	}

	.fav-dropdown { left: 0; }
	.think-dropdown { right: 0; }

	@keyframes slide-down {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.dropdown-header {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--color-divider);
	}

	.dropdown-content {
		max-height: 300px;
		overflow-y: auto;
		padding: var(--space-2);
	}

	.dropdown-item {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		text-align: left;
		transition: all var(--transition-interactive);
	}

	.dropdown-item:hover {
		background: var(--color-surface-2);
	}

	.dropdown-item.active {
		background: var(--accent-glow);
		color: var(--color-primary);
	}

	.item-meta {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.item-provider {
		font-size: 9px;
		text-transform: uppercase;
		opacity: 0.6;
	}

	.item-name {
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.new-session-btn {
		height: 28px;
		padding: 0 var(--space-3);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		font-weight: 700;
		box-shadow: 0 0 10px oklch(from var(--color-primary) l c h / 0.25);
	}

	.new-session-btn:hover {
		filter: brightness(1.15);
		transform: scale(1.03);
		box-shadow: 0 0 14px oklch(from var(--color-primary) l c h / 0.4);
	}

	.rename-session-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
	}

	.rename-session-btn:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
		color: var(--color-primary);
	}

	.update-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		position: relative;
		transition: all var(--transition-interactive);
	}

	.update-btn:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
		color: var(--color-primary);
		transform: scale(1.05);
	}

	.update-btn.has-updates {
		background: oklch(from var(--color-warning, #eab308) l c h / 0.15);
		border-color: oklch(from var(--color-warning, #eab308) l c h / 0.3);
		color: var(--color-warning, #eab308);
		animation: pulse-update 2s ease-in-out infinite;
	}

	.update-btn.has-updates:hover {
		background: oklch(from var(--color-warning, #eab308) l c h / 0.25);
		border-color: var(--color-warning, #eab308);
		transform: scale(1.1);
	}

	.update-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		font-size: 9px;
		font-weight: 800;
		line-height: 14px;
		text-align: center;
		background: var(--color-error, #ef4444);
		color: white;
		border-radius: var(--radius-full);
		box-shadow: 0 1px 4px oklch(0% 0 0 / 0.3);
	}

	@keyframes pulse-update {
		0%, 100% { box-shadow: 0 0 0 0 oklch(from var(--color-warning, #eab308) l c h / 0.3); }
		50% { box-shadow: 0 0 0 6px oklch(from var(--color-warning, #eab308) l c h / 0); }
	}


</style>
