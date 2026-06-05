<script lang="ts">
	import { onMount } from 'svelte';

	interface SessionItem {
		id: string;
		label: string;
		timestamp: number;
		messageCount: number;
	}

	let sessions = $state<SessionItem[]>([]);
	let loading = $state(true);
	let selectedId = $state<string | null>(null);

	onMount(() => {
		window.addEventListener('message', handleMessage);
		sendMessage({ type: 'listSessions' });

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	});

	function handleMessage(event: MessageEvent) {
		const { type, data } = event.data;
		if (type === 'sessions-list') {
			sessions = data || [];
			loading = false;
		} else if (type === 'ready' && data?.sessions) {
			sessions = data.sessions || [];
			loading = false;
		}
	}

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	function selectSession(id: string) {
		selectedId = id;
		sendMessage({ type: 'switchSession', data: { sessionId: id } });
	}

	function newSession() {
		selectedId = null;
		sendMessage({ type: 'newSession' });
	}

	function formatTime(ts: number): string {
		const date = new Date(ts);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		if (diff < 60000) return 'Just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
		return date.toLocaleDateString();
	}
</script>

<div class="session-list">
	<div class="session-header">
		<span class="title">History</span>
		<button class="add-btn" onclick={newSession} title="New Session">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
				<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
			</svg>
		</button>
	</div>

	<div class="list">
		{#if loading}
			<div class="empty">
				<div class="spinner"></div>
				<span>Loading history...</span>
			</div>
		{:else if sessions.length === 0}
			<div class="empty">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
					<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>No sessions yet</span>
			</div>
		{:else}
			{#each sessions as session}
				<div
					class="session-row"
					class:active={selectedId === session.id}
					onclick={() => selectSession(session.id)}
					onkeydown={(e) => e.key === 'Enter' && selectSession(session.id)}
					role="button"
					tabindex="0"
				>
					<div class="session-icon">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</div>
					<div class="info">
						<span class="label">{session.label || 'Untitled Session'}</span>
						<span class="meta">{session.messageCount} messages · {formatTime(session.timestamp)}</span>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.session-list {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: transparent;
	}

	.session-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-4) var(--space-4) var(--space-2);
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.add-btn {
		width: 24px;
		height: 24px;
		background: var(--surface-tint);
		color: var(--color-primary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--glass-border);
	}

	.add-btn:hover {
		background: var(--accent-glow);
		transform: scale(1.05);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--accent-glow);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.session-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-interactive);
		border: 1px solid transparent;
	}

	.session-row:hover {
		background: var(--surface-tint);
		border-color: var(--glass-border);
	}

	.session-row.active {
		background: var(--accent-glow);
		border-color: oklch(from var(--color-primary) l c h / 0.3);
	}

	.session-icon {
		margin-top: 2px;
		color: var(--color-text-muted);
		opacity: 0.5;
	}

	.active .session-icon {
		color: var(--color-primary);
		opacity: 1;
	}

	.info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		font-size: 10px;
		color: var(--color-text-muted);
		font-weight: 500;
	}
</style>
