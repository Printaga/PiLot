<script lang="ts">
  import type { OpenConfigFileKey, Model, ThinkingLevel } from "../types/index";
  import type {
    CodemodeMode,
    CodemodeProjectStatus,
    CodemodeSettings,
    CodemodeSettingsPatch,
    CodemodeSource,
    CodemodeSources,
  } from "../../protocol/types";
  import HelpTooltip from "./HelpTooltip.svelte";

  // Single source for the fallback level list (mirrors the prop default; both
  // derive from the shared ThinkingLevel union in ../types/index). Declared
  // before the Props destructuring that consumes it.
  const DEFAULT_THINKING_LEVELS: readonly ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];

  interface Props {
    autoContext: boolean;
    appVersion: string;
    thinkingLevel: ThinkingLevel | string;
    availableThinkingLevels?: readonly ThinkingLevel[];
    showCacheMissNotices?: boolean;
    lightMode?: boolean;
    /** Pinned commit-message model (`provider/id`); empty uses the standard PI model. */
    commitMessageModel?: string;
    /** Candidate models, sourced from the CLI-reported list. */
    commitMessageModels?: Model[];
    onAutoContextChange: (value: boolean) => void;
    onThinkingLevelChange: (level: string) => void;
    onShowCacheMissNoticesChange?: (value: boolean) => void;
    onLightModeChange?: (value: boolean) => void;
    onCommitMessageModelChange?: (modelId: string) => void;
  }

  let {
    autoContext,
    appVersion,
    thinkingLevel,
    availableThinkingLevels = [...DEFAULT_THINKING_LEVELS],
    showCacheMissNotices = false,
    lightMode = false,
    commitMessageModel = "",
    commitMessageModels = [],
    onAutoContextChange,
    onThinkingLevelChange,
    onShowCacheMissNoticesChange,
    onLightModeChange,
    onCommitMessageModelChange,
  }: Props = $props();

  /** Sentinel value for the "standard PI model" option. */
  const STANDARD_MODEL_VALUE = "";

  interface ModelOption {
    value: string;
    label: string;
  }

  // Assembled here rather than in the template so the chooser stays a flat
  // list, and so a pinned model absent from the reported list is still shown
  // instead of silently appearing unset.
  const hasUnlistedPinnedModel = $derived(
    Boolean(commitMessageModel) && !commitMessageModels.some((m) => m.id === commitMessageModel),
  );

  const modelOptions = $derived.by<ModelOption[]>(() => {
    const options: ModelOption[] = [
      { value: STANDARD_MODEL_VALUE, label: "Use standard PI model" },
    ];
    for (const model of commitMessageModels) {
      options.push({ value: model.id, label: model.name || model.id });
    }
    if (hasUnlistedPinnedModel) {
      options.push({ value: commitMessageModel, label: commitMessageModel });
    }
    return options;
  });

  function handleCommitMessageModelChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    onCommitMessageModelChange?.(value);
  }

  const levels = $derived.by<readonly ThinkingLevel[]>(() =>
    availableThinkingLevels && availableThinkingLevels.length > 0
      ? availableThinkingLevels
      : [...DEFAULT_THINKING_LEVELS],
  );
  // The level actually applied, clamped to what the selected model supports.
  const effectiveThinkingLevel = $derived.by((): ThinkingLevel => {
    if (levels.includes(thinkingLevel as ThinkingLevel)) return thinkingLevel as ThinkingLevel;
    return levels[0] ?? "off";
  });

  function handleThinkingLevelChange(level: string) {
    onThinkingLevelChange(level);
  }

  function handleAutoContextChange() {
    onAutoContextChange(!autoContext);
  }

  function handleShowCacheMissNoticesChange() {
    if (onShowCacheMissNoticesChange) {
      onShowCacheMissNoticesChange(!showCacheMissNotices);
    }
  }

  function handleLightModeChange() {
    if (onLightModeChange) {
      onLightModeChange(!lightMode);
    }
  }

  function showTour() {
    // Emit a custom event that App.svelte listens for to show the tour
    window.dispatchEvent(new CustomEvent("show-tour"));
  }

  function openConfigFile(file: OpenConfigFileKey) {
    getVsCodeApi()?.postMessage({ type: "openConfigFile", data: { file } });
  }

  // PI ignores SYSTEM.md / APPEND_SYSTEM.md while pi-agent.systemPrompt or
  // pi-agent.appendSystemPrompts are set, so surface that here (same
  // self-fetch pattern as SkillsPanel).
  let systemPromptOverrides = $state({ systemPrompt: false, appendSystemPrompts: false });

  function getVsCodeApi() {
    const existing = window.vscode;
    if (existing?.postMessage) return existing;
    if (typeof window.acquireVsCodeApi === "function") {
      try {
        const vscode = window.acquireVsCodeApi();
        window.vscode = vscode;
        return vscode;
      } catch {
        // Already acquired elsewhere without caching; use the cached handle if
        // any so this request is not silently dropped.
        return window.vscode ?? null;
      }
    }
    return null;
  }

  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;

    function handleOverridesMessage(event: MessageEvent) {
      const { type, data } = event.data || {};
      if (type === "system-prompt-overrides-changed") {
        systemPromptOverrides = {
          systemPrompt: data?.systemPrompt === true,
          appendSystemPrompts: data?.appendSystemPrompts === true,
        };
      }
    }
    window.addEventListener("message", handleOverridesMessage);
    vscode.postMessage({ type: "getSystemPromptOverrides" });
    // Re-request on focus: the warning tells the user to change VS Code
    // settings, and it must track reality when they return after doing so.
    const refetch = () => vscode.postMessage({ type: "getSystemPromptOverrides" });
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener("message", handleOverridesMessage);
      window.removeEventListener("focus", refetch);
    };
  });

  const overridingSettingNames = $derived.by(() => {
    const names: string[] = [];
    if (systemPromptOverrides.systemPrompt) names.push("pi-agent.systemPrompt");
    if (systemPromptOverrides.appendSystemPrompts) names.push("pi-agent.appendSystemPrompts");
    return names;
  });

  // ── MCP & Codemode ─────────────────────────────────────────────────────
  // The host resolves global settings plus a trusted project's .pi/settings.json
  // for `codemode.mode`/`inlineBudget`. `autoEnableCodemode` comes from mcp.json
  // (main or project). This panel only displays effective values and sends
  // patches; edits always target the global files.
  const CODEMODE_MODES: ReadonlyArray<{ value: CodemodeMode; label: string }> = [
    { value: "on", label: "On — keep declared tools declared" },
    { value: "only", label: "Only — route every tool through codemode" },
  ];

  const CODEMODE_MODE_HELP: Record<CodemodeMode, string> = {
    on: "Declared tools stay declared and gain a note on calling them from scripts; codemode lists only the tools that are not declared.",
    only: "Codemode lists every tool scripts can call, and active built-in and extension tools are hidden from the model.",
  };

  const SOURCE_LABELS: Record<CodemodeSource, string> = {
    project: "Project",
    global: "Global",
    default: "Default",
  };

  const SOURCE_TITLES: Record<"settings" | "mcp", Record<CodemodeSource, string>> = {
    settings: {
      project: "Set by .pi/settings.json",
      global: "Set by the global settings.json",
      default: "PI default (no config value)",
    },
    mcp: {
      project: "Set by .pi/mcp.json",
      global: "Set by the main mcp.json",
      default: "PI default (no config value)",
    },
  };

  const CODEMODE_PROJECT_STATUSES: readonly CodemodeProjectStatus[] = [
    "none",
    "applied",
    "ignored",
    "invalid",
  ];

  const EXPOSURE_GUIDE: ReadonlyArray<{ name: string; title: string; copy: string }> = [
    {
      name: "Codemode",
      title: "Best default for many tools",
      copy: "The model writes a script that discovers and calls tools as needed. Good for servers with many tools and workflows involving several calls.",
    },
    {
      name: "Deferred",
      title: "Discover, then call directly",
      copy: "The model searches for a relevant tool, which PI exposes for a subsequent model call. Useful with a large catalog when you prefer ordinary direct calls after discovery.",
    },
    {
      name: "Direct",
      title: "Always visible to the model",
      copy: "Tools are declared like built-in tools. Best for a small set of frequently used tools; large tool lists consume more prompt tokens.",
    },
    {
      name: "Hidden",
      title: "Configured but unreachable",
      copy: "Registered but unreachable by the model. Useful for keeping a server configured while preventing any use.",
    },
  ];

  let codemode = $state<CodemodeSettings>({
    mode: "on",
    inlineBudget: 3000,
    autoEnableCodemode: true,
    sources: {
      mode: "default",
      inlineBudget: "default",
      autoEnableCodemode: "default",
    },
    projectStatus: "none",
  });

  const hasProjectSettingsOverride = $derived(
    codemode.sources.mode === "project" || codemode.sources.inlineBudget === "project",
  );
  const hasProjectMcpOverride = $derived(codemode.sources.autoEnableCodemode === "project");
  const projectErrorSuffix = $derived(codemode.projectError ? `: ${codemode.projectError}` : ".");

  // Small coercers keep the payload guard under the complexity gate; an error
  // result never reaches here (the host omits the codemode-settings message).
  function codemodeMode(value: unknown): CodemodeMode {
    return value === "only" ? "only" : "on";
  }

  function codemodeBudget(value: unknown): number {
    return typeof value === "number" ? value : 3000;
  }

  function codemodeAutoEnable(value: unknown): boolean {
    return value !== false;
  }

  function codemodeSource(value: unknown): CodemodeSource {
    return value === "project" ? "project" : value === "global" ? "global" : "default";
  }

  function codemodeSources(value: unknown): CodemodeSources {
    const record =
      typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
      mode: codemodeSource(record.mode),
      inlineBudget: codemodeSource(record.inlineBudget),
      autoEnableCodemode: codemodeSource(record.autoEnableCodemode),
    };
  }

  function codemodeProjectStatus(value: unknown): CodemodeProjectStatus | undefined {
    return typeof value === "string" &&
      CODEMODE_PROJECT_STATUSES.includes(value as CodemodeProjectStatus)
      ? (value as CodemodeProjectStatus)
      : undefined;
  }

  function codemodeProjectInfo(record: Record<string, unknown>): Partial<CodemodeSettings> {
    const status = codemodeProjectStatus(record.projectStatus);
    return {
      ...(typeof record.projectFile === "string" ? { projectFile: record.projectFile } : {}),
      ...(status ? { projectStatus: status } : {}),
      ...(typeof record.projectError === "string" ? { projectError: record.projectError } : {}),
    };
  }

  function nextCodemodeSettings(data: unknown): CodemodeSettings | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const record = data as Record<string, unknown>;
    return {
      mode: codemodeMode(record.mode),
      inlineBudget: codemodeBudget(record.inlineBudget),
      autoEnableCodemode: codemodeAutoEnable(record.autoEnableCodemode),
      sources: codemodeSources(record.sources),
      ...codemodeProjectInfo(record),
    };
  }

  function handleCodemodeMessage(event: MessageEvent) {
    const message = event.data;
    if (message?.type !== "codemode-settings") return;
    const next = nextCodemodeSettings(message.data);
    if (next) codemode = next;
  }

  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;
    window.addEventListener("message", handleCodemodeMessage);
    vscode.postMessage({ type: "getCodemodeSettings" });
    // Project settings can change in an editor or another window while this
    // panel stays mounted; refresh the effective values when it regains focus.
    const refetch = () => vscode.postMessage({ type: "getCodemodeSettings" });
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener("message", handleCodemodeMessage);
      window.removeEventListener("focus", refetch);
    };
  });

  function sendCodemodePatch(patch: CodemodeSettingsPatch) {
    getVsCodeApi()?.postMessage({ type: "setCodemodeSettings", data: patch });
  }

  function handleCodemodeModeChange(event: Event) {
    const mode = (event.currentTarget as HTMLSelectElement).value as CodemodeMode;
    sendCodemodePatch({ mode });
  }

  function handleCodemodeBudgetChange(event: Event) {
    const budget = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(budget) && budget >= 0) {
      sendCodemodePatch({ inlineBudget: Math.floor(budget) });
    }
  }

  function handleAutoEnableCodemodeChange() {
    sendCodemodePatch({ autoEnableCodemode: !codemode.autoEnableCodemode });
  }

  // ── Cache warming ────────────────────────────────────────────────────
  type CacheWarmingMode = "off" | "streaming" | "idle";
  const CACHE_WARMING_MODES: ReadonlyArray<{ value: CacheWarmingMode; label: string }> = [
    { value: "streaming", label: "Streaming" },
    { value: "idle", label: "Idle" },
    { value: "off", label: "Off" },
  ];
  let cacheWarming = $state<CacheWarmingMode>("streaming");

  function handleCacheWarmingMessage(event: MessageEvent) {
    const message = event.data;
    if (message?.type !== "cache-warming-changed") return;
    const mode = message.data?.mode;
    if (mode === "off" || mode === "streaming" || mode === "idle") cacheWarming = mode;
  }

  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;
    window.addEventListener("message", handleCacheWarmingMessage);
    vscode.postMessage({ type: "getCacheWarming" });
    const refetch = () => vscode.postMessage({ type: "getCacheWarming" });
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener("message", handleCacheWarmingMessage);
      window.removeEventListener("focus", refetch);
    };
  });

  function handleCacheWarmingChange(event: Event) {
    const mode = (event.currentTarget as HTMLSelectElement).value;
    if (mode === "off" || mode === "streaming" || mode === "idle") {
      cacheWarming = mode;
      getVsCodeApi()?.postMessage({ type: "setCacheWarming", data: { mode } });
    }
  }

  // ── defaultTools codemode ────────────────────────────────────────────
  let defaultToolsCodemode = $state({ enabled: false, globalEnabled: false });

  function handleDefaultToolsCodemodeMessage(event: MessageEvent) {
    const message = event.data;
    if (message?.type !== "default-tools-codemode") return;
    const data = message.data;
    if (typeof data?.enabled === "boolean") {
      defaultToolsCodemode = {
        enabled: data.enabled,
        globalEnabled: data.globalEnabled === true,
      };
    }
  }

  $effect(() => {
    const vscode = getVsCodeApi();
    if (!vscode) return;
    window.addEventListener("message", handleDefaultToolsCodemodeMessage);
    vscode.postMessage({ type: "getDefaultToolsCodemode" });
    const refetch = () => vscode.postMessage({ type: "getDefaultToolsCodemode" });
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener("message", handleDefaultToolsCodemodeMessage);
      window.removeEventListener("focus", refetch);
    };
  });

  function handleDefaultToolsCodemodeChange() {
    getVsCodeApi()?.postMessage({
      type: "setDefaultToolsCodemode",
      data: { enabled: !defaultToolsCodemode.enabled },
    });
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
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
            <HelpTooltip
              text="When enabled, automatically includes project context (package.json, git info, tsconfig) in every prompt to give the AI better awareness of your project setup. Forced off while Light Mode is on — every attached token consumes RAM/VRAM a local LLM needs. Your preference is restored when Light Mode is switched off."
              title="Auto Context"
            />
          </div>
          <span class="setting-description">
            Automatically include project context in prompts
            {#if lightMode}<em class="forced-off-note"> — off in Light Mode</em>{/if}
          </span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={lightMode ? false : autoContext}
            onchange={handleAutoContextChange}
            disabled={lightMode}
            aria-label="Auto Context"
            title={lightMode ? "Auto context is off while Light Mode is enabled" : undefined}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Light Mode (local LLMs)</span>
            <HelpTooltip
              text="Runs pi in a reduced mode ideal for local models (e.g. via llama.cpp). Equivalent to: pi --no-skills --no-extensions --no-context-files --no-prompt-templates --no-themes --tools read,bash,edit,write — the tool restriction applies while the tool preset is 'default' (explicit presets like review or custom keep their behavior). Disables discovery of skills, extensions, context files, prompt templates and themes, and turns Auto Context off (restored when Light Mode is switched off). The current session restarts with its history preserved."
              title="Light Mode"
            />
          </div>
          <span class="setting-description">
            {#if lightMode}Active — skills, packages and auto context are disabled{:else}Minimal
              runtime: no discovered resources, core tools only{/if}
          </span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={lightMode}
            onchange={handleLightModeChange}
            aria-label="Light Mode (local LLMs)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Cache Warming</span>
            <HelpTooltip
              text="Keep valuable prompt cache warm so repeated runs reuse it. Streaming warms while you work, idle warms when the session is idle, off disables it. Applies to new sessions; the live session is updated too."
              title="Cache Warming"
            />
          </div>
          <span class="setting-description"> Keep prompt cache warm between runs </span>
        </div>
        <select
          class="codemode-select"
          aria-label="Cache Warming"
          value={cacheWarming}
          onchange={handleCacheWarmingChange}
        >
          {#each CACHE_WARMING_MODES as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Cache Miss Notices</span>
            <HelpTooltip
              text="When enabled, PI surfaces cache-miss notices so you can see when a cached response could not be reused."
              title="Cache Miss Notices"
            />
          </div>
          <span class="setting-description"> Show cache-miss notices in replies </span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={showCacheMissNotices}
            onchange={handleShowCacheMissNoticesChange}
            aria-label="Cache Miss Notices"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </section>

    <section class="settings-section">
      <h4>MCP &amp; Codemode</h4>
      <p class="section-description">
        PI routes MCP tools through codemode by default. These controls show the effective values
        from PI's global config and a trusted project's <code>.pi/settings.json</code>. Edits write
        the global config and apply to new sessions.
      </p>

      {#snippet sourceBadge(source: CodemodeSource, kind: "settings" | "mcp")}
        <span
          class="source-badge"
          class:project={source === "project"}
          title={SOURCE_TITLES[kind][source]}>{SOURCE_LABELS[source]}</span
        >
      {/snippet}

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Auto-enable Codemode</span>
            {@render sourceBadge(codemode.sources.autoEnableCodemode, "mcp")}
            <HelpTooltip
              text="When a server with codemode exposure connects, PI activates the codemode tool automatically. Turn this off to keep codemode inactive unless you enable it yourself (for example with defaultTools). Writes autoEnableCodemode to the main mcp.json."
              title="Auto-enable Codemode"
            />
          </div>
          <span class="setting-description">
            Activate codemode when a codemode server connects. A project-level value overrides this
            one.
          </span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={codemode.autoEnableCodemode}
            onchange={handleAutoEnableCodemodeChange}
            aria-label="Auto-enable Codemode"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Enable Codemode by default</span>
            <HelpTooltip
              text="Adds +codemode to the global defaultTools so every new session starts with the codemode tool available. A project-level defaultTools still layers on top. Applies to new sessions."
              title="Enable Codemode by default"
            />
          </div>
          <span class="setting-description">
            {#if defaultToolsCodemode.globalEnabled}On — +codemode is in the global defaultTools{:else}Off
              — codemode activates via MCP or per-session tools{/if}
          </span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={defaultToolsCodemode.enabled}
            onchange={handleDefaultToolsCodemodeChange}
            aria-label="Enable Codemode by default"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Codemode mode</span>
            {@render sourceBadge(codemode.sources.mode, "settings")}
            <HelpTooltip
              text="With 'on', declared tools stay declared and their descriptions explain how to call them from scripts; codemode lists only tools that are not declared. With 'only', every tool is listed in the codemode description and hidden from the model, so all calls go through scripts."
              title="Codemode Mode"
            />
          </div>
          <span class="setting-description">{CODEMODE_MODE_HELP[codemode.mode]}</span>
        </div>
        <select
          class="codemode-select"
          aria-label="Codemode mode"
          value={codemode.mode}
          onchange={handleCodemodeModeChange}
        >
          {#each CODEMODE_MODES as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Inline tool budget</span>
            {@render sourceBadge(codemode.sources.inlineBudget, "settings")}
            <HelpTooltip
              text="Estimated tokens (characters / 4) the codemode description may spend on TypeScript tool declarations. Tools that do not fit are left out and found with searchTools(). 0 lists only namespaces. Writes codemode.inlineBudget to settings.json."
              title="Inline Tool Budget"
            />
          </div>
          <span class="setting-description">
            Tokens for tool declarations before tools move behind searchTools()
          </span>
        </div>
        <input
          class="number-input"
          type="number"
          min="0"
          step="100"
          value={codemode.inlineBudget}
          onchange={handleCodemodeBudgetChange}
          aria-label="Inline tool budget"
        />
      </div>

      {#if codemode.projectStatus === "ignored"}
        <p class="source-note warning" role="status">
          Project .pi/settings.json is ignored because this project is not trusted. Only global
          values are shown.
        </p>
      {:else if codemode.projectStatus === "invalid"}
        <p class="source-note warning" role="status">
          Could not read .pi/settings.json{projectErrorSuffix} Global values are shown.
        </p>
      {/if}
      {#if hasProjectSettingsOverride}
        <p class="source-note">
          Values marked Project come from .pi/settings.json. Saving here updates your global
          settings, but the project override still wins in this workspace.
        </p>
      {/if}
      {#if hasProjectMcpOverride}
        <p class="source-note">
          Auto-enable is overridden by .pi/mcp.json. Saving here updates the main mcp.json, but the
          project value still wins in this workspace.
        </p>
      {/if}

      <h5>MCP tool exposure</h5>
      <p class="section-description">
        Exposure is set per server, not globally. Change it in the MCP tab or in mcp.json.
      </p>
      <div class="exposure-guide">
        {#each EXPOSURE_GUIDE as item (item.name)}
          <div class="exposure-item">
            <span class="exposure-name">{item.name} <span>— {item.title}</span></span>
            <span class="exposure-copy">{item.copy}</span>
          </div>
        {/each}
      </div>
    </section>

    <section class="settings-section">
      <h4>Thinking Level</h4>
      <div class="setting-header-row">
        <p class="section-description">Control how much reasoning the AI uses before responding</p>
        <HelpTooltip
          text="Higher thinking levels produce deeper analysis but take longer. 'off' disables chain-of-thought entirely. 'medium' is the recommended default."
          title="Thinking Levels"
        />
      </div>

      <div class="thinking-options">
        {#each levels as level (level)}
          <button
            class="thinking-option"
            class:selected={effectiveThinkingLevel === level}
            aria-pressed={effectiveThinkingLevel === level}
            onclick={() => handleThinkingLevelChange(level)}
          >
            <span class="level-name">{level}</span>
            <span class="level-description">
              {#if level === "off"}
                No additional reasoning
              {:else if level === "minimal"}
                Quick thoughts
              {:else if level === "low"}
                Brief reasoning
              {:else if level === "medium"}
                Standard reasoning
              {:else if level === "high"}
                Deep analysis
              {:else if level === "max"}
                Absolute maximum reasoning
              {:else}
                Maximum reasoning
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </section>

    <section class="settings-section">
      <h4>Commit Messages</h4>
      <div class="setting-header-row">
        <p class="section-description">
          Model used when drafting a commit message from the Source Control title bar.
        </p>
        <HelpTooltip
          text="Leave this on 'Use standard PI model' to draft with the same model as the chat session. Pin a specific model to keep commit messages cheap and fast."
          title="Commit Message Model"
        />
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label-row">
            <span class="setting-label">Drafting model</span>
          </div>
          <span class="setting-description">Writes pi-agent.git.commitMessageModel</span>
        </div>
        <select
          class="model-select"
          aria-label="Commit message model"
          value={commitMessageModel}
          onchange={handleCommitMessageModelChange}
        >
          {#each modelOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h4>Keyboard Shortcuts</h4>
      <p class="section-description">Master these shortcuts to navigate faster</p>

      <div class="shortcut-list">
        <div class="shortcut-item">
          <span class="shortcut-key">1 – 9</span>
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
        <button class="config-btn" onclick={() => openConfigFile("settings")}>
          Open settings.json
        </button>
        <button class="config-btn" onclick={() => openConfigFile("auth")}> Open auth.json </button>
        <button class="config-btn" onclick={() => openConfigFile("models")}>
          Open models.json
        </button>
        <button class="config-btn" onclick={() => openConfigFile("mcp")}> Open mcp.json </button>
      </div>
      <p class="section-description" style="margin-top: var(--space-3);">
        Customize PI's system prompt. Applies to new sessions.
      </p>
      <div class="config-files">
        <button class="config-btn" onclick={() => openConfigFile("system-prompt")}>
          Open SYSTEM.md
        </button>
        <button class="config-btn" onclick={() => openConfigFile("append-system-prompt")}>
          Open APPEND_SYSTEM.md
        </button>
      </div>
      <p class="config-hint">
        SYSTEM.md replaces PI's default system prompt; APPEND_SYSTEM.md appends to it. Files live in
        PI's agent directory (default ~/.pi/agent).
      </p>
      {#if overridingSettingNames.length > 0}
        <p class="system-prompt-warning" role="alert">
          Overridden by {overridingSettingNames.join(" and ")}: SYSTEM.md and APPEND_SYSTEM.md are
          ignored for new sessions until cleared in VS Code settings.
        </p>
      {/if}
    </section>

    <section class="settings-section">
      <h4>About</h4>
      <div class="about-info">
        <p><strong>PiLot Studio</strong> {appVersion}</p>
        <p>Integrates the PI coding agent into VS Code</p>
        <p class="muted">Powered by @earendil-works/pi-coding-agent</p>
        <div class="about-links">
          <a href="https://pi.dev" target="_blank" rel="noopener">PI CLI Docs</a>
          <a
            href="https://github.com/printagapublishing/PiLot-Studio"
            target="_blank"
            rel="noopener">GitHub</a
          >
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
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .source-badge {
    padding: 1px var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.4;
  }

  .source-badge.project {
    border-color: color-mix(in oklch, var(--color-primary) 45%, transparent);
    background: color-mix(in oklch, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }

  .source-note {
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .source-note.warning {
    color: var(--color-warning);
  }

  .setting-label {
    font-weight: 500;
  }

  .setting-description {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .forced-off-note {
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--color-warning);
  }

  .model-select {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    max-width: 60%;
  }

  .model-select:hover {
    background: var(--color-surface-2);
  }

  .codemode-select {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    max-width: 60%;
  }

  .codemode-select:hover {
    background: var(--color-surface-2);
  }

  .number-input {
    width: 96px;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: right;
  }

  .number-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  h5 {
    margin: var(--space-4) 0 var(--space-1);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .exposure-guide {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .exposure-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .exposure-name {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .exposure-name span {
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .exposure-copy {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.5;
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
    content: "";
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
    gap: var(--space-1);
  }

  .shortcut-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .shortcut-key {
    font-family: monospace;
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .shortcut-desc {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .config-files {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .config-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }

  .system-prompt-warning {
    font-size: var(--text-xs);
    color: var(--color-warning);
    margin-top: var(--space-2);
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

  .about-links {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }

  .about-links a {
    font-size: var(--text-xs);
    color: var(--color-primary);
    text-decoration: none;
  }
  .about-links a:hover {
    text-decoration: underline;
  }
</style>
