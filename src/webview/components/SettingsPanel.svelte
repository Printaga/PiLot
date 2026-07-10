<script lang="ts">
	import HelpTooltip from './HelpTooltip.svelte';

	interface Props {
		autoContext: boolean;
		appVersion: string;
		thinkingLevel: string;
		onAutoContextChange: (value: boolean) => void;
		onThinkingLevelChange: (level: string) => void;
	}

	let { autoContext, appVersion, thinkingLevel, onAutoContextChange, onThinkingLevelChange }: Props = $props();

	const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

	function handleThinkingLevelChange(level: string) {
		onThinkingLevelChange(level);
	}

	function handleAutoContextChange() {
		onAutoContextChange(!autoContext);
	}

	function showTour() {
		// Emit a custom event that App.svelte listens for to show the tour
		window.dispatchEvent(new CustomEvent('show-tour'));
	}

	function openConfigFile(file: 'auth' | 'models' | 'settings') {
		if (typeof (window as any).vscode?.postMessage === 'function') {
			(window as any).vscode.postMessage({ type: 'openConfigFile', data: { file } });
		}
	}


</script>

<div class="settings-panel">
	<div class="header">
		<h3>Settings & Help</h3>
	</div>

	<div class="settings-sections">
		<section class="settings-section">
			<h4>Quick Guide</h4>
			<div class="quick-guide">
				<button class="guide-btn" onclick={showTour}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
					</svg>
					Show Onboarding Tour
				</button>
				<p class="guide-hint">New here? Take a quick tour of the main features.</p>
			</div>
		</section>

		<section class="settings-section">
			<h4>Agent Behavior</h4>

			<div class="setting-item">
				<div class="setting-info">
					<div class="setting-label-row">
						<span class="setting-label">Auto Context</span>
						<HelpTooltip text="When enabled, automatically includes project context (package.json, git info, tsconfig) in every prompt to give the AI better awareness of your project setup." title="Auto Context" />
					</div>
					<span class="setting-description">
						Automatically include project context in prompts
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
			<div class="setting-header-row">
				<p class="section-description">Control how much reasoning the AI uses before responding</p>
				<HelpTooltip text="Higher thinking levels produce deeper analysis but take longer. 'off' disables chain-of-thought entirely. 'medium' is the recommended default." title="Thinking Levels" />
			</div>

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
			<p class="section-description">Master these shortcuts to navigate faster</p>

			<div class="shortcut-list">
				<div class="shortcut-item">
					<span class="shortcut-key">1 – 7</span>
					<span class="shortcut-desc">Switch between sidebar tabs</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Escape</span>
					<span class="shortcut-desc">Close dialogs / dropdowns</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+I</span>
					<span class="shortcut-desc">Focus chat input</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+A</span>
					<span class="shortcut-desc">Attach file to chat</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+;</span>
					<span class="shortcut-desc">Toggle voice dictation</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+Alt+P</span>
					<span class="shortcut-desc">Open PiLot Studio panel</span>
				</div>
				<div class="shortcut-item">
					<span class="shortcut-key">Ctrl+Shift+Alt+N</span>
					<span class="shortcut-desc">New session</span>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h4>Configuration Files</h4>
			<p class="section-description">
				Open PI's global config files in the editor for manual editing.
			</p>
			<div class="config-files">
				<button class="config-btn" onclick={() => openConfigFile('settings')}>
					Open settings.json
				</button>
				<button class="config-btn" onclick={() => openConfigFile('auth')}>
					Open auth.json
				</button>
				<button class="config-btn" onclick={() => openConfigFile('models')}>
					Open models.json
				</button>
			</div>
		</section>

		<section class="settings-section">
			<h4>About</h4>
			<div class="about-info">
				<p><strong>PiLot Studio</strong> {appVersion}</p>
				<p>Integrates the PI coding agent into VS Code</p>
				<p class="muted">Powered by @earendil-works/pi-coding-agent</p>
				<div class="about-links">
					<a href="https://pi.dev" target="_blank" rel="noopener">PI CLI Docs</a>
					<a href="https://github.com/printagapublishing/PiLot-Studio" target="_blank" rel="noopener">GitHub</a>
				</div>
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
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.settings-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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



	.setting-header-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.setting-header-row .section-description {
		flex: 1;
	}

	/* ── Quick Guide ─────────── */
	.quick-guide {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: oklch(from var(--color-primary) l c h / 0.05);
		border: 1px solid oklch(from var(--color-primary) l c h / 0.15);
		border-radius: var(--radius-md);
	}

	.guide-btn {
		padding: var(--space-2) var(--space-4);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		width: fit-content;
		transition: all var(--transition-interactive);
	}

	.guide-btn:hover {
		filter: brightness(1.1);
		transform: translateY(-1px);
	}

	.guide-hint {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	/* ── Setting item ─────────── */
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

	.setting-label-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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

	.toggle input { opacity: 0; width: 0; height: 0; }

	.toggle-slider {
		position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
		background-color: var(--color-border); transition: var(--transition-interactive); border-radius: var(--radius-full);
	}

	.toggle-slider:before {
		position: absolute; content: ''; height: 18px; width: 18px; left: 3px; bottom: 3px;
		background-color: white; transition: var(--transition-interactive); border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider { background-color: var(--color-primary); }
	.toggle input:checked + .toggle-slider:before { transform: translateX(24px); }

	.thinking-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }

	.thinking-option {
		display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3);
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: var(--radius-md); text-align: left; transition: all var(--transition-interactive);
	}

	.thinking-option:hover { border-color: var(--color-primary); }
	.thinking-option.selected { border-color: var(--color-primary); background: color-mix(in oklch, var(--color-primary) 10%, transparent); }
	.level-name { font-weight: 500; font-size: var(--text-sm); text-transform: capitalize; }
	.level-description { font-size: var(--text-xs); color: var(--color-text-muted); }

	.shortcut-list { display: flex; flex-direction: column; gap: var(--space-1); }

	.shortcut-item {
		display: flex; justify-content: space-between; align-items: center;
		padding: var(--space-2) var(--space-3); background: var(--color-surface);
		border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: var(--text-sm);
	}

	.shortcut-key {
		font-family: monospace; padding: var(--space-1) var(--space-2);
		background: var(--color-surface-2); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 700;
	}

	.shortcut-desc { color: var(--color-text-muted); font-size: var(--text-xs); }



	.config-files {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.config-btn {
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-interactive);
	}

	.config-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.about-info {
		padding: var(--space-3); background: var(--color-surface);
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		font-size: var(--text-sm); display: flex; flex-direction: column; gap: var(--space-1);
	}

	.about-info p { margin: 0; }
	.about-info .muted { color: var(--color-text-muted); margin-top: var(--space-2); }

	.about-links {
		display: flex; gap: var(--space-3); margin-top: var(--space-2); padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.about-links a { font-size: var(--text-xs); color: var(--color-primary); text-decoration: none; }
	.about-links a:hover { text-decoration: underline; }
</style>
