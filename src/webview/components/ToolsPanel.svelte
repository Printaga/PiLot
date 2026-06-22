<script lang="ts">
	import { onMount } from 'svelte';
	interface ToolDef {
		name: string;
		description: string;
		enabled: boolean;
		category: 'builtin';
		source?: string;
	}

	// Props
	interface Props {
		toolPreset?: string | null;
	}
	let { toolPreset: propPreset = null }: Props = $props();

	// Default tools available in PI
	const defaultTools: ToolDef[] = [
		{ name: 'read', description: 'Read files from the filesystem', enabled: true, category: 'builtin' },
		{ name: 'bash', description: 'Execute shell commands', enabled: true, category: 'builtin' },
		{ name: 'edit', description: 'Edit files with targeted replacements', enabled: true, category: 'builtin' },
		{ name: 'write', description: 'Create new files', enabled: true, category: 'builtin' },
		{ name: 'grep', description: 'Search file contents with regex', enabled: true, category: 'builtin' },
		{ name: 'find', description: 'Find files by glob pattern', enabled: true, category: 'builtin' },
		{ name: 'ls', description: 'List directory contents', enabled: true, category: 'builtin' },
	];

	let tools = $state<ToolDef[]>([...defaultTools]);
	let activeTab = $state<'tools' | 'presets'>('tools');
	let toolPreset = $state<string>('default');
	let customToolsInput = $state('');
	let isSynced = $state(false);


	onMount(() => {
		// Read current tool preset from VS Code settings
		fetchToolPreset();
	});

	// Update internal state when prop changes
	$effect(() => {
		if (propPreset !== null) {
			toolPreset = propPreset;
			applyPreset(propPreset, false);
			isSynced = true;
		}
	});

	function fetchToolPreset() {
		// Communicate with extension through VS Code API
		const vscode = (window as any).vscode;
		if (vscode?.postMessage) {
			vscode.postMessage({ type: 'getSettings' });
		}
	}

	function sendToolUpdate(msg: any) {
		const vscode = (window as any).vscode;
		if (vscode?.postMessage) {
			vscode.postMessage(msg);
		}
	}

	function toggleTool(index: number) {
		tools[index].enabled = !tools[index].enabled;
		tools = [...tools];
		notifyToolChange();
	}

	function notifyToolChange() {
		const enabledTools = tools.filter(t => t.enabled).map(t => t.name);
		sendToolUpdate({
			type: 'setToolConfig',
			data: { toolPreset, customTools: enabledTools }
		});
	}

	function applyPreset(preset: string, notify = true) {
		toolPreset = preset;
		switch (preset) {
			case 'default':
				tools = defaultTools.map(t => ({ ...t, enabled: true }));
				break;
			case 'none':
				tools = defaultTools.map(t => ({ ...t, enabled: false }));
				break;
			case 'review':
				tools = defaultTools.map(t => ({
					...t,
					enabled: ['read', 'grep', 'find', 'ls'].includes(t.name)
				}));
				break;
			case 'custom':
				// Keep current state
				break;
		}
		tools = [...tools];
		if (notify) {
			notifyToolChange();
		}
	}

	function addCustomTool() {
		const name = customToolsInput.trim().toLowerCase();
		if (!name || tools.some(t => t.name === name)) return;
		tools = [...tools, {
			name,
			description: `Custom tool: ${name}`,
			enabled: true,
			category: 'builtin'
		}];
		customToolsInput = '';
		notifyToolChange();
	}

	function removeCustomTool(index: number) {
		if (tools[index].category === 'builtin') return;
		tools = tools.filter((_, i) => i !== index);
		notifyToolChange();
	}

	const builtinTools = $derived(tools.filter(t => t.category === 'builtin'));
	const customTools = $derived(tools.filter(t => t.category !== 'builtin'));

	const enabledCount = $derived(tools.filter(t => t.enabled).length);
	const totalCount = $derived(tools.length);


</script>

<div class="tools-panel">
	<div class="header">
		<h3>Capabilities</h3>
		{#if isSynced}
			<span class="sync-badge" title="Synced with active session">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<polyline points="20 6 9 17 4 12"/>
				</svg>
				Synced
			</span>
		{/if}
	</div>

	<div class="tab-nav">
		<button class="tab-btn" class:active={activeTab === 'tools'} onclick={() => (activeTab = 'tools')}>
			Tools ({enabledCount}/{totalCount})
		</button>
		<button class="tab-btn" class:active={activeTab === 'presets'} onclick={() => (activeTab = 'presets')}>
			Presets
		</button>
	</div>

	<div class="tools-sections">
		{#if activeTab === 'tools'}
			<section class="tools-section">
				<p class="section-description">Control which tools PI can use in the current session</p>

				<div class="tools-list">
					{#each builtinTools as tool, index}
						<div class="tool-item">
							<div class="tool-info">
								<span class="tool-name">{tool.name}</span>
								<span class="tool-description">{tool.description}</span>
				
							</div>
							<label class="toggle">
								<input type="checkbox" checked={tool.enabled} onchange={() => toggleTool(index)} />
								<span class="toggle-slider"></span>
							</label>
						</div>
					{/each}
				</div>

				{#if customTools.length > 0}
					<h4 class="subsection-title">Custom Tools</h4>
					<div class="tools-list">
						{#each customTools as tool, i}
							<div class="tool-item">
								<div class="tool-info">
									<span class="tool-name">{tool.name}</span>
									<span class="tool-description">{tool.description}</span>
								</div>
								<div class="tool-actions">
									<label class="toggle">
										<input type="checkbox" checked={tool.enabled} onchange={() => {
											const idx = tools.findIndex(t => t.name === tool.name);
											if (idx >= 0) toggleTool(idx);
										}} />
										<span class="toggle-slider"></span>
									</label>
									<button class="remove-btn" onclick={() => {
										const idx = tools.findIndex(t => t.name === tool.name);
										if (idx >= 0) removeCustomTool(idx);
									}} title="Remove custom tool">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
											<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
										</svg>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<div class="add-tool-form">
					<input
						type="text"
						placeholder="Add custom tool name..."
						bind:value={customToolsInput}
						onkeydown={(e) => e.key === 'Enter' && addCustomTool()}
					/>
					<button class="add-btn" onclick={addCustomTool} disabled={!customToolsInput.trim()}>Add</button>
				</div>
			</section>

		{:else if activeTab === 'presets'}
			<section class="tools-section">
				<h4>Tool Presets</h4>
				<p class="section-description">Choose a preset to quickly configure tools per session</p>

				<div class="presets-list">
					<button
						class="preset-card"
						class:selected={toolPreset === 'default'}
						onclick={() => applyPreset('default')}
					>
						<span class="preset-name">Default</span>
						<span class="preset-desc">All built-in tools enabled</span>
						<span class="preset-tools">read, bash, edit, write, grep, find, ls</span>
					</button>

					<button
						class="preset-card"
						class:selected={toolPreset === 'review'}
						onclick={() => applyPreset('review')}
					>
						<span class="preset-name">Review Only</span>
						<span class="preset-desc">Read-only tools for code review</span>
						<span class="preset-tools">read, grep, find, ls</span>
					</button>

					<button
						class="preset-card"
						class:selected={toolPreset === 'none'}
						onclick={() => applyPreset('none')}
					>
						<span class="preset-name">None</span>
						<span class="preset-desc">Disable all tools (chat only)</span>
						<span class="preset-tools">No tools enabled</span>
					</button>

					<button
						class="preset-card"
						class:selected={toolPreset === 'custom'}
						onclick={() => applyPreset('custom')}
					>
						<span class="preset-name">Custom</span>
						<span class="preset-desc">Manually configure individual tools</span>
						<span class="preset-tools">Use the Tools tab above</span>
					</button>
				</div>
			</section>
		{/if}
	</div>
</div>

<style>
	.tools-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-4);
		overflow-y: auto;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-4);
	}

	h3 {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.sync-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 9px;
		font-weight: 700;
		color: var(--color-success);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 8px;
		background: oklch(from var(--color-success) l c h / 0.1);
		border-radius: var(--radius-full);
	}

	.tab-nav {
		display: flex;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
		padding: var(--space-1);
		background: var(--color-surface-2);
		border-radius: var(--radius-lg);
	}

	.tab-btn {
		flex: 1;
		padding: var(--space-1) var(--space-2);
		font-size: 10px;
		font-weight: 700;
		color: var(--color-text-muted);
		border-radius: var(--radius-md);
		white-space: nowrap;
		transition: all var(--transition-interactive);
	}

	.tab-btn:hover {
		color: var(--color-text);
		background: var(--surface-tint);
	}

	.tab-btn.active {
		background: var(--color-primary);
		color: var(--color-text-inverse);
	}

	h4 {
		font-size: var(--text-base);
		font-weight: 600;
		margin-bottom: var(--space-1);
	}

	.tools-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.tools-section {
		display: flex;
		flex-direction: column;
	}

	.section-description {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	.subsection-title {
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--color-text-muted);
		margin: var(--space-3) 0 var(--space-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tools-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.tool-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--transition-fast);
	}

	.tool-item:hover {
		border-color: oklch(from var(--color-primary) l c h / 0.2);
	}

	.tool-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.tool-name {
		font-weight: 500;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.tool-description {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.tool-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.remove-btn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		opacity: 0.4;
	}

	.remove-btn:hover {
		opacity: 1;
		color: var(--color-error);
		background: oklch(from var(--color-error) l c h / 0.1);
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 20px;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--color-border);
		transition: var(--transition-interactive);
		border-radius: var(--radius-full);
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 14px;
		width: 14px;
		left: 3px;
		bottom: 3px;
		background-color: white;
		transition: var(--transition-interactive);
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background-color: var(--color-primary);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(20px);
	}

	.add-tool-form {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.add-tool-form input {
		flex: 1;
		font-size: var(--text-xs);
	}

	.add-btn {
		padding: var(--space-2) var(--space-3);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.add-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}


	/* ── Presets ──────────────────────────────── */
	.presets-list {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.preset-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-align: left;
		transition: all var(--transition-interactive);
	}

	.preset-card:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
	}

	.preset-card.selected {
		border-color: var(--color-primary);
		background: oklch(from var(--color-primary) l c h / 0.08);
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	.preset-name {
		font-weight: 700;
		font-size: var(--text-sm);
	}

	.preset-desc {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.preset-tools {
		font-size: 10px;
		color: var(--color-text-muted);
		opacity: 0.6;
		font-family: var(--font-mono);
	}


</style>
