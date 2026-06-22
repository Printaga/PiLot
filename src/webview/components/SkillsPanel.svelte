<script lang="ts">
  import { onMount } from "svelte";

  interface SkillInfo {
    name: string;
    description: string;
    sourceName: string | null;
    path: string;
    sourceType: "local" | "package" | "built-in";
  }

  // Props — sessionResources passed from parent App.svelte
  let { sessionResources = null }: { sessionResources?: any } = $props();

  // State
  let skills = $state<SkillInfo[]>([]);
  let isLoading = $state(false);
  let searchQuery = $state("");
  let showLoadingOverlay = $state(false);
  let outputText = $state("");
  let expandedSkill = $state<string | null>(null);
  let skillDiscoveryEnabled = $state(true);
  let extraSkillPaths = $state<string[]>([]);
  let newSkillPath = $state('');

  // Derived: filtered installed skills
  let filteredSkills = $derived(
    skills.filter((s) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.sourceName && s.sourceName.toLowerCase().includes(q))
      );
    }),
  );

  function getVsCodeApi() {
    const existing = (window as any).vscode;
    if (existing?.postMessage) return existing;
    if (typeof (window as any).acquireVsCodeApi === "function") {
      const vscode = (window as any).acquireVsCodeApi();
      (window as any).vscode = vscode;
      return vscode;
    }
    return null;
  }

  function sendMessage(msg: any) {
    getVsCodeApi()?.postMessage(msg);
  }

  function refreshSkills() {
    sendMessage({ type: "getSkills" });
    sendMessage({ type: "getSessionResources" });
    isLoading = true;
    setTimeout(() => {
      isLoading = false;
    }, 2000);
  }

  // Apply skills from sessionResources prop (initial load + updates from parent)
  function applySessionResources(data: any) {
    if (data?.skills) {
      skills = data.skills.map((s: any) => ({
        name: s.name,
        description: s.description || "",
        sourceName: s.sourceName || null,
        path: s.path || "",
        sourceType: s.sourceType || (s.sourceName ? "package" : s.path?.includes("/.pi/") ? "local" : "built-in"),
      }));
      isLoading = false;
    }
  }

  // React to prop changes — when parent updates sessionResources, apply them
  $effect(() => {
    applySessionResources(sessionResources);
  });

  function removeSkillPackage(skill: SkillInfo) {
    if (skill.sourceName) {
      sendMessage({
        type: "uninstallPackage",
        data: { source: `npm:${skill.sourceName}` },
      });
      showLoadingOverlay = true;
      outputText = `Removing ${skill.sourceName}...\n`;
    }
  }

  function toggleSkillDiscovery() {
    skillDiscoveryEnabled = !skillDiscoveryEnabled;
    sendMessage({
      type: "setSkillDiscovery",
      data: { enabled: skillDiscoveryEnabled },
    });
  }

  function addSkillPath() {
    const trimmed = newSkillPath.trim();
    if (!trimmed || extraSkillPaths.includes(trimmed)) return;
    extraSkillPaths = [...extraSkillPaths, trimmed];
    newSkillPath = '';
    sendMessage({ type: 'setExtraSkillPaths', data: { paths: extraSkillPaths } });
  }

  function removeSkillPath(index: number) {
    extraSkillPaths = extraSkillPaths.filter((_, i) => i !== index);
    sendMessage({ type: 'setExtraSkillPaths', data: { paths: extraSkillPaths } });
  }

  function sourceTypeBadge(type: string): string {
    switch (type) {
      case "local":
        return "local";
      case "package":
        return "package";
      case "built-in":
        return "built-in";
      default:
        return "unknown";
    }
  }

  function formatSource(skill: SkillInfo): string {
    if (skill.sourceName) return skill.sourceName;
    if (skill.path) {
      const parts = skill.path.split("/");
      return parts.length > 2
        ? `.../${parts.slice(-2).join("/")}`
        : skill.path;
    }
    return "unknown";
  }

  function npmUrl(name: string): string {
    return `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
  }

  function expandSkill(skill: SkillInfo) {
    expandedSkill = expandedSkill === skill.name ? null : skill.name;
  }

  // Handle messages from extension (fallback for mid-session updates)
  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;

    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data;
      if (type === "skills-list") {
        skills = (data?.skills || []).map((s: any) => ({
          name: s.name,
          description: s.description || "",
          sourceName: s.sourceName || null,
          path: s.path || "",
          sourceType: s.sourceType || (s.sourceName ? "package" : s.path?.includes("/.pi/") ? "local" : "built-in"),
        }));
        isLoading = false;
      }
      if (type === "session-resources") {
        if (data?.skills) {
          skills = data.skills.map((s: any) => ({
            name: s.name,
            description: s.description || "",
            sourceName: s.sourceName || null,
            path: s.path || "",
            sourceType: s.sourceType || (s.sourceName ? "package" : s.path?.includes("/.pi/") ? "local" : "built-in"),
          }));
          isLoading = false;
        }
      }
      if (type === "skill-discovery-changed") {
        skillDiscoveryEnabled = data?.enabled !== false;
      }
      if (type === 'extra-skill-paths') {
        extraSkillPaths = data?.paths || [];
      }
      if (type === "loading") {
        showLoadingOverlay = data?.loading;
        if (!data?.loading) {
          setTimeout(() => {
            refreshSkills();
          }, 100);
        }
      }
      if (type === "output") {
        outputText += data?.text || "";
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  onMount(() => {
    sendMessage({ type: "getSkills" });
    sendMessage({ type: "getSessionResources" });
    sendMessage({ type: "getSkillDiscovery" });
    sendMessage({ type: 'getExtraSkillPaths' });
  });
</script>

<div class="skills-panel">
  <div class="header">
    <h3>Skills</h3>
    <span class="skill-count">{skills.length} loaded</span>
  </div>

  <div class="discovery-toggle">
    <div class="toggle-info">
      <span class="toggle-label">Skill Discovery</span>
      <span class="toggle-desc">
        {skillDiscoveryEnabled ? "Enabled — skills loaded from all sources" : "Disabled — no skills loaded"}
      </span>
    </div>
    <label class="toggle">
      <input
        type="checkbox"
        checked={skillDiscoveryEnabled}
        onchange={toggleSkillDiscovery}
      />
      <span class="toggle-slider"></span>
    </label>
  </div>

  <div class="filter-bar">
    <input
      type="text"
      placeholder="Search installed skills..."
      bind:value={searchQuery}
      class="search-input"
    />
    <button class="refresh-btn" onclick={refreshSkills} title="Refresh skills"
      >↻</button
    >
  </div>

  <div class="skills-content">
    {#if isLoading}
      <div class="status">Loading skills...</div>
    {:else if filteredSkills.length === 0}
      <div class="empty-state">
        {#if skills.length === 0}
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <p class="empty-title">No skills loaded</p>
          <p class="empty-desc">
            Skills provide specialized agent instructions. Install a PI package
            that contains skills via the <strong>Packages</strong> tab, or add
            skill paths below.
          </p>
        {:else}
          <p class="empty-title">No skills match "{searchQuery}"</p>
        {/if}
      </div>
    {:else}
      {#each filteredSkills as skill}
        <div class="skill-card">
          <div class="skill-header" role="button" tabindex="0" onclick={() => expandSkill(skill)} onkeydown={(e) => e.key === 'Enter' && expandSkill(skill)}>
            <div class="skill-name-row">
              <span class="skill-name">{skill.name}</span>
              <span class="badge badge-{sourceTypeBadge(skill.sourceType)}">
                {skill.sourceType}
              </span>
            </div>
          </div>
          {#if skill.description}
            <p class="skill-desc">{skill.description}</p>
          {/if}
          <div class="skill-meta">
            <span class="meta-item" title={skill.path}>
              {formatSource(skill)}
            </span>
          </div>
          {#if expandedSkill === skill.name}
            <div class="skill-details">
              <div class="detail-row">
                <span class="detail-label">Source:</span>
                <span class="detail-value">{skill.sourceType}</span>
              </div>
              {#if skill.path}
                <div class="detail-row">
                  <span class="detail-label">Path:</span>
                  <span class="detail-value detail-path">{skill.path}</span>
                </div>
              {/if}
              {#if skill.sourceType === "package" && skill.sourceName}
                <div class="detail-row">
                  <span class="detail-label">Package:</span>
                  <a href={npmUrl(skill.sourceName)} target="_blank" class="detail-link">{skill.sourceName}</a>
                </div>
              {/if}
            </div>
          {/if}
          {#if skill.sourceType === "package" && skill.sourceName}
            <div class="skill-actions">
              <button
                class="remove-btn"
                onclick={() => removeSkillPackage(skill)}
                title="Remove package"
              >
                Remove
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="footer">
    <p class="footer-hint">
      Install skill packages via the <strong>Packages</strong> tab, or
      configure extra skill paths below.
    </p>
  </div>

  <section class="skill-paths-section">
    <h4>Skill Paths</h4>
    <p class="section-desc">Additional local skill directories (paths to folders containing SKILL.md files)</p>

    <div class="skill-paths-list">
      {#each extraSkillPaths as path, i}
        <div class="skill-path-item">
          <span class="skill-path-text">{path}</span>
          <button class="remove-path-btn" onclick={() => removeSkillPath(i)} title="Remove path">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
    <div class="add-path-form">
      <input
        type="text"
        placeholder="/path/to/skill/directory"
        bind:value={newSkillPath}
        onkeydown={(e) => e.key === 'Enter' && addSkillPath()}
      />
      <button class="add-path-btn" onclick={addSkillPath} disabled={!newSkillPath.trim()}>Add</button>
    </div>
  </section>
</div>

{#if showLoadingOverlay}
  <div class="loading-overlay">
    <div class="loading-dialog">
      <div class="loading-header">
        <span class="loading-spinner"></span>
        <strong>Working...</strong>
      </div>
      <pre class="output-log">{outputText}</pre>
      <button
        class="close-btn"
        onclick={() => {
          showLoadingOverlay = false;
          outputText = "";
        }}>Close</button
      >
    </div>
  </div>
{/if}

<style>
  .skills-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
    overflow-y: hidden;
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
    margin: 0;
  }

  .skill-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    padding: 2px 8px;
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
  }

  .discovery-toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-weight: 500;
    font-size: var(--text-sm);
  }

  .toggle-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .filter-bar {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .search-input {
    flex: 1;
    font-size: var(--text-sm);
  }

  .refresh-btn {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: var(--color-surface-2);
  }

  .skills-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .skill-card {
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: border-color var(--transition-fast);
  }

  .skill-card:hover {
    border-color: var(--color-primary);
  }

  .skill-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .skill-name-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .skill-name {
    font-weight: 600;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--color-text);
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    flex-shrink: 0;
  }

  .badge-local {
    background: color-mix(in oklch, var(--color-warning) 20%, transparent);
    color: var(--color-warning);
  }

  .badge-package {
    background: color-mix(in oklch, var(--color-primary) 20%, transparent);
    color: var(--color-primary);
  }

  .badge-built-in {
    background: color-mix(in oklch, var(--color-success) 20%, transparent);
    color: var(--color-success);
  }

  .skill-desc {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: 1.4;
    margin: 0;
  }

  .skill-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    opacity: 0.8;
  }

  .meta-item {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .skill-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    margin-top: var(--space-1);
  }

  .detail-row {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .detail-label {
    color: var(--color-text-muted);
    font-weight: 500;
    min-width: 60px;
  }

  .detail-value {
    color: var(--color-text);
    word-break: break-all;
  }

  .detail-path {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .detail-link {
    color: var(--color-primary);
    text-decoration: none;
    font-size: var(--text-xs);
  }

  .detail-link:hover {
    text-decoration: underline;
  }

  .skill-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-1);
  }

  .remove-btn {
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: 1px solid var(--color-error);
    color: var(--color-error);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .remove-btn:hover {
    background: var(--color-error);
    color: var(--color-text-inverse);
  }

  .status {
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-base);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
    text-align: center;
    gap: var(--space-3);
  }

  .empty-icon {
    color: var(--color-text-muted);
    opacity: 0.4;
  }

  .empty-title {
    font-weight: 600;
    font-size: var(--text-base);
    color: var(--color-text);
    margin: 0;
  }

  .empty-desc {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    max-width: 300px;
    line-height: 1.4;
    margin: 0;
  }

  .footer {
    padding: var(--space-3) 0 0;
    text-align: center;
    flex-shrink: 0;
    border-top: 1px solid var(--color-border);
    margin-top: var(--space-3);
  }

  .footer-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.4;
    margin: 0;
  }

  .skill-paths-section {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .skill-paths-section h4 {
    font-size: var(--text-sm);
    font-weight: 600;
    margin: 0;
  }

  .section-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0 0 var(--space-1) 0;
  }

  .skill-paths-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .skill-path-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .skill-path-text {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    word-break: break-all;
  }

  .remove-path-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    opacity: 0.4;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .remove-path-btn:hover {
    opacity: 1;
    color: var(--color-error);
    background: oklch(from var(--color-error) l c h / 0.1);
  }

  .add-path-form {
    display: flex;
    gap: var(--space-2);
  }

  .add-path-form input {
    flex: 1;
    font-size: var(--text-xs);
  }

  .add-path-btn {
    padding: var(--space-2) var(--space-3);
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .add-path-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loading-dialog {
    background: var(--color-surface);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 300px;
    max-width: 400px;
  }

  .loading-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .output-log {
    max-height: 150px;
    width: 100%;
    overflow-y: auto;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .close-btn {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    align-self: flex-end;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
