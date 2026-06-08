<script lang="ts">
	interface Props {
		percent: number | null;
		contextTokens: number | null;
		contextWindow: number;
		autoCompaction: boolean;
		onCompact: () => void;
	}

	let { percent, contextTokens, contextWindow, autoCompaction, onCompact }: Props = $props();

	let compacting = $state(false);

	function handleClick() {
		compacting = true;
		onCompact();
	}

	// Listen for compaction_end event from extension
	$effect(() => {
		const vscode = (window as any).vscode;
		if (!vscode) return;

		function handleVSCodeMessage(event: MessageEvent) {
			const { type } = event.data;
			if (type === 'compaction_end') {
				compacting = false;
			}
		}

		window.addEventListener('message', handleVSCodeMessage);

		return () => {
			window.removeEventListener('message', handleVSCodeMessage);
		};
	});

	function getColor(pct: number | null): string {
		if (pct === null) return 'var(--color-text-muted)';
		if (pct >= 90) return 'var(--color-error)';
		if (pct >= 70) return 'var(--color-warning)';
		return 'var(--color-success)';
	}

	const strokeColor = $derived(getColor(percent));
	const label = $derived.by(() => {
		if (compacting) return '·';
		if (percent === null) return '---';
		return `${Math.round(percent)}%`;
	});

	// SVG circle calculations (30x30px viewbox, 4px radius for the ring)
	const size = 30;
	const strokeWidth = 2;
	const circleRadius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * circleRadius;
	const progress = $derived(percent !== null ? Math.min(percent, 100) / 100 : 0);
	const strokeDasharray = circumference;
	const strokeDashoffset = $derived(circumference * (1 - progress));
</script>

<button
	class="ctx-indicator"
	class:compacting
	class:auto-on={autoCompaction}
	onclick={handleClick}
	title={percent !== null
		? `Context: ${Math.round(percent)}% (${contextTokens?.toLocaleString() ?? '?'} / ${contextWindow.toLocaleString()} tokens)\nAuto-compaction: ${autoCompaction ? 'ON' : 'OFF'}\nClick to compact`
		: `Context window (no data yet) | Auto-compaction: ${autoCompaction ? 'ON' : 'OFF'}\nClick to compact`
	}
>
	<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="ctx-circle">
		<!-- Background circle -->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={circleRadius}
			fill="none"
			stroke="oklch(from var(--color-border) l c h / 0.2)"
			stroke-width={strokeWidth}
		/>
		<!-- Progress circle -->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={circleRadius}
			fill="none"
			stroke={strokeColor}
			stroke-width={strokeWidth}
			stroke-linecap="round"
			stroke-dasharray={strokeDasharray}
			stroke-dashoffset={strokeDashoffset}
			style="transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.3s ease;"
		/>
	</svg>
	<span class="ctx-label" style:color={strokeColor}>{label}</span>
</button>

<style>
	.ctx-indicator {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0;
		transition: all var(--transition-fast);
		cursor: pointer;
	}

	.ctx-indicator:hover {
		border-color: var(--color-primary);
		background: var(--color-surface);
		transform: translate(-2px, -2px);
		box-shadow: 2px 2px 0px var(--color-primary);
	}

	.ctx-indicator.compacting {
		opacity: 0.7;
		cursor: wait;
	}

	.auto-on {
		box-shadow: 2px 2px 0px var(--color-primary);
	}

	.ctx-circle {
		display: block;
	}

	.ctx-label {
		position: absolute;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		pointer-events: none;
	}
</style>