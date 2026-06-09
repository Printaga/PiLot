<script lang="ts">
	interface Props {
		onComplete: () => void;
		onDismiss: () => void;
	}

	let { onComplete, onDismiss }: Props = $props();

	let step = $state(0);

	const steps = [
		{
			title: '👋 Welcome to PiLot Studio!',
			content: 'Your graphical interface for the PI coding agent. Let\'s take a quick tour of the key features.',
			icon: 'rocket'
		},
		{
			title: '💬 Chat Panel',
			content: 'Type messages in the chat box and press Enter to send.',
			icon: 'chat'
		},
		{
			title: '📋 Session History',
			content: 'Click the clock icon in the sidebar to view and switch between sessions. Browse your conversation tree to revisit any point.',
			icon: 'history'
		},
		{
			title: '🧠 Thinking Levels',
			content: 'Use the thinking level dropdown in the header to control how much reasoning the AI uses. Higher levels = deeper analysis but slower responses.',
			icon: 'brain'
		},
		{
			title: '🔧 Tools & Extensions',
			content: 'The tools panel shows what PI can do. You can enable/disable tools per session in the Capabilities tab (wrench icon).',
			icon: 'tools'
		},
		{
			title: '📦 Packages',
			content: 'Discover and install PI packages (extensions, skills, prompts, themes) from the marketplace in the Packages tab.',
			icon: 'package'
		},
		{
			title: '🔑 Provider API Keys',
			content: 'Open the Providers tab (key icon) to add API keys for your preferred AI providers. Configure once, then switch models freely.',
			icon: 'key'
		},

	];

	const isLast = $derived(step === steps.length - 1);

	function next() {
		if (isLast) {
			onComplete();
		} else {
			step++;
		}
	}

	function prev() {
		if (step > 0) step--;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onDismiss();
		if (e.key === 'ArrowRight' || e.key === 'Enter') next();
		if (e.key === 'ArrowLeft') prev();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="onboarding-overlay"
	role="dialog"
	aria-modal="true"
	aria-label="Onboarding tour"
	tabindex="-1"
	onclick={onDismiss}
	onkeydown={handleKeydown}
>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div class="onboarding-card" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
		<button class="dismiss-btn" onclick={onDismiss} aria-label="Close tour">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>

		<div class="step-indicator">
			{#each steps as _, i}
				<span class="step-dot" class:active={i === step} class:completed={i < step}></span>
			{/each}
		</div>

		<h2 class="step-title">{steps[step].title}</h2>
		<p class="step-content">{steps[step].content}</p>

		<div class="step-nav">
			<button class="nav-btn" onclick={prev} disabled={step === 0}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<polyline points="15 18 9 12 15 6"/>
				</svg>
				Back
			</button>
			<button class="nav-btn primary" onclick={next}>
				{isLast ? '✨ Got it!' : 'Next'}
				{#if !isLast}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<polyline points="9 18 15 12 9 6"/>
					</svg>
				{/if}
			</button>
		</div>

		<button class="skip-btn" onclick={onDismiss}>Skip tour</button>
	</div>
</div>

<style>
	.onboarding-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0% 0 0 / 0.6);
		backdrop-filter: blur(4px);
		animation: overlay-in 0.2s ease;
	}

	@keyframes overlay-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.onboarding-card {
		position: relative;
		width: 420px;
		max-width: 90vw;
		padding: var(--space-6);
		background: var(--color-surface);
		border: 1px solid oklch(from var(--color-primary) l c h / 0.2);
		border-radius: var(--radius-xl);
		box-shadow: 0 24px 64px oklch(0% 0 0 / 0.3);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		animation: card-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes card-in {
		from { opacity: 0; transform: translateY(20px) scale(0.95); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	.dismiss-btn {
		position: absolute;
		top: var(--space-3);
		right: var(--space-3);
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		transition: all var(--transition-fast);
	}

	.dismiss-btn:hover {
		background: var(--surface-tint);
		color: var(--color-text);
	}

	.step-indicator {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.step-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: oklch(from var(--color-border) l c h / 0.3);
		transition: all var(--transition-interactive);
	}

	.step-dot.active {
		background: var(--color-primary);
		box-shadow: 0 0 8px var(--accent-glow);
		transform: scale(1.2);
	}

	.step-dot.completed {
		background: var(--color-primary);
		opacity: 0.4;
	}

	.step-title {
		font-size: var(--text-xl);
		font-weight: 700;
		text-align: center;
		color: var(--color-text);
	}

	.step-content {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-align: center;
		line-height: 1.6;
		max-width: 320px;
	}

	.step-nav {
		display: flex;
		gap: var(--space-3);
		width: 100%;
		margin-top: var(--space-2);
	}

	.nav-btn {
		flex: 1;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		transition: all var(--transition-interactive);
	}

	.nav-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		background: var(--surface-tint);
	}

	.nav-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.nav-btn.primary {
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-color: var(--color-primary);
	}

	.nav-btn.primary:hover:not(:disabled) {
		background: var(--color-primary);
		border-color: var(--color-primary);
		filter: brightness(1.15);
	}

	.skip-btn {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		text-decoration: underline;
		opacity: 0.6;
	}

	.skip-btn:hover {
		opacity: 1;
		color: var(--color-text);
	}
</style>
