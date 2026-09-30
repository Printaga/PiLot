<script lang="ts">
  interface Props {
    onComplete: () => void;
    onDismiss: () => void;
  }

  let { onComplete, onDismiss }: Props = $props();

  let step = $state(0);

  const steps = [
    {
      title: "👋 Welcome to PiLot Studio!",
      content:
        "Your graphical interface for the PI coding agent. Let's take a quick tour of the key features.",
    },
    {
      title: "💬 Chat Panel",
      content: "Type messages in the chat box and press Enter to send.",
    },
    {
      title: "📋 Session History",
      content:
        "Click the clock icon in the sidebar to view and switch between sessions. Browse your conversation tree to revisit any point.",
    },
    {
      title: "🧠 Thinking Levels",
      content:
        "Use the thinking level dropdown in the header to control how much reasoning the AI uses. Higher levels = deeper analysis but slower responses.",
    },
    {
      title: "🔧 Tools & Extensions",
      content:
        "The tools panel shows what PI can do. You can enable/disable tools per session in the Capabilities tab (wrench icon).",
    },
    {
      title: "📦 Packages",
      content:
        "Discover and install PI packages (extensions, skills, prompts, themes) from the marketplace in the Packages tab.",
    },
    {
      title: "🔑 Provider API Keys",
      content:
        "Open the Providers tab (key icon) to add API keys for your preferred AI providers. Configure once, then switch models freely.",
    },
  ];

  // Clamp the index so a corrupted/out-of-range `step` can never read
  // `steps[step]` as undefined and crash the render. `step` stays private;
  // every consumer derives from the clamped value so the card content, the
  // dots, isLast and the buttons can never disagree.
  const safeStep = $derived(Math.min(Math.max(0, step), steps.length - 1));
  const currentStep = $derived(steps[safeStep] ?? steps[0]);
  const isLast = $derived(safeStep === steps.length - 1);

  function next() {
    if (isLast) {
      onComplete();
    } else {
      step = Math.min(safeStep + 1, steps.length - 1);
    }
  }

  function prev() {
    if (safeStep > 0) step = safeStep - 1;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
      return;
    }
    // Enter is excluded: a focused card button fires its own click on Enter,
    // and handling it here too would double-trigger next()/onComplete().
    // The repeat guard stops a held key from racing through every step and
    // completing the tour by accident.
    if (e.key === "ArrowRight" && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      next();
    }
    if (e.key === "ArrowLeft" && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      prev();
    }
  }

  /** Svelte action: focus trap + focus restore for the modal dialog.
   *  Without it Tab walks past the opaque backdrop into the app behind, and
   *  on close focus falls back to <body> losing the user's place. */
  function focusTrap(node: HTMLElement) {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    node.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        e.stopPropagation();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        e.stopPropagation();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab, true);

    return {
      destroy() {
        document.removeEventListener("keydown", handleTab, true);
        previouslyFocused?.focus?.();
      },
    };
  }
</script>

<div
  class="onboarding-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Onboarding tour"
  tabindex="-1"
  onclick={onDismiss}
  onkeydown={handleKeydown}
  use:focusTrap
>
  <div class="onboarding-card" role="presentation">
    <button class="dismiss-btn" onclick={onDismiss} aria-label="Close tour">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <div class="step-indicator">
      {#each steps as _, i (i)}
        <span class="step-dot" class:active={i === safeStep} class:completed={i < safeStep}></span>
      {/each}
    </div>

    <div class="step-body" aria-live="polite" aria-atomic="true">
      <h2 class="step-title">{currentStep.title}</h2>
      <p class="step-content">{currentStep.content}</p>
    </div>

    <div class="step-nav">
      <button class="nav-btn" onclick={prev} disabled={step === 0}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
      <button class="nav-btn primary" onclick={next}>
        {isLast ? "✨ Got it!" : "Next"}
        {#if !isLast}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <polyline points="9 18 15 12 9 6" />
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
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
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
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
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
