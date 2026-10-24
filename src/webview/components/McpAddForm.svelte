<script lang="ts">
  import {
    EXPOSURES,
    EXPOSURE_HELP,
    type McpAddDraft,
    type McpAddRequest,
    type McpFiles,
  } from "../mcp-display";

  let {
    files,
    busy = false,
    onSubmit,
  }: {
    files: McpFiles;
    busy?: boolean;
    onSubmit: (input: McpAddRequest) => void;
  } = $props();

  function emptyDraft(): McpAddDraft {
    return {
      name: "",
      local: false,
      transport: "stdio",
      command: "",
      args: "",
      cwd: "",
      url: "",
      env: "",
      headers: "",
      bearerTokenEnvVar: "",
      oauthClientId: "",
      oauthClientSecret: "",
      description: "",
      exposure: "codemode",
    };
  }

  let draft = $state(emptyDraft());
  let formError = $state("");

  function parsePair(line: string, label: string): [string, string] {
    const separator = line.indexOf("=");
    if (separator > 0) return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    throw new Error(`${label} must use KEY=VALUE, got "${line}".`);
  }

  function parsePairs(text: string, label: string): Record<string, string> {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return Object.fromEntries(lines.map((line) => parsePair(line, label)));
  }

  function formNameError(): string | undefined {
    const name = draft.name.trim();
    if (!name) return "Server name is required.";
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return 'Server names may contain only letters, digits, "_" and "-".';
    }
    return undefined;
  }

  function urlError(): string | undefined {
    const url = draft.url.trim();
    if (!url) return "A URL is required for an HTTP server.";
    if (!/^https?:\/\//i.test(url)) return "The server URL must start with http:// or https://.";
    return undefined;
  }

  function transportError(): string | undefined {
    if (draft.transport === "stdio") {
      return draft.command.trim() ? undefined : "A command is required for a stdio server.";
    }
    return urlError();
  }

  function validate(): string | undefined {
    return formNameError() ?? transportError();
  }

  function stdioFields() {
    const cwd = draft.cwd.trim();
    return {
      ...(cwd ? { cwd } : {}),
      command: draft.command.trim(),
      args: draft.args
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      env: parsePairs(draft.env, "Environment entries"),
      headers: {},
    };
  }

  function optionalAuthFields() {
    const bearerTokenEnvVar = draft.bearerTokenEnvVar.trim();
    const oauthClientId = draft.oauthClientId.trim();
    const oauthClientSecret = draft.oauthClientSecret.trim();
    return {
      ...(bearerTokenEnvVar ? { bearerTokenEnvVar } : {}),
      ...(oauthClientId ? { oauthClientId } : {}),
      ...(oauthClientSecret ? { oauthClientSecret } : {}),
    };
  }

  function httpFields() {
    return {
      url: draft.url.trim(),
      env: {},
      headers: parsePairs(draft.headers, "Headers"),
      ...optionalAuthFields(),
    };
  }

  function buildRequest(): McpAddRequest {
    const transportFields = draft.transport === "stdio" ? stdioFields() : httpFields();
    return {
      name: draft.name.trim(),
      local: draft.local,
      transport: draft.transport,
      description: draft.description.trim() || undefined,
      exposure: draft.exposure,
      ...transportFields,
    };
  }

  function submit() {
    formError = "";
    const error = validate();
    if (error) {
      formError = error;
      return;
    }
    try {
      onSubmit(buildRequest());
    } catch (error) {
      formError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<form
  class="add-form"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  <div class="form-row two">
    <label>
      Name
      <input
        type="text"
        placeholder="filesystem"
        bind:value={draft.name}
        required
        pattern="[A-Za-z0-9_-]+"
      />
    </label>
    <label>
      Save to
      <select bind:value={draft.local}>
        <option value={false}>{files.global || "User mcp.json"}</option>
        <option value={true}>{files.project || "Project .pi/mcp.json"}</option>
      </select>
    </label>
  </div>
  <div class="form-row two">
    <label>
      Transport
      <select bind:value={draft.transport}>
        <option value="stdio">stdio</option>
        <option value="http">Streamable HTTP</option>
      </select>
    </label>
    <label>
      Exposure
      <select bind:value={draft.exposure}>
        {#each EXPOSURES as exposure (exposure)}
          <option value={exposure}>{exposure}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if draft.transport === "stdio"}
    <label>
      Command
      <input type="text" placeholder="npx" bind:value={draft.command} />
    </label>
    <label>
      Arguments (one per line) <textarea
        rows="3"
        placeholder="One argument per line"
        bind:value={draft.args}></textarea>
    </label>
    <label>
      Environment (KEY=VALUE, one per line)
      <textarea rows="2" placeholder="API_KEY=your-key" bind:value={draft.env}></textarea>
    </label>
    <label>
      Working directory (optional)
      <input type="text" placeholder="/path/to/project" bind:value={draft.cwd} />
    </label>
  {:else}
    <label>
      URL
      <input type="url" placeholder="https://example.com/mcp" bind:value={draft.url} />
    </label>
    <label>
      Headers (KEY=VALUE, one per line)
      <textarea rows="2" placeholder="Authorization=Bearer your-token" bind:value={draft.headers}
      ></textarea>
    </label>
    <label>
      Bearer token env var (optional, not stored)
      <input type="text" placeholder="MY_API_TOKEN" bind:value={draft.bearerTokenEnvVar} />
    </label>
    <label>
      OAuth client id (optional)
      <input type="text" placeholder="client-id" bind:value={draft.oauthClientId} />
    </label>
    <label>
      OAuth client secret (optional)
      <input type="password" placeholder="client-secret" bind:value={draft.oauthClientSecret} />
    </label>
  {/if}

  <label>
    Description
    <input
      type="text"
      placeholder="What this server offers, in one sentence"
      bind:value={draft.description}
    />
  </label>
  {#if formError}
    <div class="form-error">{formError}</div>
  {/if}
  <div class="form-actions">
    <span class="form-hint">{EXPOSURE_HELP[draft.exposure]}</span>
    <button class="add-btn" type="submit" disabled={busy}>
      {busy ? "Adding…" : "Add server"}
    </button>
  </div>
</form>

<style>
  .add-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    flex-shrink: 0;
    max-height: 55vh;
    overflow-y: auto;
  }

  .form-row.two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
  }

  input,
  select,
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-size: var(--text-sm);
  }

  textarea {
    resize: vertical;
    font-family: var(--font-mono);
  }

  .form-error {
    color: var(--color-error, #e5534b);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .form-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .form-hint {
    color: var(--color-text-muted);
    font-size: 10px;
    line-height: 1.35;
  }

  .add-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--color-primary);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    color: var(--color-text-inverse);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
