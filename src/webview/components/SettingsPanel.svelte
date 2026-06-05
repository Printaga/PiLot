<script lang="ts">
	interface Props {
		autoContext: boolean;
		thinkingLevel: string;
		onAutoContextChange: (value: boolean) => void;
		onThinkingLevelChange: (level: string) => void;
	}

	let { autoContext, thinkingLevel, onAutoContextChange, onThinkingLevelChange }: Props = $props();

	const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

	function handleThinkingLevelChange(level: string) {
		onThinkingLevelChange(level);
	}

	function handleAutoContextChange() {
		onAutoContextChange(!autoContext);
	}
</script>

<div class="settings-panel">
	<div class="header">
		<h3>Settings</h3>
	</div>

	<div class="settings-sections">
		<section class="settings-section">
			<h4>Agent Behavior</h4>

			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Auto Context</span>
					<span class="setting-description">
						Automatically include project context (package.json, git info) in prompts
					</span>
				</div>
				<label class="toggle">
					<input type="checkbox" checked={autoContext} onchange={handleAutoContextChange} />
					<span class="toggle-slider"></span>
				</label>
			</div>
		</section>

		<section class="settings-section">
			<h4>Thinking Level</h4>
			<p class="section-description">Control how much reasoning the AI uses before responding</p>

			<div class="thinking-options">
				{#each thinkingLevels as level}
					<button
						class="thinking-option"
						class:selected={thinkingLevel === level}
						onclick={() => handleThinkingLevelChange(level)}
					>
						<span class="level-name">{level}</span>
						<span class="level-description">
							{#if level === 'off'}
								No additional reasoning
							{:else if level === 'minimal'}
								Quick thoughts
							{:else if level === 'low'}
								Brief reasoning
							{:else if level === 'medium'}
								Standard reasoning
							{:else if level === 'high'}
								Deep analysis
							{:else}
								Maximum reasoning
							{/if}
						</span>
					</button>
				{/each}
			</div>
		</section>

		<section class="settings-section">
			<h4>Keyboard Shortcuts</h4>

			<div class="shortcut-list">
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+Alt+P</span>
					<span class="shortcut-desc">Open PiLot Studio panel</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Right-click</span>
					<span class="shortcut-desc">Context menu actions</span>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h4>About</h4>
			<div class="about-info">
				<p><strong>PiLot Studio</strong> v0.1.0</p>
				<p>Integrates the PI coding agent into VS Code</p>
				<p class="muted">Powered by @earendil-works/pi-coding-agent</p>
			</div>
		</section>
	</div>
</div>

<style>
	.settings-panel {
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
		margin-bottom: var(--space-2);
	}

	.settings-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.settings-section {
		display: flex;
		flex-direction: column;
	}

	.section-description {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	.setting-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.setting-label {
		font-weight: 500;
	}

	.setting-description {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 48px;
		height: 24px;
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
		height: 18px;
		width: 18px;
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
		transform: translateX(24px);
	}

	.thinking-options {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}

	.thinking-option {
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

	.thinking-option:hover {
		border-color: var(--color-primary);
	}

	.thinking-option.selected {
		border-color: var(--color-primary);
		background: color-mix(in oklch, var(--color-primary) 10%, transparent);
	}

	.level-name {
		font-weight: 500;
		font-size: var(--text-sm);
		text-transform: capitalize;
	}

	.level-description {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.shortcut-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.shortcut-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2);
		background: var(--color-surface);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.shortcut-key {
		font-family: monospace;
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.shortcut-desc {
		color: var(--color-text-muted);
	}

	.about-info {
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.about-info p {
		margin: 0;
	}

	.about-info .muted {
		color: var(--color-text-muted);
		margin-top: var(--space-2);
	}
</style>
