<script lang="ts">
	interface ActivityItem {
		text: string;
		type: "extension" | "tool" | "system";
		timestamp: number;
	}

	interface Props {
		activities: Record<string, ActivityItem>;
	}

	let { activities }: Props = $props();

	const typeConfig: Record<string, { label: string; icon: string }> = {
		extension: { label: "pkg", icon: "📦" },
		tool: { label: "tool", icon: "⚙️" },
		system: { label: "sys", icon: "⚡" },
	};

	const sortedActivities = $derived(
		Object.entries(activities).sort(([, a], [, b]) => a.timestamp - b.timestamp),
	);
</script>

{#if sortedActivities.length > 0}
	<div class="activity-bar">
		{#each sortedActivities as [key, item] (key)}
			<span class="activity-pill" data-type={item.type} title={item.text}>
				<span class="activity-dot"></span>
				<span class="activity-type">{typeConfig[item.type]?.label || item.type}</span>
				<span class="activity-text">{item.text}</span>
			</span>
		{/each}
	</div>
{/if}

<style>
	.activity-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-4);
		min-height: 24px;
		max-height: 28px;
		overflow-x: auto;
		overflow-y: hidden;
		background: var(--color-surface-2);
		border-top: 1px solid oklch(from var(--color-border) l c h / 0.1);
		flex-shrink: 0;
		scrollbar-width: none;
	}

	.activity-bar::-webkit-scrollbar {
		display: none;
	}

	.activity-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		white-space: nowrap;
		animation: pill-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
		flex-shrink: 0;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.activity-pill[data-type="extension"] {
		background: oklch(from var(--color-primary) l c h / 0.12);
		color: var(--color-primary);
		border: 1px solid oklch(from var(--color-primary) l c h / 0.25);
	}

	.activity-pill[data-type="tool"] {
		background: oklch(from var(--color-success) l c h / 0.12);
		color: var(--color-success);
		border: 1px solid oklch(from var(--color-success) l c h / 0.25);
	}

	.activity-pill[data-type="system"] {
		background: oklch(from var(--color-warning) l c h / 0.12);
		color: var(--color-warning);
		border: 1px solid oklch(from var(--color-warning) l c h / 0.25);
	}

	.activity-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
		animation: dot-pulse 1.4s ease-in-out infinite;
	}

	.activity-type {
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.activity-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes dot-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	@keyframes pill-slide-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>