<script lang="ts">
  import { onMount } from "svelte";

  interface MarketplacePackage {
    name: string;
    description: string;
    version: string;
    publisher: string;
    monthlyDownloads: number;
    flagged: boolean;
    types: string[];
    updated?: string;
  }

  interface InstalledPackage {
    source: string;
    path: string;
    description: string;
    version: string;
    types: string[];
    skills: Array<{ name: string; description: string }>;
    extensions: Array<{ path: string; sourceName: string | null }>;
    prompts: Array<{ name: string; description: string }>;
  }

  // State
  let activeTab = $state<"installed" | "available">("installed");
  let installedPackages = $state<InstalledPackage[]>([]);
  let marketplacePackages = $state<MarketplacePackage[]>([]);
  let marketplaceLoading = $state(false);
  let marketplaceError = $state<string | null>(null);
  let installedQuery = $state("");
  let availableQuery = $state("");
  let typeFilter = $state<"all" | "extensions" | "skills" | "prompts" | "themes">("all");
  let sortOption = $state<"downloads" | "newest" | "name">("downloads");
  let showLoadingOverlay = $state(false);
  let outputText = $state("");

  // Computed: filtered and sorted marketplace packages
  let filteredPackages = $derived(
    marketplacePackages
      .filter((pkg) => {
        const q = availableQuery.toLowerCase();
        const matchesSearch =
          !q ||
          pkg.name.toLowerCase().includes(q) ||
          pkg.description.toLowerCase().includes(q);

        if (typeFilter === "all") return matchesSearch;

        return matchesSearch && pkg.types.includes(typeFilter);
      })
      .sort((a, b) => {
        switch (sortOption) {
          case "downloads":
            return b.monthlyDownloads - a.monthlyDownloads;
          case "newest":
            return new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime();
          case "name":
            return a.name.localeCompare(b.name);
          default:
            return 0;
        }
      }),
  );

  // Check if package is installed
  function isInstalled(name: string): boolean {
    return installedPackages.some((p) =>
      p.source.toLowerCase().includes(name.toLowerCase()),
    );
  }

  function getVsCodeApi() {
    const existing = (window as any).vscode;
    if (existing?.postMessage) {
      return existing;
    }

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

  function npmUrl(name: string): string {
    return `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
  }

  function formatPackageMeta(pkg: MarketplacePackage): string {
    const parts: string[] = [];
    if (pkg.publisher) parts.push(`by ${pkg.publisher}`);
    if (pkg.monthlyDownloads > 0)
      parts.push(`${pkg.monthlyDownloads.toLocaleString()}/mo`);
    if (pkg.version) parts.push(`v${pkg.version}`);
    return parts.join(" · ");
  }

async function fetchMarketplacePackages() {
    marketplaceLoading = true;
    marketplaceError = null;
    try {
      const res = await fetch(
        "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250",
      );
      const data = await res.json();
      const packages = (data.objects || []).map((o: any) => {
        // Detect all available types
        const types: string[] = [];
        if (o.package.pi?.extensions?.length) types.push("extensions");
        if (o.package.pi?.skills?.length) types.push("skills");
        if (o.package.pi?.prompts?.length) types.push("prompts");
        if (o.package.pi?.themes?.length) types.push("themes");

        return {
          name: o.package.name,
          description: o.package.description || "",
          version: o.package.version || "",
          publisher:
            o.package.publisher?.username || o.package.author?.name || "",
          monthlyDownloads: o.downloads?.monthly || 0,
          flagged: false,
          types: types.length > 0 ? types : ["unknown"],
          updated: o.package.date || "",
        } as MarketplacePackage;
      });

      marketplacePackages = packages;
    } catch (e) {
      console.error("Failed to fetch marketplace packages:", e);
      marketplaceError = e instanceof Error ? e.message : String(e);
      marketplacePackages = [];
    } finally {
      marketplaceLoading = false;
    }
  }

  async function installPackage(pkgName: string) {
    sendMessage({ type: "installPackage", data: { source: `npm:${pkgName}` } });
    showLoadingOverlay = true;
    outputText = `Installing ${pkgName}...\n`;
  }

  async function removePackage(source: string) {
    sendMessage({ type: "uninstallPackage", data: { source } });
    showLoadingOverlay = true;
    outputText = `Removing ${source}...\n`;
  }

  async function updatePackages() {
    sendMessage({ type: "updateResources" });
    showLoadingOverlay = true;
    outputText = "Updating packages...\n";
  }

  async function refreshInstalled() {
    sendMessage({ type: "listPackages" });
  }

  function openPackagePage(url: string) {
    window.open(url, "_blank");
  }

  // Handle messages from extension
  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;

    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data;
      if (type === "installed") {
        installedPackages = data || [];
      }
      if (type === "loading") {
        showLoadingOverlay = data?.loading;
        if (!data?.loading) {
          setTimeout(() => {
            refreshInstalled();
          }, 100);
        }
      }
      if (type === "output") {
        outputText += data?.text || "";
      }
      if (type === "packages-updated") {
        refreshInstalled();
        setTimeout(() => {
          fetchMarketplacePackages();
        }, 1000);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  onMount(() => {
    const vscode = getVsCodeApi();
    vscode?.postMessage({ type: "listPackages" });

    fetchMarketplacePackages();
  });
</script>

<div class="packages-panel">
  <div class="tab-nav">
    <button
      class="tab-btn"
      class:active={activeTab === "installed"}
      onclick={() => (activeTab = "installed")}
    >
      Installed
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === "available"}
      onclick={() => (activeTab = "available")}
    >
      Available
    </button>
  </div>

  {#if activeTab === "installed"}
    <div class="packages-content">
      {#if installedPackages.length === 0}
        <div class="status">No packages installed</div>
      {:else}
        <div class="filter-bar">
          <input
            type="text"
            placeholder="Search installed..."
            bind:value={installedQuery}
            class="search-input"
          />
          <button class="refresh-btn" onclick={refreshInstalled} title="Refresh"
            >↻</button
          >
        </div>
        {#each installedPackages.filter((p) => p.source
            .toLowerCase()
            .includes(installedQuery.toLowerCase())) as pkg}
          <div class="package-card installed">
            <div class="package-header">
              <span class="package-name"
                >{pkg.source.replace(/^npm:|^github:|^http/i, "")}</span
              >
              {#if pkg.types?.length > 0}
                <div class="package-badges">
                  {#each pkg.types as type}
                    <span class="badge badge-{type}">{type}</span>
                  {/each}
                </div>
              {/if}
              {#if pkg.source.toLowerCase().startsWith("npm:")}
                <a
                  href={npmUrl(pkg.source.replace("npm:", ""))}
                  target="_blank"
                  class="package-link"
                  title="Open on npm"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path
                      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                    /><path d="M15 22v-4h-7" /><path d="M11 18h7" /><path
                      d="M12 18v-6"
                    /></svg
                  >
                </a>
              {/if}
            </div>
            {#if pkg.description}
              <div class="package-desc">{pkg.description}</div>
            {/if}
            <div class="package-meta">
              {#if pkg.version}<span class="meta-item">v{pkg.version}</span>{/if}
              {#if pkg.path}<span class="meta-item">{pkg.path}</span>{/if}
            </div>
            {#if pkg.skills?.length > 0}
              <div class="package-resources">
                <span class="resources-label">Skills:</span>
                {#each pkg.skills as skill}
                  <span class="resource-item" title={skill.description}>{skill.name}</span>
                {/each}
              </div>
            {/if}
            {#if pkg.extensions?.length > 0}
              <div class="package-resources">
                <span class="resources-label">Extensions:</span>
                {#each pkg.extensions as ext}
                  <span class="resource-item">{ext.sourceName || ext.path.split('/').pop() || 'extension'}</span>
                {/each}
              </div>
            {/if}
            {#if pkg.prompts?.length > 0}
              <div class="package-resources">
                <span class="resources-label">Prompts:</span>
                {#each pkg.prompts as prompt}
                  <span class="resource-item" title={prompt.description}>{prompt.name}</span>
                {/each}
              </div>
            {/if}
            <div class="package-actions">
              <button
                class="uninstall-btn"
                onclick={() => removePackage(pkg.source)}>Remove</button
              >
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="packages-content">
        <div class="available-filter">
        <div class="search-row">
          <input
            type="text"
            placeholder="Search available packages..."
            bind:value={availableQuery}
            class="search-input"
          />
        </div>
        <div class="filter-row">
          <button
            class="refresh-btn"
            onclick={fetchMarketplacePackages}
            title="Refresh">↻</button
          >
          <select bind:value={typeFilter} class="filter-select">
            <option value="all">All Types</option>
            <option value="extensions">Extensions</option>
            <option value="skills">Skills</option>
            <option value="prompts">Prompts</option>
            <option value="themes">Themes</option>
          </select>
          <select bind:value={sortOption} class="filter-select">
            <option value="downloads">Most Downloads</option>
            <option value="newest">Newest</option>
            <option value="name">A-Z</option>
          </select>
          <button
            class="update-btn"
            onclick={updatePackages}
            title="Update all packages">Update</button
          >
        </div>
      </div>

      {#if marketplaceLoading}
        <div class="status">Loading available packages...</div>
      {:else if marketplaceError}
        <div class="status error">Error: {marketplaceError}</div>
      {:else if filteredPackages.length === 0}
        <div class="status">No available packages match your search.</div>
      {:else}
        {#each filteredPackages as pkg}
          <div class="package-card">
            <div class="package-header">
              <a
                href={npmUrl(pkg.name)}
                target="_blank"
                class="package-name"
                onclick={(e) => {
                  e.preventDefault();
                  openPackagePage(npmUrl(pkg.name));
                }}
              >
                {pkg.name}
              </a>
              {#if pkg.types.some(t => t !== 'unknown')}
                <div class="package-badges">
                  {#each pkg.types as type}
                    {#if type !== 'unknown'}
                      <span class="badge badge-{type}">{type}</span>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
            {#if pkg.flagged}
              <div class="flagged-badge">Flagged</div>
            {/if}
            <div class="package-desc">
              {pkg.description || "No description"}
            </div>
            <div class="package-meta">{formatPackageMeta(pkg)}</div>
            <div class="package-actions">
              {#if isInstalled(pkg.name)}
                <button class="installed-badge" disabled>Installed</button>
              {:else}
                <button
                  class="install-btn"
                  onclick={() => installPackage(pkg.name)}>Install</button
                >
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="footer">
    <a
      href="https://pi.dev/packages"
      target="_blank"
      class="browse-link">Browse all packages ↗</a
    >
  </div>
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
  .packages-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-4);
    overflow-y: hidden;
  }

  .tab-nav {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-lg);
  }

  .tab-btn {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all var(--transition-interactive);
  }

  .tab-btn:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .tab-btn.active {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .filter-bar {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .available-filter {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .search-row {
    display: flex;
  }

  .filter-row {
    display: flex;
    gap: var(--space-3);
  }

  .search-input {
    flex: 1;
    font-size: var(--text-sm);
  }

  .refresh-btn,
  .update-btn {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .refresh-btn:hover,
  .update-btn:hover {
    background: var(--color-surface-2);
  }

  .filter-select {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    min-width: 120px;
  }

  .filter-select:hover {
    background: var(--color-surface-2);
  }

  .packages-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .package-card {
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .package-card:hover {
    border-color: var(--color-primary);
  }

  .package-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .package-name {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--color-text);
    text-decoration: none;
  }

  .package-name:hover {
    text-decoration: underline;
    color: var(--color-primary);
  }

  .package-link {
    flex-shrink: 0;
    color: var(--color-text-muted);
    text-decoration: none;
  }

  .package-link:hover {
    color: var(--color-primary);
  }

  .package-badges {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .badge-extensions {
    background: color-mix(in oklch, var(--color-primary) 20%, transparent);
    color: var(--color-primary);
  }
  .badge-skills {
    background: color-mix(in oklch, var(--color-success) 20%, transparent);
    color: var(--color-success);
  }
  .badge-prompts {
    background: color-mix(in oklch, var(--color-warning) 20%, transparent);
    color: var(--color-warning);
  }
  .badge-themes {
    background: color-mix(in oklch, #8b5cf6 20%, transparent);
    color: #a78bf6;
  }

  .installed-badge {
    padding: var(--space-1) var(--space-2);
    background: var(--color-success);
    color: var(--color-text-inverse);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    cursor: default;
  }

  .flagged-badge {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    background: var(--color-warning);
    color: var(--color-text-inverse);
    border-radius: var(--radius-sm);
    width: fit-content;
  }

  .package-desc {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .package-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    opacity: 0.8;
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .package-resources {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-xs);
  }

  .resources-label {
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .resource-item {
    display: inline-block;
    padding: 1px 6px;
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: 10px;
  }

  .package-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-2);
  }

  .install-btn,
  .uninstall-btn {
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .install-btn {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .install-btn:hover {
    background: var(--color-primary-hover);
  }

  .uninstall-btn {
    background: var(--color-error);
    color: var(--color-text-inverse);
  }

  .uninstall-btn:hover {
    opacity: 0.9;
  }

  .status {
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-base);
  }

  .status.error {
    color: var(--color-error);
  }

  .footer {
    padding: var(--space-3) 0 0;
    text-align: center;
    flex-shrink: 0;
  }

  .browse-link {
    font-size: var(--text-xs);
    color: var(--color-primary);
    text-decoration: none;
    opacity: 0.7;
  }

  .browse-link:hover {
    opacity: 1;
    text-decoration: underline;
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
