<script lang="ts">
	interface Toast {
		id: string;
		type: 'info' | 'success' | 'warning' | 'error';
		title: string;
		message?: string;
		persistent?: boolean;
		duration?: number;
	}

	let toasts = $state<Toast[]>([]);
	let toastIdCounter = 0;

	export function showToast(opts: Omit<Toast, 'id'>) {
		const id = `toast-${++toastIdCounter}`;
		const toast: Toast = { ...opts, id };
		toasts = [...toasts, toast];

		if (!opts.persistent && (opts.duration ?? 30000) > 0) {
			setTimeout(() => dismissToast(id), opts.duration ?? 30000);
		}
		return id;
	}

	export function dismissToast(id: string) {
		toasts = toasts.filter(t => t.id !== id);
	}

	export function clearToasts() {
		toasts = [];
	}

	// Expose globally for other components to use
	if (typeof window !== 'undefined') {
		(window as any).__toast = { showToast, dismissToast, clearToasts };
	}

	function getTypeIcon(type: Toast['type']): string {
		switch (type) {
			case 'success': return '✓';
			case 'warning': return '⚠';
			case 'error': return '✕';
			case 'info': return 'ℹ';
		}
	}
</script>

{#if toasts.length > 0}
	<div class="toast-container" role="status" aria-live="polite">
		{#each toasts as toast (toast.id)}
			<div
				class="toast toast-{toast.type}"
				role="alert"
				style="animation: toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
			>
				<div class="toast-icon">{getTypeIcon(toast.type)}</div>
				<div class="toast-body">
					<div class="toast-title">{toast.title}</div>
					{#if toast.message}
						<div class="toast-message">{toast.message}</div>
					{/if}
				</div>
				<button
					class="toast-close"
					onclick={() => dismissToast(toast.id)}
					aria-label="Dismiss"
				>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
						<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: var(--space-4);
		right: var(--space-4);
		z-index: 10000;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 380px;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 32px oklch(0% 0 0 / 0.25);
		pointer-events: auto;
		animation: toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes toast-in {
		from { opacity: 0; transform: translateX(24px) scale(0.95); }
		to { opacity: 1; transform: translateX(0) scale(1); }
	}

	.toast-icon {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		font-size: 12px;
		font-weight: 800;
	}

	.toast-success .toast-icon { background: oklch(from var(--color-success) l c h / 0.15); color: var(--color-success); }
	.toast-warning .toast-icon { background: oklch(from var(--color-warning) l c h / 0.15); color: var(--color-warning); }
	.toast-error .toast-icon { background: oklch(from var(--color-error) l c h / 0.15); color: var(--color-error); }
	.toast-info .toast-icon { background: oklch(from var(--color-primary) l c h / 0.15); color: var(--color-primary); }

	.toast-body {
		flex: 1;
		min-width: 0;
	}

	.toast-title {
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--color-text);
	}

	.toast-message {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin-top: 2px;
		line-height: 1.4;
	}

	.toast-close {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		opacity: 0.5;
		transition: all var(--transition-fast);
	}

	.toast-close:hover {
		opacity: 1;
		background: var(--surface-tint);
		color: var(--color-text);
	}
</style>
