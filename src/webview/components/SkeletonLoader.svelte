<script lang="ts">
	interface Props {
		type?: 'card' | 'list' | 'text' | 'circle' | 'bar';
		count?: number;
		height?: string;
		width?: string;
	}

	let { type = 'card', count = 1, height = 'auto', width = '100%' }: Props = $props();
</script>

{#if type === 'card'}
	{#each Array(count) as _}
		<div class="skeleton skeleton-card" style="height: {height}; width: {width};">
			<div class="skeleton-line skeleton-line-title"></div>
			<div class="skeleton-line skeleton-line-text"></div>
			<div class="skeleton-line skeleton-line-text short"></div>
		</div>
	{/each}
{:else if type === 'list'}
	{#each Array(count) as _}
		<div class="skeleton skeleton-list-item" style="width: {width};">
			<div class="skeleton-list-icon"></div>
			<div class="skeleton-list-content">
				<div class="skeleton-line skeleton-line-title"></div>
				<div class="skeleton-line skeleton-line-text short"></div>
			</div>
		</div>
	{/each}
{:else if type === 'text'}
	{#each Array(count) as _}
		<div class="skeleton skeleton-text-block" style="height: {height}; width: {width};">
			<div class="skeleton-line skeleton-line-text"></div>
			<div class="skeleton-line skeleton-line-text"></div>
			<div class="skeleton-line skeleton-line-text short"></div>
		</div>
	{/each}
{:else if type === 'circle'}
	{#each Array(count) as _}
		<div class="skeleton skeleton-circle" style="width: {width || '32px'}; height: {height || width || '32px'};"></div>
	{/each}
{:else if type === 'bar'}
	{#each Array(count) as _}
		<div class="skeleton skeleton-bar" style="height: {height || '8px'}; width: {width};"></div>
	{/each}
{/if}

<style>
	.skeleton {
		background: oklch(from var(--color-border) l c h / 0.15);
		border-radius: var(--radius-md);
		overflow: hidden;
		position: relative;
	}

	.skeleton::after {
		content: '';
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
	}

	@keyframes skeleton-shimmer {
		to { transform: translateX(100%); }
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
