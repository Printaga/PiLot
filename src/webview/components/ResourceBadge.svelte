<script lang="ts">
	interface Props {
		type: 'files' | 'skills' | 'extensions' | 'prompts' | 'packages';
		count: number;
		previousCount?: number;
		title: string;
		onClick?: () => void;
	}

	let { type, count, previousCount = 0, title, onClick }: Props = $props();

	let showTooltip = $state(false);

	const hasChanged = $derived(previousCount !== count && previousCount > 0);

	const icons: Record<string, string> = {
		files: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
		skills: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
		extensions: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
		prompts: 'M12 2v4 M12 22v-4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83',
		packages: 'M21 16.5c0 .552-.448 1-1 1H4c-.552 0-1-.448-1-1V8.5c0-.552.448-1 1-1h16c.552 0 1 .448 1 1v8zM21 8.5V6c0-.552-.448-1-1-1H4c-.552 0-1-.448-1-1v2.5M4 12h16'
	};

	const labels: Record<string, string> = {
		files: 'Files',
		skills: 'Skills',
		extensions: 'Exts',
		prompts: 'Prompts',
		packages: 'Pkgs'
	};
</script>

{#if count > 0}
	<div
		class="resource-badge-wrapper"
		role="group"
		onmouseenter={() => showTooltip = true}
		onmouseleave={() => showTooltip = false}
		onfocusin={() => showTooltip = true}
		onfocusout={() => showTooltip = false}
	>
		<button
			class="resource-badge"
			class:changed={hasChanged}
			data-type={type}
			onclick={onClick}
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<path d={icons[type] || icons.files} />
			</svg>
			<span>{count} {labels[type] || type}</span>
			{#if hasChanged}
				<span class="change-dot"></span>
			{/if}
		</button>
		{#if showTooltip && title}
			<div class="custom-tooltip" role="tooltip">
				{#each title.split('\n') as line, i}
					<div class="tooltip-line">{line}</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.resource-badge-wrapper {
		position: relative;
		display: inline-flex;
	}

	.resource-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 3px var(--space-2);
		background: oklch(from var(--color-surface-2) l c h / 0.5);
		border: 1px solid oklch(from var(--color-border) l c h / 0.2);
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-muted);
		transition: all var(--transition-interactive);
		cursor: pointer;
	}

	.resource-badge:hover {
		border-color: var(--color-primary);
		background: var(--accent-glow);
		color: var(--color-primary);
		transform: translateY(-1px);
	}

	.resource-badge svg {
		opacity: 0.6;
	}

	.resource-badge:hover svg {
		opacity: 1;
	}

	.resource-badge.changed {
		border-color: var(--color-warning);
		animation: badge-pulse 2s ease-in-out 3;
	}

	@keyframes badge-pulse {
		0%, 100% { box-shadow: 0 0 0 0 oklch(from var(--color-warning) l c h / 0); }
		50% { box-shadow: 0 0 0 4px oklch(from var(--color-warning) l c h / 0.15); }
	}

	.change-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warning);
		animation: dot-blink 1.5s ease-in-out infinite;
	}

	@keyframes dot-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.custom-tooltip {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		min-width: 120px;
		max-width: 260px;
		max-height: 200px;
		overflow-y: auto;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid oklch(from var(--color-primary) l c h / 0.25);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px oklch(0% 0 0 / 0.2);
		animation: tooltip-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		pointer-events: none;
	}

	@keyframes tooltip-in {
		from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	.tooltip-line {
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
