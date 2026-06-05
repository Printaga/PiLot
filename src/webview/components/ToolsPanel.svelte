<script lang="ts">
	import { onMount } from 'svelte';

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

	let installedPackages = $state<string[]>(['@pi/skill-readme-generator', '@pi/skill-code-review']);

	let availablePackages = $state([
		{ name: '@pi/skill-api-docs', description: 'Generate API documentation' },
		{ name: '@pi/skill-migrations', description: 'Database migration helper' },
		{ name: '@pi/skill-tests', description: 'Generate unit tests' }
	]);

	function toggleTool(index: number) {
		tools[index].enabled = !tools[index].enabled;
		tools = [...tools];
	}

	function installPackage(name: string) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage({ type: 'installPackage', data: { name } });
		}
		installedPackages = [...installedPackages, name];
		availablePackages = availablePackages.filter((p) => p.name !== name);
	}

	function uninstallPackage(name: string) {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage({ type: 'uninstallPackage', data: { name } });
		}
		if (!installedPackages.includes(name)) return;
		const existing = availablePackages.find((p) => p.name === name);
		if (!existing) {
			availablePackages = [...availablePackages, { name, description: '' }];
		}
		installedPackages = installedPackages.filter((p) => p !== name);
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

		<section class="tools-section">
			<h4>Installed Packages</h4>
			<p class="section-description">PI packages installed in your project</p>

			{#if installedPackages.length > 0}
				<div class="packages-list">
					{#each installedPackages as pkg}
						<div class="package-item installed">
							<div class="package-info">
								<span class="package-name">{pkg}</span>
							</div>
							<button
								class="remove-btn"
								onclick={() => uninstallPackage(pkg)}
								title="Remove package"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty-text">No packages installed</p>
			{/if}
		</section>

		<section class="tools-section">
			<h4>Available Packages</h4>
			<p class="section-description">Browse and install PI packages from the community</p>

			<div class="packages-list">
				{#each availablePackages as pkg}
					<div class="package-item">
						<div class="package-info">
							<span class="package-name">{pkg.name}</span>
							<span class="package-description">{pkg.description}</span>
						</div>
						<button
							class="install-btn"
							onclick={() => installPackage(pkg.name)}
							title="Install package"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
							Install
						</button>
					</div>
				{/each}
			</div>

			{#if availablePackages.length === 0}
				<p class="empty-text">No more packages available</p>
			{/if}
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

	.packages-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.package-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.package-item.installed {
		background: color-mix(in oklch, var(--color-success) 5%, transparent);
		border-color: color-mix(in oklch, var(--color-success) 20%, transparent);
	}

	.package-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.package-name {
		font-weight: 500;
		font-size: var(--text-sm);
		font-family: monospace;
	}

	.package-description {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.install-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		transition: all var(--transition-interactive);
	}

	.install-btn:hover {
		background: var(--color-primary-hover);
	}

	.remove-btn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		transition: all var(--transition-interactive);
	}

	.remove-btn:hover {
		color: var(--color-error);
		background: color-mix(in oklch, var(--color-error) 10%, transparent);
	}

	.empty-text {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		text-align: center;
		padding: var(--space-4);
	}
</style>
