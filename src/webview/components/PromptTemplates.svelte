<script lang="ts">
  interface Props {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
  }

  type TemplateCategory =
    | "analysis"
    | "implementation"
    | "quality"
    | "workflow";
  type FilterCategory = "all" | "recent" | TemplateCategory;

  interface Template {
    name: string;
    description: string;
    prompt: string;
    category: TemplateCategory;
    tags: string[];
  }

  let { onSelectTemplate, onClose }: Props = $props();

  let activeCategory = $state<FilterCategory>("all");
  let searchQuery = $state("");
  let searchInput: HTMLInputElement | null = null;

  const builtinTemplates: Template[] = [
    {
      name: "Explain Code",
      description:
        "Break down behavior, control flow, and important tradeoffs.",
      category: "analysis",
      tags: ["code", "learning", "walkthrough"],
      prompt: `Explain the following code clearly and concretely.

Please cover:
- what problem it solves
- how the control flow works
- important functions, state, and data transformations
- non-obvious patterns, assumptions, and edge cases
- likely risks or maintenance concerns

If context is missing, say what extra files or symbols I should share next.

Code / files:
`,
    },
    {
      name: "Architecture Review",
      description: "Map components, data flow, and the current system shape.",
      category: "analysis",
      tags: ["architecture", "system", "overview"],
      prompt: `Review this codebase or feature area from an architecture perspective.

Please summarize:
- the main modules and responsibilities
- data flow and important boundaries
- coupling hotspots or layering issues
- strengths of the current design
- the highest-impact improvements, ordered by priority

Keep the explanation practical and grounded in the code.

Relevant files / area:
`,
    },
    {
      name: "Debug Issue",
      description: "Investigate a bug with hypotheses, checks, and next steps.",
      category: "analysis",
      tags: ["bug", "debugging", "triage"],
      prompt: `Help me debug this issue.

Context:
- expected behavior:
- actual behavior:
- reproduction steps:
- recent changes:
- errors or logs:

Please:
- identify the most likely root causes
- suggest the fastest ways to confirm or eliminate each one
- point out the exact files or code paths to inspect
- recommend a fix once the cause is clear
`,
    },
    {
      name: "Implement Feature",
      description:
        "Plan and build a feature in a way that fits the existing codebase.",
      category: "implementation",
      tags: ["feature", "implementation", "planning"],
      prompt: `Implement the following feature in the existing project style.

Feature request:

Constraints:
- preserve current behavior unless required
- reuse existing patterns and utilities where possible
- keep the change set focused

Please:
- outline the approach briefly
- identify the files that should change
- implement the code
- mention any follow-up work or tradeoffs
`,
    },
    {
      name: "Refactor Safely",
      description: "Restructure code without changing behavior.",
      category: "implementation",
      tags: ["refactor", "cleanup", "maintainability"],
      prompt: `Refactor the following code for readability and maintainability without changing behavior.

Priorities:
- simplify complex logic
- improve naming and structure
- remove duplication
- preserve public behavior and existing conventions

Please call out any behavior that might change before making risky edits.

Code / files:
`,
    },
    {
      name: "Add Tests",
      description:
        "Create focused tests that cover important behavior and edge cases.",
      category: "quality",
      tags: ["tests", "coverage", "regression"],
      prompt: `Add or update tests for the following code.

Focus on:
- the most important behavior
- realistic edge cases
- regression-prone paths
- matching the project's current test style and tooling

Do not add low-value tests that only restate the implementation.

Code / files:
`,
    },
    {
      name: "Code Review",
      description:
        "Look for correctness, risk, performance, and missing coverage.",
      category: "quality",
      tags: ["review", "risk", "quality"],
      prompt: `Review this code like a careful peer reviewer.

Prioritize:
- bugs or behavioral regressions
- security or data-safety issues
- performance concerns
- maintainability problems
- missing validation or missing test coverage

Please list the highest-severity findings first, with concrete reasoning.

Code / diff:
`,
    },
    {
      name: "Write Docs",
      description:
        "Produce concise documentation that explains usage and intent.",
      category: "quality",
      tags: ["docs", "comments", "handoff"],
      prompt: `Write documentation for this code or feature.

Target outcome:
- explain what it does
- explain how to use it
- capture important assumptions and limitations
- keep wording concise and developer-friendly

Use the project's existing documentation style. Add comments only where they improve clarity.

Code / feature:
`,
    },
    {
      name: "Summarize Session",
      description: "Turn a long discussion or diff into a concise handoff.",
      category: "workflow",
      tags: ["summary", "handoff", "notes"],
      prompt: `Summarize the following work for a teammate.

Include:
- what changed
- why it changed
- any open questions or risks
- recommended next steps

Keep it concise but specific.

Content to summarize:
`,
    },
    {
      name: "Migration Plan",
      description:
        "Plan an upgrade with risks, sequencing, and verification steps.",
      category: "workflow",
      tags: ["upgrade", "migration", "planning"],
      prompt: `Create a migration plan for this change.

Please include:
- current state and target state
- breaking changes or compatibility risks
- recommended implementation sequence
- validation and rollback considerations
- any docs, config, or tests that should change

Scope:
`,
    },
  ];

  const categoryLabels: Record<TemplateCategory, string> = {
    analysis: "Analyze",
    implementation: "Build",
    quality: "Quality",
    workflow: "Workflow",
  };

  let recentTemplates = $state<Template[]>([]);

  $effect(() => {
    try {
      const stored = localStorage.getItem("pilots-recent-templates");
      if (stored) recentTemplates = JSON.parse(stored);
    } catch {}
  });

  $effect(() => {
    searchInput?.focus();
  });

  function saveToRecents(template: Template) {
    const existing = recentTemplates.findIndex((t) => t.name === template.name);
    if (existing >= 0) {
      recentTemplates = [
        template,
        ...recentTemplates.filter((_, i) => i !== existing),
      ];
    } else {
      recentTemplates = [template, ...recentTemplates].slice(0, 10);
    }
    try {
      localStorage.setItem(
        "pilots-recent-templates",
        JSON.stringify(recentTemplates),
      );
    } catch {}
  }

  function useTemplate(template: Template) {
    saveToRecents(template);
    onSelectTemplate(template.prompt);
    onClose();
  }

  function matchesSearch(template: Template) {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      template.name,
      template.description,
      template.category,
      ...template.tags,
      template.prompt,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  const displayTemplates = $derived.by(() => {
    const source =
      activeCategory === "recent" ? recentTemplates : builtinTemplates;
    if (activeCategory !== "all" && activeCategory !== "recent") {
      return source.filter(
        (template) =>
          template.category === activeCategory && matchesSearch(template),
      );
    }
    return source.filter(matchesSearch);
  });

  function previewText(prompt: string) {
    return prompt.replace(/\s+/g, " ").trim();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="templates-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Prompt templates"
  tabindex="-1"
  onclick={onClose}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div
    class="templates-dialog"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="dialog-header">
      <div>
        <h3>Prompt Templates</h3>
        <p class="dialog-subtitle">
          Start with a stronger prompt, then customize it in chat.
        </p>
      </div>
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <line x1="18" y1="6" x2="6" y2="18" /><line
            x1="6"
            y1="6"
            x2="18"
            y2="18"
          />
        </svg>
      </button>
    </div>

    <div class="search-row">
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        class="search-input"
        type="text"
        placeholder="Search templates by task, tag, or prompt text"
        aria-label="Search prompt templates"
      />
    </div>

    <div class="category-nav">
      <button
        class="cat-btn"
        class:active={activeCategory === "all"}
        onclick={() => (activeCategory = "all")}>All</button
      >
      <button
        class="cat-btn"
        class:active={activeCategory === "analysis"}
        onclick={() => (activeCategory = "analysis")}>Analyze</button
      >
      <button
        class="cat-btn"
        class:active={activeCategory === "implementation"}
        onclick={() => (activeCategory = "implementation")}>Build</button
      >
      <button
        class="cat-btn"
        class:active={activeCategory === "quality"}
        onclick={() => (activeCategory = "quality")}>Quality</button
      >
      <button
        class="cat-btn"
        class:active={activeCategory === "workflow"}
        onclick={() => (activeCategory = "workflow")}>Workflow</button
      >
      {#if recentTemplates.length > 0}
        <button
          class="cat-btn"
          class:active={activeCategory === "recent"}
          onclick={() => (activeCategory = "recent")}
        >
          Recent ({recentTemplates.length})
        </button>
      {/if}
    </div>

    <div class="templates-list">
      {#if displayTemplates.length === 0}
        <div class="empty-results">
          <div class="empty-results-title">No templates match</div>
          <div class="empty-results-desc">
            Try a different search term or switch categories.
          </div>
        </div>
      {:else}
        {#each displayTemplates as template}
          <button class="template-item" onclick={() => useTemplate(template)}>
            <div class="template-topline">
              <div class="template-name">{template.name}</div>
              <span class="template-category"
                >{categoryLabels[template.category]}</span
              >
            </div>
            <div class="template-desc">{template.description}</div>
            <div class="template-tags">
              {#each template.tags as tag}
                <span class="template-tag">{tag}</span>
              {/each}
            </div>
            <code class="template-preview">{previewText(template.prompt)}</code>
          </button>
        {/each}
      {/if}
    </div>

    <div class="dialog-footer">
      <span class="footer-hint"
        >Templates insert editable starter text.</span
      >
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
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
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
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
  }

  .dialog-header h3 {
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .dialog-subtitle {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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

  .search-row {
    display: flex;
  }

  .search-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px oklch(from var(--color-primary) l c h / 0.12);
  }

  .category-nav {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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
    gap: var(--space-2);
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

  .template-topline {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
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

  .template-category,
  .template-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .template-category {
    padding: 6px 8px;
    background: oklch(from var(--color-primary) l c h / 0.12);
    color: var(--color-primary);
    border: 1px solid oklch(from var(--color-primary) l c h / 0.25);
    white-space: nowrap;
  }

  .template-tags {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .template-tag {
    padding: 4px 7px;
    background: oklch(from var(--color-surface) l c h / 0.45);
    color: var(--color-text-muted);
    border: 1px solid oklch(from var(--color-border) l c h / 0.4);
  }

  .template-preview {
    font-size: 11px;
    color: var(--color-text-muted);
    opacity: 0.75;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    line-clamp: 2;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.5;
    white-space: normal;
  }

  .empty-results {
    padding: var(--space-6);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    text-align: center;
    color: var(--color-text-muted);
  }

  .empty-results-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
  }

  .empty-results-desc {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
  }

  .dialog-footer {
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }

  .footer-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }


</style>
