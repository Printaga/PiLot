<script lang="ts">
	import { onMount } from 'svelte';

	interface ProviderAuth {
		provider: string;
		name: string;
		configured: boolean;
		status: string;
	}

	interface Props {
		providers: ProviderAuth[];
	}

	let { providers = [] }: Props = $props();

	let editingProvider = $state<string | null>(null);
	let apiKeyInput = $state('');
	let showApiKey = $state(false);

	const sortedProviders = $derived.by(() => {
		const configured = providers
			.filter((p) => p.configured)
			.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		const unconfigured = providers
			.filter((p) => !p.configured)
			.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		return { configured, unconfigured };
	});

	onMount(() => {
		sendMessage({ type: 'getProviderAuth' });
	});

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	function startEditApiKey(provider: string) {
		editingProvider = provider;
		apiKeyInput = '';
		showApiKey = false;
	}

	function cancelEditApiKey() {
		editingProvider = null;
		apiKeyInput = '';
	}

	async function saveApiKey() {
		if (!editingProvider || !apiKeyInput.trim()) return;
		sendMessage({
			type: 'setApiKey',
			data: { provider: editingProvider, apiKey: apiKeyInput.trim() }
		});
		providers = providers.map((p) =>
			p.provider === editingProvider ? { ...p, configured: true, status: 'stored' } : p
		);
		editingProvider = null;
		apiKeyInput = '';
	}

	async function removeAuth(provider: string) {
		sendMessage({
			type: 'removeAuth',
			data: { provider }
		});
		providers = providers.map((p) =>
			p.provider === provider ? { ...p, configured: false, status: 'not_configured' } : p
		);
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'stored': return 'API Key saved';
			case 'environment': return 'Using env var';
			case 'runtime': return 'Runtime override';
			case 'oauth': case 'oauth_configured': return 'OAuth configured';
			case 'models_json_key': return 'Key from models.json';
			case 'models_json_command': return 'Command from models.json';
			case 'configured': return 'Configured';
			case 'not_configured': default: return 'Not configured';
		}
	}
</script>

<div class="provider-settings">
	<div class="header">
		<h3>Provider API Settings</h3>
		<span class="subtitle">Configure API keys for model providers</span>
	</div>

	<div class="auth-list">
		{#each sortedProviders.configured as p}
			<div class="auth-card" data-configured={p.configured}>
				<div class="auth-main">
					<div class="auth-icon">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0110 0v4" />
						</svg>
					</div>
					<div class="auth-info">
						<span class="auth-name">{p.name}</span>
						<span class="auth-status" class:configured={p.configured}>
							{statusLabel(p.status)}
						</span>
					</div>
				</div>

				{#if editingProvider === p.provider}
					<div class="auth-editor">
						<div class="input-group">
							<input
								type={showApiKey ? 'text' : 'password'}
								bind:value={apiKeyInput}
								placeholder="Paste API Key here..."
								onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
							/>
							<button
								class="vis-toggle"
								onclick={() => (showApiKey = !showApiKey)}
							>
								{#if showApiKey}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
								{/if}
							</button>
						</div>
						<div class="auth-actions">
							<button class="btn primary small" onclick={saveApiKey}>Save</button>
							<button class="btn small" onclick={cancelEditApiKey}>Cancel</button>
						</div>
					</div>
				{:else}
					<div class="auth-actions">
						{#if p.configured}
							<button
								class="icon-btn danger"
								onclick={() => removeAuth(p.provider)}
								title="Remove credentials"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{/if}
						<button
							class="btn small"
							class:primary={!p.configured}
							onclick={() => startEditApiKey(p.provider)}
						>
							{p.configured ? 'Update' : 'Configure'}
						</button>
					</div>
				{/if}
			</div>
		{/each}

		{#if sortedProviders.configured.length > 0 && sortedProviders.unconfigured.length > 0}
			<div class="separator" role="separator">
				<span>Unconfigured Providers</span>
			</div>
		{/if}

		{#each sortedProviders.unconfigured as p}
			<div class="auth-card" data-configured={p.configured}>
				<div class="auth-main">
					<div class="auth-icon">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0110 0v4" />
						</svg>
					</div>
					<div class="auth-info">
						<span class="auth-name">{p.name}</span>
						<span class="auth-status" class:configured={p.configured}>
							{statusLabel(p.status)}
						</span>
					</div>
				</div>

				{#if editingProvider === p.provider}
					<div class="auth-editor">
						<div class="input-group">
							<input
								type={showApiKey ? 'text' : 'password'}
								bind:value={apiKeyInput}
								placeholder="Paste API Key here..."
								onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
							/>
							<button
								class="vis-toggle"
								onclick={() => (showApiKey = !showApiKey)}
							>
								{#if showApiKey}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
								{/if}
							</button>
						</div>
						<div class="auth-actions">
							<button class="btn primary small" onclick={saveApiKey}>Save</button>
							<button class="btn small" onclick={cancelEditApiKey}>Cancel</button>
						</div>
					</div>
				{:else}
					<div class="auth-actions">
						{#if p.configured}
							<button
								class="icon-btn danger"
								onclick={() => removeAuth(p.provider)}
								title="Remove credentials"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						{/if}
						<button
							class="btn small"
							class:primary={!p.configured}
							onclick={() => startEditApiKey(p.provider)}
						>
							{p.configured ? 'Update' : 'Configure'}
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.provider-settings {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-4);
		overflow-y: auto;
	}

	.header {
		margin-bottom: var(--space-4);
	}

	h3 {
		font-size: var(--text-lg);
		font-weight: 800;
		margin-bottom: var(--space-1);
	}

	.subtitle {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.auth-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.auth-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.auth-main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.auth-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var(--color-text-muted);
	}

	.separator {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		margin: var(--space-2) 0;
	}

	.separator::before,
	.separator::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.separator span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.auth-info { display: flex; flex-direction: column; line-height: 1.2; }

	.auth-name { font-size: var(--text-sm); font-weight: 600; }

	.auth-status { font-size: 10px; color: var(--color-text-muted); }
	.auth-status.configured { color: var(--color-success); }

	.auth-actions { display: flex; gap: var(--space-2); }

	.btn {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.btn.primary { background: var(--color-primary); color: var(--color-text-inverse); border-color: var(--color-primary); }
	.btn.small { padding: 4px 12px; font-size: 11px; }

	.icon-btn {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.icon-btn.danger { color: var(--color-error); }
	.icon-btn.danger:hover { background: oklch(from var(--color-error) l c h / 0.1); }

	.auth-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.input-group {
		display: flex;
		background: var(--color-surface);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.input-group input {
		flex: 1;
		background: transparent;
		border: none;
		padding: 6px 10px;
		font-size: 11px;
	}

	.vis-toggle {
		padding: 0 10px;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}
</style>