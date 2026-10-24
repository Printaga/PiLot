import { asArray, asString } from "./messages";

export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";
export type McpScope = "global" | "project" | "extension";

export interface McpServer {
  name: string;
  scope: McpScope;
  source: string;
  override?: string;
  enabled: boolean;
  exposure: McpExposure;
  transport: string;
  description: string;
  state: string;
  tools: string[];
  toolExposure?: Record<string, McpExposure>;
  resources?: boolean;
  error?: string;
}

export interface McpFiles {
  global: string;
  project: string;
  projectExists: boolean;
  projectTrusted: boolean;
}

export interface McpAddDraft {
  name: string;
  local: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  headers: string;
  bearerTokenEnvVar: string;
  oauthClientId: string;
  oauthClientSecret: string;
  description: string;
  exposure: McpExposure;
}

export interface McpAddRequest {
  name: string;
  local: boolean;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  bearerTokenEnvVar?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  description?: string;
  exposure: McpExposure;
}

export const EXPOSURES: McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

export const EXPOSURE_HELP: Record<McpExposure, string> = {
  codemode: "Callable from codemode scripts; hidden from the tool list",
  deferred: "Loaded by tool_search when the model needs it",
  direct: "Declared to the model like a built-in tool",
  hidden: "Registered but unreachable",
};

const STATE_LABELS: Record<string, string> = {
  "needs-auth": "needs sign-in",
  connected: "connected",
  connecting: "connecting",
  disconnected: "disconnected",
  closed: "closed",
  failed: "failed",
};

const STATE_CLASSES: Record<string, string> = {
  connected: "state-ok",
  "needs-auth": "state-warn",
  connecting: "state-warn",
  failed: "state-error",
  disconnected: "state-error",
  closed: "state-error",
};

function normalizeExposure(value: unknown): McpExposure {
  return typeof value === "string" && EXPOSURES.includes(value as McpExposure)
    ? (value as McpExposure)
    : "codemode";
}

function normalizeScope(value: unknown): McpScope {
  if (value === "project") return "project";
  if (value === "extension") return "extension";
  return "global";
}

function optionalOverride(raw: McpServer): Pick<McpServer, "override"> | object {
  return typeof raw.override === "string" ? { override: raw.override } : {};
}

function optionalToolExposure(raw: McpServer): Pick<McpServer, "toolExposure"> | object {
  return raw.toolExposure && typeof raw.toolExposure === "object"
    ? { toolExposure: raw.toolExposure }
    : {};
}

function optionalResources(raw: McpServer): Pick<McpServer, "resources"> | object {
  return raw.resources === true ? { resources: true } : {};
}

function optionalError(raw: McpServer): Pick<McpServer, "error"> | object {
  return typeof raw.error === "string" ? { error: raw.error } : {};
}

export function normalizeServer(raw: McpServer): McpServer {
  return {
    name: asString(raw.name),
    scope: normalizeScope(raw.scope),
    source: asString(raw.source),
    enabled: raw.enabled !== false,
    exposure: normalizeExposure(raw.exposure),
    transport: asString(raw.transport),
    description: asString(raw.description),
    state: asString(raw.state, "unknown"),
    tools: asArray<string>(raw.tools, (value): value is string => typeof value === "string"),
    ...optionalOverride(raw),
    ...optionalToolExposure(raw),
    ...optionalResources(raw),
    ...optionalError(raw),
  };
}

export function stateLabel(server: McpServer): string {
  if (!server.enabled) return "disabled";
  return STATE_LABELS[server.state] ?? "not checked";
}

export function stateClass(server: McpServer): string {
  if (server.error) return "state-error";
  if (!server.enabled) return "state-disabled";
  return STATE_CLASSES[server.state] ?? "state-idle";
}

export function scopeLabel(server: McpServer): string {
  if (server.scope === "project") return "project";
  if (server.scope === "extension") return "extension";
  return server.override ? "user + project override" : "user";
}

export function ageLabel(checkedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 10) return "Checked just now";
  if (seconds < 60) return `Checked ${seconds}s ago`;
  return `Checked ${Math.round(seconds / 60)}m ago`;
}

export function filesFromPayload(raw: unknown): McpFiles {
  const files = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    global: asString(files.global),
    project: asString(files.project),
    projectExists: files.projectExists === true,
    projectTrusted: files.projectTrusted === true,
  };
}
