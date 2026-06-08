<script lang="ts">
	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let exportFormat = $state<'html' | 'markdown' | 'jsonl'>('html');
	let exportStatus = $state<'idle' | 'exporting' | 'done' | 'error'>('idle');
	let statusMessage = $state('');

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	async function handleExport() {
		exportStatus = 'exporting';
		statusMessage = `Exporting as ${exportFormat.toUpperCase()}...`;

		try {
			// Use the /export slash command via prompt
			const cmd = exportFormat === 'jsonl' ? '/export .jsonl' :
						exportFormat === 'markdown' ? '/export .md' :
						'/export .html';

			sendMessage({ type: 'prompt', data: { text: cmd } });
			statusMessage = 'Export started via PI agent...';
			exportStatus = 'done';
		} catch (e) {
			exportStatus = 'error';
			statusMessage = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	function copyToClipboard(content: string) {
		navigator.clipboard.writeText(content).then(() => {
			statusMessage = 'Copied to clipboard!';
			setTimeout(() => { statusMessage = ''; }, 2000);
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="export-overlay" role="dialog" aria-modal="true" aria-label="Export session" tabindex="-1" onclick={onClose} onkeydown={handleKeydown}>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div class="export-dialog" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
		<div class="dialog-header">
			<h3>Export Chat Session</h3>
			<button class="close-btn" onclick={onClose} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</div>

		<p class="dialog-desc">Choose a format to export the current session.</p>

		<div class="format-options">
			<button
				class="format-option"
				class:selected={exportFormat === 'html'}
				onclick={() => (exportFormat = 'html')}
			>
				<div class="format-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
						<polyline points="14 2 14 8 20 8"/>
						<line x1="16" y1="13" x2="8" y2="13"/>
						<line x1="16" y1="17" x2="8" y2="17"/>
						<polyline points="10 9 9 9 8 9"/>
					</svg>
				</div>
				<div class="format-info">
					<span class="format-name">HTML</span>
					<span class="format-desc">Rich export with syntax highlighting. Best for sharing.</span>
				</div>
			</button>

			<button
				class="format-option"
				class:selected={exportFormat === 'markdown'}
				onclick={() => (exportFormat = 'markdown')}
			>
				<div class="format-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
						<polyline points="14 2 14 8 20 8"/>
						<line x1="16" y1="13" x2="8" y2="13"/>
						<line x1="16" y1="17" x2="8" y2="17"/>
					</svg>
				</div>
				<div class="format-info">
					<span class="format-name">Markdown</span>
					<span class="format-desc">Plain text export. Great for documentation.</span>
				</div>
			</button>

			<button
				class="format-option"
				class:selected={exportFormat === 'jsonl'}
				onclick={() => (exportFormat = 'jsonl')}
			>
				<div class="format-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
						<polyline points="14 2 14 8 20 8"/>
						<path d="M8 13h2M8 17h2M14 13h2"/>
					</svg>
				</div>
				<div class="format-info">
					<span class="format-name">JSONL</span>
					<span class="format-desc">Machine-readable format. Can be re-imported later.</span>
				</div>
			</button>
		</div>

		{#if statusMessage}
			<div class="status-message" class:error={exportStatus === 'error'} class:success={exportStatus === 'done'}>
				{statusMessage}
			</div>
		{/if}

		<div class="dialog-actions">
			<button class="action-btn secondary" onclick={onClose}>Cancel</button>
			<button
				class="action-btn primary"
				onclick={handleExport}
				disabled={exportStatus === 'exporting'}
			>
				{#if exportStatus === 'exporting'}
					<span class="spin"></span>
					Exporting...
				{:else}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
						<polyline points="7 10 12 15 17 10"/>
						<line x1="12" y1="15" x2="12" y2="3"/>
					</svg>
					Export as {exportFormat.toUpperCase()}
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.export-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0% 0 0 / 0.5);
		backdrop-filter: blur(4px);
		animation: overlay-in 0.2s ease;
	}

	@keyframes overlay-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.export-dialog {
		width: 440px;
		max-width: 90vw;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: 0 24px 64px oklch(0% 0 0 / 0.3);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		animation: dialog-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes dialog-in {
		from { opacity: 0; transform: translateY(16px) scale(0.96); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	.dialog-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.dialog-header h3 {
		font-size: var(--text-lg);
		font-weight: 700;
	}

	.close-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
	}

	.close-btn:hover {
		background: var(--surface-tint);
		color: var(--color-text);
	}

	.dialog-desc {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.format-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.format-option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-align: left;
		transition: all var(--transition-interactive);
	}

	.format-option:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
	}

	.format-option.selected {
		border-color: var(--color-primary);
		background: oklch(from var(--color-primary) l c h / 0.08);
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	.format-icon {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface);
		border-radius: var(--radius-md);
		color: var(--color-primary);
	}

	.format-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.format-name {
		font-weight: 600;
		font-size: var(--text-sm);
	}

	.format-desc {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.status-message {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		background: oklch(from var(--color-success) l c h / 0.1);
		color: var(--color-success);
		text-align: center;
	}

	.status-message.error {
		background: oklch(from var(--color-error) l c h / 0.1);
		color: var(--color-error);
	}

	.status-message.success {
		background: oklch(from var(--color-success) l c h / 0.1);
		color: var(--color-success);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.action-btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		transition: all var(--transition-interactive);
	}

	.action-btn.primary {
		background: var(--color-primary);
		color: var(--color-text-inverse);
	}

	.action-btn.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.action-btn.secondary {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.action-btn.secondary:hover {
		border-color: var(--color-primary);
	}

	.spin {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
