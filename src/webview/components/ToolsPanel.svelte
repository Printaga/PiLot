<script lang="ts">
	interface Tool {
		name: string;
		description: string;
		enabled: boolean;
	}

	let tools = $state<Tool[]>([
		{ name: 'read', description: 'Read files from the filesystem', enabled: true },
		{ name: 'bash', description: 'Execute shell commands', enabled: true },
		{ name: 'edit', description: 'Edit files with diffs', enabled: true },
		{ name: 'glob', description: 'Find files by pattern', enabled: true },
		{ name: 'grep', description: 'Search file contents', enabled: true },
		{ name: 'write', description: 'Create new files', enabled: true }
	]);

	function toggleTool(index: number) {
		tools[index].enabled = !tools[index].enabled;
		tools = [...tools];
	}
</script>

<div class="tools-panel">
	<div class="header">
		<h3>Tools & Extensions</h3>
	</div>

	<div class="tools-sections">
		<section class="tools-section">
			<h4>Available Tools</h4>
			<p class="section-description">Tools that PI can use to interact with your project</p>

			<div class="tools-list">
				{#each tools as tool, index}
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
		</section>
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
		margin-bottom: var(--space-6);
	}

	h3 {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	h4 {
		font-size: var(--text-base);
		font-weight: 600;
		margin-bottom: var(--space-1);
	}

	.tools-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
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
	}

	.tool-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tool-name {
		font-weight: 500;
		font-family: monospace;
		font-size: var(--text-sm);
	}

	.tool-description {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
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
</style>
