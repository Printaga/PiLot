<script lang="ts">
	import { onMount } from 'svelte';

	interface SessionItem {
		id: string;
		label: string;
		timestamp: number;
		messageCount: number;
		parentId?: string | null;
		branchName?: string;
	}

	interface TreeNode extends SessionItem {
		children: TreeNode[];
		level: number;
		expanded: boolean;
		isActive: boolean;
	}

	let sessions = $state<SessionItem[]>([]);
	let treeNodes = $state<TreeNode[]>([]);
	let loading = $state(true);
	let activeSessionId = $state<string | null>(null);
	let selectedNodeId = $state<string | null>(null);
	let showTreeView = $state(true);
	let searchQuery = $state('');

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
			buildTree();
		} else if (type === 'ready' && data?.sessions) {
			sessions = data.sessions || [];
			loading = false;
			buildTree();
		} else if (type === 'session-updated') {
			// Refresh when session changes
			activeSessionId = data?.sessionId || null;
			sendMessage({ type: 'listSessions' });
		}
	}

	function sendMessage(msg: any) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage(msg);
		}
	}

	function buildTree() {
		// Build a tree from flat sessions list
		const roots: TreeNode[] = [];
		const nodeMap = new Map<string, TreeNode>();

		// First pass: create nodes
		for (const session of sessions) {
			const node: TreeNode = {
				...session,
				children: [],
				level: 0,
				expanded: true,
				isActive: session.id === activeSessionId,
			};
			nodeMap.set(session.id, node);
		}

		// Second pass: establish parent-child relationships
		const sorted = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
		const assignedChildren = new Set<string>();

		for (let i = 0; i < sorted.length; i++) {
			const node = nodeMap.get(sorted[i].id);
			if (!node) continue;

			// Try to find a parent (earlier session with similar name prefix or close in time)
			let parent: TreeNode | null = null;
			for (let j = i - 1; j >= 0; j--) {
				const candidate = nodeMap.get(sorted[j].id);
				if (candidate && !assignedChildren.has(candidate.id)) {
					// Check if labels share common prefix (likely related branches)
					if (candidate.label && node.label &&
						candidate.label.slice(0, 20) === node.label.slice(0, 20)) {
						parent = candidate;
						break;
					}
					// Or if they're close in time (within 5 minutes)
					if (Math.abs(candidate.timestamp - node.timestamp) < 300000) {
						parent = candidate;
						break;
					}
				}
			}

			if (parent) {
				node.level = parent.level + 1;
				parent.children.push(node);
				assignedChildren.add(node.id);
			}
		}

		// Collect roots (nodes not assigned as children)
		for (const session of sessions) {
			const node = nodeMap.get(session.id);
			if (node && !assignedChildren.has(node.id) && !roots.some(r => r.id === node.id)) {
				roots.push(node);
			}
		}

		treeNodes = roots;
	}

	function selectSession(id: string) {
		selectedNodeId = id;
		activeSessionId = id;
		sendMessage({ type: 'switchSession', data: { sessionId: id } });
	}

	function forkSession(id: string) {
		sendMessage({ type: 'forkSession', data: { fromNode: id } });
	}

	function newSession() {
		selectedNodeId = null;
		sendMessage({ type: 'newSession' });
	}

	function navigateTree(nodeId: string) {
		sendMessage({ type: 'navigateTree', data: { nodeId } });
	}

	function toggleExpand(id: string) {
		treeNodes = treeNodes.map(n => updateNodeExpand(n, id));
	}

	function updateNodeExpand(node: TreeNode, id: string): TreeNode {
		if (node.id === id) {
			return { ...node, expanded: !node.expanded };
		}
		return { ...node, children: node.children.map(c => updateNodeExpand(c, id)) };
	}

	function collapseAll() {
		treeNodes = treeNodes.map(n => collapseNode(n));
	}

	function collapseNode(node: TreeNode): TreeNode {
		return { ...node, expanded: false, children: node.children.map(c => collapseNode(c)) };
	}

	function expandAll() {
		treeNodes = treeNodes.map(n => expandNode(n));
	}

	function expandNode(node: TreeNode): TreeNode {
		return { ...node, expanded: true, children: node.children.map(c => expandNode(c)) };
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

	function getBranchesFromNode(node: TreeNode): number {
		let count = node.children.length;
		for (const child of node.children) {
			count += getBranchesFromNode(child);
		}
		return count;
	}

	// Flatten the tree for flat rendering (avoids recursive snippet issues)
	function flattenVisibleTree(nodes: TreeNode[]): TreeNode[] {
		const result: TreeNode[] = [];
		for (const node of nodes) {
			result.push(node);
			if (node.expanded && node.children.length > 0) {
				result.push(...flattenVisibleTree(node.children));
			}
		}
		return result;
	}

	const filteredNodes = $derived(
		searchQuery
			? treeNodes.filter(n => n.label?.toLowerCase().includes(searchQuery.toLowerCase()))
			: treeNodes
	);

	const flatVisibleNodes = $derived(flattenVisibleTree(filteredNodes));

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			selectedNodeId = null;
		}
		// Arrow navigation
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const flat = flattenTree(treeNodes);
			const currentIdx = flat.findIndex(n => n.id === selectedNodeId);
			let nextIdx = e.key === 'ArrowDown'
				? Math.min(currentIdx + 1, flat.length - 1)
				: Math.max(currentIdx - 1, 0);
			if (currentIdx === -1) nextIdx = 0;
			if (flat[nextIdx]) {
				selectedNodeId = flat[nextIdx].id;
				document.getElementById(`session-${flat[nextIdx].id}`)?.scrollIntoView({ block: 'nearest' });
			}
		}
		// Fork on Ctrl+Enter
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && selectedNodeId) {
			forkSession(selectedNodeId);
		}
		// Select on Enter
		if (e.key === 'Enter' && selectedNodeId) {
			selectSession(selectedNodeId);
		}
	}

	function flattenTree(nodes: TreeNode[]): TreeNode[] {
		const result: TreeNode[] = [];
		for (const node of nodes) {
			result.push(node);
			if (node.expanded && node.children.length > 0) {
				result.push(...flattenTree(node.children));
			}
		}
		return result;
	}
</script>

<div class="session-tree-panel" onkeydown={handleKeydown} role="tree" aria-label="Session tree" tabindex="0">
	<div class="session-header">
		<div class="header-top">
			<span class="title">Sessions</span>
			<div class="header-actions">
				<button
					class="icon-btn"
					onclick={() => (showTreeView = !showTreeView)}
					title={showTreeView ? 'List view' : 'Tree view'}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						{#if showTreeView}
							<path d="M4 6h16M4 12h16M4 18h16"/>
						{:else}
							<path d="M4 4h4v4H4zM4 10h4v4H4zM4 16h4v4H4zM12 4h8v4h-8zM12 10h8v4h-8zM12 16h8v4h-8z"/>
						{/if}
					</svg>
				</button>
				<button class="icon-btn" onclick={expandAll} title="Expand all">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
				</button>
				<button class="icon-btn" onclick={collapseAll} title="Collapse all">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
				</button>
				<button class="add-btn" onclick={newSession} title="New Session (Ctrl+N)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
						<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
				</button>
			</div>
		</div>

		<div class="search-bar">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="search-icon">
				<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
			</svg>
			<input
				type="text"
				placeholder="Search sessions..."
				bind:value={searchQuery}
				class="search-input"
			/>
		</div>
	</div>

	<div class="list">
		{#if loading}
			<div class="empty">
				<div class="spinner"></div>
				<span>Loading sessions...</span>
			</div>
		{:else if sessions.length === 0}
			<div class="empty">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
					<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>No sessions yet</span>
				<button class="start-btn" onclick={newSession}>Start a session</button>
			</div>
		{:else if showTreeView}
			{#each flatVisibleNodes as node}
				<div class="tree-node" style="padding-left: {node.level * 16 + 8}px">
					<div
						id="session-{node.id}"
						class="session-row tree-row"
						class:active={activeSessionId === node.id}
						class:selected={selectedNodeId === node.id}
						class:expandable={node.children.length > 0}
						role="button"
						tabindex="0"
					>
						{#if node.children.length > 0}
							<button
								class="expand-btn"
								class:expanded={node.expanded}
								onclick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
								aria-label={node.expanded ? 'Collapse' : 'Expand'}
							>
								<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
									<polyline points="9 18 15 12 9 6"/>
								</svg>
							</button>
						{:else}
							<div class="expand-spacer"></div>
						{/if}

						<button type="button" class="session-icon" onclick={(e) => { e.stopPropagation(); selectSession(node.id); }} aria-label="Select session">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								{#if node.children.length > 0}
									<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9"/>
								{:else}
									<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
								{/if}
							</svg>
						</button>

						<button type="button" class="info" onclick={(e) => { e.stopPropagation(); selectSession(node.id); }} aria-label="Select session {node.label || 'Untitled'}">
							<span class="label">{node.label || 'Untitled'}</span>
							<span class="meta">{node.messageCount} msgs · {formatTime(node.timestamp)}</span>
						</button>

						<div class="node-actions">
							<button
								class="fork-btn"
								onclick={(e) => { e.stopPropagation(); forkSession(node.id); }}
								title="Fork from this session"
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M6 3v12 M18 3v12 M6 15a3 3 0 1 1-3 3 M18 15a3 3 0 1 1-3 3 M6 21a3 3 0 0 1-3-3 M18 21a3 3 0 0 1-3-3 M12 3v6 M10 9l2 2 2-2"/>
								</svg>
							</button>
							<button
								class="navigate-btn"
								onclick={(e) => { e.stopPropagation(); navigateTree(node.id); }}
								title="Navigate to this branch"
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M5 12h14 M12 5l7 7-7 7"/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			{/each}
		{:else}
			{#each sessions as session}
				<div
					id="session-{session.id}"
					class="session-row"
					class:active={activeSessionId === session.id}
					class:selected={selectedNodeId === session.id}
					onclick={() => selectSession(session.id)}
					onkeydown={(e) => { if (e.key === 'Enter') selectSession(session.id); if (e.key === 'Delete' && e.ctrlKey) forkSession(session.id); }}
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

	<div class="tree-footer">
		{#if sessions.length > 0}
			<span class="footer-info">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
			<span class="footer-hint">Ctrl+Click to fork</span>
		{/if}
	</div>
</div>

<style>
	.session-tree-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: transparent;
		outline: none;
	}

	.session-header {
		padding: var(--space-3) var(--space-4) var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border-bottom: 1px solid oklch(from var(--color-border) l c h / 0.15);
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.header-actions {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}

	.icon-btn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		opacity: 0.6;
		transition: all var(--transition-fast);
	}

	.icon-btn:hover {
		opacity: 1;
		color: var(--color-primary);
		background: var(--surface-tint);
	}

	.add-btn {
		width: 24px;
		height: 24px;
		background: var(--surface-tint);
		color: var(--color-primary);
		border-radius: var(--radius-sm);
		border: 1px solid oklch(from var(--color-primary) l c h / 0.2);
		margin-left: var(--space-1);
	}

	.add-btn:hover {
		background: var(--accent-glow);
		transform: scale(1.05);
	}

	.search-bar {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 8px;
		color: var(--color-text-muted);
		opacity: 0.5;
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 4px 8px 4px 24px;
		font-size: var(--text-xs);
		background: var(--color-surface-2);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}

	.search-input:focus {
		border-color: var(--color-primary);
		background: var(--color-surface);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 1px;
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

	.start-btn {
		padding: var(--space-2) var(--space-4);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.start-btn:hover {
		filter: brightness(1.1);
	}

	/* ── Tree node ─────────────────────────────── */
	.tree-node {
		width: 100%;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-interactive);
		border: 1px solid transparent;
		min-height: 40px;
	}

	.session-row:hover {
		background: var(--surface-tint);
		border-color: var(--glass-border);
	}

	.session-row.active {
		background: var(--accent-glow);
		border-color: oklch(from var(--color-primary) l c h / 0.3);
	}

	.session-row.selected {
		box-shadow: inset 0 0 0 1px var(--color-primary);
	}

	.expand-btn {
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		flex-shrink: 0;
		transition: transform var(--transition-fast);
	}

	.expand-btn.expanded {
		transform: rotate(90deg);
	}

	.expand-spacer {
		width: 16px;
		flex-shrink: 0;
	}

	.session-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--color-text-muted);
		opacity: 0.5;
	}

	.active .session-icon,
	.selected .session-icon {
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

	.node-actions {
		display: flex;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--transition-fast);
	}

	.session-row:hover .node-actions {
		opacity: 1;
	}

	.fork-btn,
	.navigate-btn {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		transition: all var(--transition-fast);
	}

	.fork-btn:hover {
		color: var(--color-primary);
		background: var(--accent-glow);
	}

	.navigate-btn:hover {
		color: var(--color-success);
		background: oklch(from var(--color-success) l c h / 0.1);
	}

	.tree-footer {
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid oklch(from var(--color-border) l c h / 0.15);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.footer-info {
		font-size: 10px;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.footer-hint {
		font-size: 9px;
		color: var(--color-text-muted);
		opacity: 0.5;
	}
</style>
