<script lang="ts">
	interface Props {
		onSelectTemplate: (text: string) => void;
		onClose: () => void;
	}

	let { onSelectTemplate, onClose }: Props = $props();

	let activeCategory = $state<'all' | 'recent' | 'builtin'>('all');

	interface Template {
		name: string;
		description: string;
		prompt: string;
		category: string;
	}

	const builtinTemplates: Template[] = [
		{ name: 'Explain Code', description: 'Explain selected code in detail', prompt: 'Explain the following code in detail, covering what it does, how it works, and any notable patterns:', category: 'code' },
		{ name: 'Review Code', description: 'Review code for issues and improvements', prompt: 'Review the following code for bugs, security issues, performance problems, and suggest improvements:', category: 'code' },
		{ name: 'Refactor', description: 'Suggest refactoring improvements', prompt: 'Suggest refactoring improvements for the following code, focusing on readability, maintainability, and performance:', category: 'code' },
		{ name: 'Add Tests', description: 'Generate unit tests', prompt: 'Write comprehensive unit tests for the following code. Include edge cases and use the project\'s existing test framework:', category: 'code' },
		{ name: 'Document', description: 'Add documentation/comments', prompt: 'Add comprehensive documentation and comments to the following code. Use JSDoc/TSDoc style where appropriate:', category: 'code' },
		{ name: 'Architecture', description: 'Explain project architecture', prompt: 'Explain the architecture of this project. Describe the main components, data flow, and design patterns used.', category: 'general' },
		{ name: 'Debug', description: 'Debug an issue', prompt: 'Help me debug the following issue. I\'m seeing:', category: 'general' },
		{ name: 'Summarize', description: 'Summarize content', prompt: 'Summarize the following content concisely, capturing the key points:', category: 'general' },
	];

	// Recently used templates (stored in localStorage)
	let recentTemplates = $state<Template[]>([]);

	$effect(() => {
		try {
			const stored = localStorage.getItem('pilots-recent-templates');
			if (stored) recentTemplates = JSON.parse(stored);
		} catch {}
	});

	function saveToRecents(template: Template) {
		const existing = recentTemplates.findIndex(t => t.name === template.name);
		if (existing >= 0) {
			recentTemplates = [template, ...recentTemplates.filter((_, i) => i !== existing)];
		} else {
			recentTemplates = [template, ...recentTemplates].slice(0, 10);
		}
		try {
			localStorage.setItem('pilots-recent-templates', JSON.stringify(recentTemplates));
		} catch {}
	}

	function useTemplate(template: Template) {
		saveToRecents(template);
		onSelectTemplate(template.prompt);
		onClose();
	}

	const displayTemplates = $derived(
		activeCategory === 'recent' ? recentTemplates :
		activeCategory === 'all' ? builtinTemplates :
		builtinTemplates
	);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="templates-overlay" role="dialog" aria-modal="true" aria-label="Prompt templates" tabindex="-1" onclick={onClose} onkeydown={handleKeydown}>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div class="templates-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
		<div class="dialog-header">
			<h3>Prompt Templates</h3>
			<button class="close-btn" onclick={onClose} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</div>

		<div class="category-nav">
			<button class="cat-btn" class:active={activeCategory === 'all'} onclick={() => (activeCategory = 'all')}>All</button>
			<button class="cat-btn" class:active={activeCategory === 'builtin'} onclick={() => (activeCategory = 'builtin')}>Built-in</button>
			{#if recentTemplates.length > 0}
				<button class="cat-btn" class:active={activeCategory === 'recent'} onclick={() => (activeCategory = 'recent')}>
					Recent ({recentTemplates.length})
				</button>
			{/if}
		</div>

		<div class="templates-list">
			{#each displayTemplates as template}
				<button class="template-item" onclick={() => useTemplate(template)}>
					<div class="template-name">{template.name}</div>
					<div class="template-desc">{template.description}</div>
					<code class="template-preview">{template.prompt.slice(0, 80)}...</code>
				</button>
			{/each}
		</div>

		<div class="dialog-footer">
			<span class="footer-hint">Type <kbd>/</kbd> in chat for slash commands</span>
		</div>
	</div>
</div>

<style>
	.templates-overlay {
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

	.templates-dialog {
		width: 500px;
		max-width: 90vw;
		max-height: 80vh;
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

	.category-nav {
		display: flex;
		gap: var(--space-2);
	}

	.cat-btn {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 600;
		background: var(--color-surface-2);
		border: 1px solid transparent;
		color: var(--color-text-muted);
		transition: all var(--transition-interactive);
	}

	.cat-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.cat-btn.active {
		background: oklch(from var(--color-primary) l c h / 0.15);
		color: var(--color-primary);
		border-color: oklch(from var(--color-primary) l c h / 0.3);
	}

	.templates-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.template-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-align: left;
		transition: all var(--transition-interactive);
		width: 100%;
	}

	.template-item:hover {
		border-color: var(--color-primary);
		background: var(--surface-tint);
	}

	.template-name {
		font-weight: 700;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.template-desc {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.template-preview {
		font-size: 10px;
		color: var(--color-text-muted);
		opacity: 0.6;
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dialog-footer {
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.footer-hint {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.footer-hint kbd {
		display: inline-block;
		padding: 0 4px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		background: oklch(from var(--color-surface-2) l c h / 0.5);
		border: 1px solid oklch(from var(--color-border) l c h / 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-text);
	}
</style>
