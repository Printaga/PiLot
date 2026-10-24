// ── MCP server management ────────────────────────────────────────────────────
//
// PI reads user servers from `~/.pi/agent/mcp.json` and project servers from
// `<workspace>/.pi/mcp.json` (only when the project is trusted). This service
// lists and validates those files for the panel and delegates operations that
// have a CLI implementation (`list --json`, add, remove, login, logout) to PI so
// PiLot stays aligned with the CLI's schema and OAuth handling.

import * as fs from "node:fs";
import * as path from "node:path";
import { type BinaryService } from "./binary-service.js";
import { type CommandResult, execFileAsync, quoteShellArg, stripAnsi } from "./utils/shell.js";
import type {
	McpAddInput,
	McpConfigPatch,
	McpExposure,
	McpFilesInfo,
	McpListPayload,
	McpScope,
	McpServerInfo,
	CodemodeSource,
} from "./protocol/types.js";

export interface McpManagerDeps {
	agentDir: string;
	getCwd: () => string;
	isProjectTrusted: () => boolean;
	binaryService: BinaryService;
	notifyWebview: (message: { type: string; data?: unknown }) => void;
	logDebug: (msg: string, ...details: unknown[]) => void;
	logError: (msg: string, error?: unknown) => void;
	/** Injectable command runner; defaults to the PI binary with quoted argv. */
	runCli?: (args: string[], timeoutMs: number) => Promise<CommandResult>;
}

const mcpManagerInternals = {
	existsFile: (file: string) => fs.existsSync(file),
	readFile: (file: string) => fs.readFileSync(file, "utf8"),
	writeFile: (file: string, data: string) => fs.writeFileSync(file, data),
	mkdir: (dir: string) => fs.mkdirSync(dir, { recursive: true }),
};

const EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const OVERRIDE_KEYS = new Set(["enabled", "exposure", "toolExposure"]);

type RawServerConfig = Record<string, unknown>;
interface ConfigEntry {
	name: string;
	config: RawServerConfig;
	source: string;
	scope: McpScope;
	override?: string;
}

interface LoadedConfig {
	servers: ConfigEntry[];
	errors: string[];
	autoEnableCodemode?: boolean;
	autoEnableCodemodeSource?: CodemodeSource;
	files: McpFilesInfo;
	note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") return undefined;
		out[key] = item;
	}
	return out;
}

/** Whether a project entry only overrides a global server instead of defining one. */
function isOverride(value: RawServerConfig): boolean {
	return value.command === undefined && value.url === undefined && value.type === undefined;
}

function exposureOf(value: unknown): McpExposure {
	return typeof value === "string" && EXPOSURES.includes(value as McpExposure)
		? (value as McpExposure)
		: "codemode";
}

function describeTransport(config: RawServerConfig): string {
	if (typeof config.url === "string") return config.url;
	const command = typeof config.command === "string" ? config.command : "";
	const args = asStringArray(config.args);
	return [command, ...args].filter(Boolean).join(" ");
}

/**
 * Validate the fields PiLot displays and passes back to the CLI. PI validates the
 * full schema again; this catches broken files early so one bad entry does not
 * hide the rest of the list.
 */
function validateType(name: string, config: RawServerConfig): string | undefined {
	if (config.type === undefined) return undefined;
	if (config.type !== "stdio" && config.type !== "http" && config.type !== "streamable-http") {
		return `server "${name}" has invalid type ${JSON.stringify(config.type)}`;
	}
	if (config.type === "streamable-http") config.type = "http";
	return undefined;
}

function validateTransport(name: string, config: RawServerConfig): string | undefined {
	const hasCommand = typeof config.command === "string" && config.command.length > 0;
	const hasUrl = typeof config.url === "string" && config.url.length > 0;
	if (!hasCommand && !hasUrl) return `server "${name}" needs "command" or "url"`;
	if (hasCommand && hasUrl) return `server "${name}" cannot define both "command" and "url"`;
	return undefined;
}

interface FieldRule {
	key: string;
	valid: (value: unknown) => boolean;
	message: string;
}

const FIELD_RULES: readonly FieldRule[] = [
	{
		key: "args",
		valid: (value) => Array.isArray(value),
		message: '"args" must be an array',
	},
	{
		key: "env",
		valid: (value) => asStringRecord(value) !== undefined,
		message: '"env" must be an object of strings',
	},
	{
		key: "headers",
		valid: (value) => asStringRecord(value) !== undefined,
		message: '"headers" must be an object of strings',
	},
	{
		key: "enabled",
		valid: (value) => typeof value === "boolean",
		message: '"enabled" must be a boolean',
	},
	{
		key: "description",
		valid: (value) => typeof value === "string",
		message: '"description" must be a string',
	},
	{
		key: "timeout",
		valid: (value) => typeof value === "number",
		message: '"timeout" must be a number',
	},
];

function validateFields(name: string, config: RawServerConfig): string | undefined {
	for (const rule of FIELD_RULES) {
		const value = config[rule.key];
		if (value === undefined || rule.valid(value)) continue;
		return `server "${name}": ${rule.message}`;
	}
	if (config.exposure === undefined || EXPOSURES.includes(config.exposure as McpExposure)) {
		return undefined;
	}
	return `server "${name}": invalid exposure ${JSON.stringify(config.exposure)}`;
}

function validateEntry(name: string, value: unknown): { config: RawServerConfig } | string {
	if (!SERVER_NAME.test(name)) {
		return `server name "${name}" may contain only letters, digits, "_" and "-"`;
	}
	if (!isRecord(value)) return `server "${name}" must be an object`;

	const config: RawServerConfig = { ...value };
	const invalidType = validateType(name, config);
	if (invalidType) return invalidType;
	const invalidTransport = validateTransport(name, config);
	if (invalidTransport) return invalidTransport;
	const invalidField = validateFields(name, config);
	if (invalidField) return invalidField;
	return { config };
}

function applyOverride(
	file: string,
	name: string,
	value: RawServerConfig,
	servers: Map<string, ConfigEntry>,
	state: { errors: string[] },
): void {
	const base = servers.get(name);
	if (!base) {
		state.errors.push(
			`${file}: server "${name}" needs "command" or "url", or a global server to override`,
		);
		return;
	}
	const extra = Object.keys(value).filter((key) => !OVERRIDE_KEYS.has(key));
	if (extra.length > 0) {
		state.errors.push(
			`${file}: server "${name}": an override can only set ${[...OVERRIDE_KEYS].join(", ")}`,
		);
		return;
	}
	if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
		state.errors.push(`${file}: server "${name}": "enabled" must be a boolean`);
		return;
	}
	if (value.exposure !== undefined && !EXPOSURES.includes(value.exposure as McpExposure)) {
		state.errors.push(
			`${file}: server "${name}": invalid exposure ${JSON.stringify(value.exposure)}`,
		);
		return;
	}
	servers.set(name, { ...base, config: { ...base.config, ...value }, override: file });
}

function applyServerEntry(
	file: string,
	scope: McpScope,
	name: string,
	value: RawServerConfig,
	servers: Map<string, ConfigEntry>,
	state: { errors: string[] },
): void {
	const validated = validateEntry(name, value);
	if (typeof validated === "string") {
		state.errors.push(`${file}: ${validated}`);
		return;
	}
	servers.set(name, { name, config: validated.config, source: file, scope });
}

function readParsedConfig(
	file: string,
	scope: "global" | "project",
	state: {
		errors: string[];
		autoEnableCodemode?: boolean;
		autoEnableCodemodeSource?: CodemodeSource;
	},
): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(mcpManagerInternals.readFile(file).replace(/^\uFEFF/, ""));
	} catch (error) {
		state.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
	if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
		state.errors.push(`${file}: expected an object with an "mcpServers" object`);
		return undefined;
	}
	if (typeof parsed.autoEnableCodemode === "boolean") {
		state.autoEnableCodemode = parsed.autoEnableCodemode;
		state.autoEnableCodemodeSource = scope;
	} else if (parsed.autoEnableCodemode !== undefined) {
		state.errors.push(`${file}: autoEnableCodemode must be a boolean`);
	}
	return parsed;
}

function readConfigFile(
	file: string,
	scope: "global" | "project",
	servers: Map<string, ConfigEntry>,
	state: {
		errors: string[];
		autoEnableCodemode?: boolean;
		autoEnableCodemodeSource?: CodemodeSource;
	},
): void {
	if (!mcpManagerInternals.existsFile(file)) return;
	const parsed = readParsedConfig(file, scope, state);
	if (!parsed) return;

	for (const [name, value] of Object.entries(parsed.mcpServers ?? {})) {
		if (!isRecord(value)) {
			state.errors.push(`${file}: server "${name}" must be an object`);
			continue;
		}
		if (scope === "project" && isOverride(value)) {
			applyOverride(file, name, value, servers, state);
			continue;
		}
		applyServerEntry(file, scope, name, value, servers, state);
	}
}

function serverFromEntry(entry: ConfigEntry): McpServerInfo {
	const transport = describeTransport(entry.config);
	return {
		name: entry.name,
		scope: entry.scope,
		source: entry.source,
		...(entry.override ? { override: entry.override } : {}),
		enabled: entry.config.enabled !== false,
		exposure: exposureOf(entry.config.exposure),
		transport,
		description: asString(entry.config.description),
		state: entry.config.enabled === false ? "disabled" : "unknown",
		tools: [],
	};
}

/** Extract the JSON object from CLI output that may carry a leading note. */
function parseListJson(stdout: string): unknown {
	const text = stripAnsi(stdout).trim();
	if (!text) return undefined;
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function cliFailure(result: CommandResult): string {
	return (result.stderr || result.stdout || "").trim() || `pi exited with status ${result.code}`;
}

interface ConfigDocument {
	parsed: Record<string, unknown>;
	servers: Record<string, unknown>;
	text?: string;
}

function readConfigDocument(file: string): ConfigDocument {
	const text = mcpManagerInternals.existsFile(file)
		? mcpManagerInternals.readFile(file).replace(/^\uFEFF/, "")
		: undefined;
	let parsed: unknown = {};
	if (text?.trim()) {
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new Error(`${file}: ${errorMessage(error)}`, { cause: error });
		}
	}
	if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
		throw new Error(`${file}: expected an object with an "mcpServers" object`);
	}
	const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
	return { parsed, servers, ...(text !== undefined ? { text } : {}) };
}

function editableServer(
	document: ConfigDocument,
	file: string,
	name: string,
	addOverride: boolean,
): RawServerConfig {
	const existing = document.servers[name];
	if (isRecord(existing)) return existing;
	if (!addOverride) throw new Error(`${file} does not define MCP server "${name}"`);
	const server: RawServerConfig = {};
	document.servers[name] = server;
	document.parsed.mcpServers = document.servers;
	return server;
}

function applyConfigPatch(
	server: RawServerConfig,
	patch: McpConfigPatch,
	keepDefaults: boolean,
): void {
	if (patch.enabled !== undefined) {
		if (patch.enabled && !keepDefaults) delete server.enabled;
		else server.enabled = patch.enabled;
	}
	if (patch.exposure !== undefined) {
		if (patch.exposure === "codemode" && !keepDefaults) delete server.exposure;
		else server.exposure = patch.exposure;
	}
}

function writeConfigDocument(file: string, document: ConfigDocument): void {
	const indent = (document.text && /^([ \t]+)\S/m.exec(document.text)?.[1]) || "  ";
	mcpManagerInternals.mkdir(path.dirname(file));
	mcpManagerInternals.writeFile(file, `${JSON.stringify(document.parsed, null, indent)}\n`);
}

function buildAddArgs(input: McpAddInput, name: string): string[] {
	const args = ["mcp", "add", name];
	if (input.local) args.push("--local");
	if (input.exposure) args.push("--exposure", input.exposure);
	if (input.description?.trim()) args.push("--description", input.description.trim());
	if (input.transport === "stdio") appendStdioArgs(args, input);
	else appendHttpArgs(args, input);
	return args;
}

function appendStdioArgs(args: string[], input: McpAddInput): void {
	for (const [key, value] of Object.entries(input.env ?? {})) {
		if (key.trim()) args.push("--env", `${key}=${value}`);
	}
	if (input.cwd?.trim()) args.push("--cwd", input.cwd.trim());
	args.push("--", input.command!.trim());
	args.push(...(input.args ?? []));
}

function appendHttpArgs(args: string[], input: McpAddInput): void {
	args.push("--url", input.url!.trim());
	for (const [key, value] of Object.entries(input.headers ?? {})) {
		if (key.trim()) args.push("--header", `${key}=${value}`);
	}
	if (input.bearerTokenEnvVar?.trim())
		args.push("--bearer-token-env-var", input.bearerTokenEnvVar.trim());
	if (input.oauthClientId?.trim()) args.push("--oauth-client-id", input.oauthClientId.trim());
	if (input.oauthClientSecret?.trim())
		args.push("--oauth-client-secret", input.oauthClientSecret.trim());
}

/** Scope reported by the CLI, mapped onto the scopes the panel renders. */
function reportScope(report: Record<string, unknown>): McpScope {
	const scope = asString(report.scope);
	if (scope === "project") return "project";
	if (scope === "extension") return "extension";
	return "global";
}

/** Servers known only to the live runtime, such as extension-provided ones. */
function reportsFromUnknownServers(reports: Map<string, Record<string, unknown>>): McpServerInfo[] {
	const servers: McpServerInfo[] = [];
	for (const report of reports.values()) {
		if (typeof report.name !== "string") continue;
		servers.push({
			name: report.name,
			scope: reportScope(report),
			source: asString(report.source),
			enabled: report.enabled !== false,
			exposure: exposureOf(report.exposure),
			transport: asString(report.transport),
			description: "",
			state: asString(report.state) || "unknown",
			tools: asStringArray(report.tools),
			...(isRecord(report.toolExposure)
				? { toolExposure: report.toolExposure as Record<string, McpExposure> }
				: {}),
			...(report.resources === true ? { resources: true } : {}),
			...(typeof report.error === "string" ? { error: report.error } : {}),
		});
	}
	return servers;
}

export class McpManager {
	constructor(private readonly deps: McpManagerDeps) {}

	/** Configured servers, without opening connections (fast, works offline). */
	list(): McpListPayload {
		return this.configuredPayload(this.loadConfig());
	}

	/** Effective top-level `autoEnableCodemode` and the file that supplied it. */
	getAutoEnableCodemodeInfo(): { value: boolean; source: CodemodeSource } {
		const loaded = this.loadConfig();
		return {
			value: loaded.autoEnableCodemode ?? true,
			source: loaded.autoEnableCodemodeSource ?? "default",
		};
	}

	/** Set `autoEnableCodemode` in the main user mcp.json. */
	setAutoEnableCodemode(enabled: boolean): void {
		const file = path.join(this.deps.agentDir, "mcp.json");
		const existed = mcpManagerInternals.existsFile(file);
		if (!enabled || existed) {
			const document = readConfigDocument(file);
			if (enabled) delete document.parsed.autoEnableCodemode;
			else document.parsed.autoEnableCodemode = false;
			// Keep the file a valid mcp.json: disabling with no existing file (or a
			// file without the key) must not produce a config lacking `mcpServers`.
			if (!isRecord(document.parsed.mcpServers)) {
				document.parsed.mcpServers = document.servers;
			}
			writeConfigDocument(file, document);
		}
		this.invalidate();
	}

	/**
	 * List servers through `pi mcp list --json`, which connects every enabled
	 * server and reports state, tools and per-server errors. The config files
	 * remain the source for descriptions and override details.
	 */
	async check(): Promise<McpListPayload> {
		const base = this.configuredPayload(this.loadConfig());

		let result: CommandResult;
		try {
			result = await this.runCli(["mcp", "list", "--json"], 30_000);
		} catch (error) {
			return { ...base, checkError: errorMessage(error), checkedAt: Date.now() };
		}

		const parsed = parseListJson(result.stdout);
		if (!isRecord(parsed)) {
			this.deps.logError("[PI] Could not parse `pi mcp list --json`", result.stderr);
			return { ...base, checkError: cliFailure(result), checkedAt: Date.now() };
		}

		const reports = this.reportsFromCli(parsed);
		const servers = base.servers.map((server) => this.applyReport(server, reports));
		// Servers registered by an extension only exist in a live runtime, but a
		// report without a config entry is still worth showing.
		servers.push(...reportsFromUnknownServers(reports));
		this.appendCliMessages(base, parsed);

		return {
			...base,
			servers: servers.sort((a, b) => a.name.localeCompare(b.name)),
			checkedAt: Date.now(),
		};
	}

	/** Add or replace a server with `pi mcp add`. */
	async add(input: McpAddInput): Promise<void> {
		const name = this.validateAddInput(input);
		const args = buildAddArgs(input, name);
		const result = await this.runCli(args, 60_000);
		if (result.code !== 0) throw new Error(cliFailure(result));
		this.invalidate();
	}

	/** Remove a server from the global or project file. */
	async remove(name: string, scope: "global" | "project"): Promise<void> {
		if (!SERVER_NAME.test(name)) throw new Error(`Invalid server name: ${name}`);
		const entry = this.loadConfig().servers.find((server) => server.name === name); // A global server can have a project override. Remove that first: deleting
		// only the global entry would leave a dangling override that the next
		// config load reports as an error. The override is invisible to loadConfig
		// when the project is untrusted, so check the project file directly too.
		if (scope === "global" && (entry?.override || this.hasProjectOverride(name))) {
			const overrideResult = await this.runCli(["mcp", "remove", name, "--local"], 30_000);
			if (overrideResult.code !== 0) throw new Error(cliFailure(overrideResult));
		}

		const args = ["mcp", "remove", name];
		if (scope === "project") args.push("--local");
		const result = await this.runCli(args, 30_000);
		if (result.code !== 0) throw new Error(cliFailure(result));
		this.invalidate();
	} /**
	 * Whether the project file holds an override entry for `name`, even when the
	 * project is untrusted (and therefore invisible to loadConfig). Only true
	 * overrides count: a full project server with the same name is independent
	 * and must survive a global removal.
	 */
	private hasProjectOverride(name: string): boolean {
		try {
			const file = path.join(this.deps.getCwd(), ".pi", "mcp.json");
			if (!mcpManagerInternals.existsFile(file)) return false;
			const document = readConfigDocument(file);
			const value = document.servers[name];
			return isRecord(value) && isOverride(value);
		} catch {
			return false;
		}
	}

	/**
	 * Change enabled/exposure in the file that defines the server, or add a
	 * project override for a global server.
	 */
	async updateConfig(
		name: string,
		patch: McpConfigPatch,
		scope?: "global" | "project",
	): Promise<void> {
		const loaded = this.loadConfig();
		const entry = loaded.servers.find((server) => server.name === name);
		if (!entry) throw new Error(`No MCP server named "${name}"`);

		const useProject = scope === "project" || entry.scope === "project";
		const target = useProject
			? entry.scope === "project"
				? entry.source
				: loaded.files.project
			: (entry.override ?? entry.source);
		// A project override for a global server starts as an empty entry.
		const addOverride = useProject && entry.scope === "global";

		this.editServer(target, name, patch, addOverride);
		this.invalidate();
	}

	/** Sign in to an OAuth MCP server; PI opens the authorization page. */
	async login(name: string): Promise<void> {
		if (!SERVER_NAME.test(name)) throw new Error(`Invalid server name: ${name}`);
		const result = await this.runCli(["mcp", "login", name, "--timeout", "300"], 320_000);
		if (result.code !== 0) throw new Error(cliFailure(result));
		this.invalidate();
	}

	/** Delete the stored OAuth credentials for an MCP server. */
	async logout(name: string): Promise<void> {
		if (!SERVER_NAME.test(name)) throw new Error(`Invalid server name: ${name}`);
		const result = await this.runCli(["mcp", "logout", name], 30_000);
		if (result.code !== 0) throw new Error(cliFailure(result));
		this.invalidate();
	}

	/** Tell an open panel that a mutation changed the config. */
	invalidate(): void {
		this.deps.notifyWebview({ type: "mcp-servers-updated" });
	}

	private configuredPayload(loaded: LoadedConfig): McpListPayload {
		return {
			servers: loaded.servers
				.map(serverFromEntry)
				.sort((a, b) => a.name.localeCompare(b.name)),
			errors: loaded.errors,
			files: loaded.files,
			...(loaded.note ? { note: loaded.note } : {}),
		};
	}
	private validateAddInput(input: McpAddInput): string {
		const name = input.name?.trim();
		if (!name || !SERVER_NAME.test(name)) {
			throw new Error('Server name may contain only letters, digits, "_" and "-".');
		}
		if (input.transport === "stdio" && !input.command?.trim()) {
			throw new Error("A stdio server needs a command.");
		}
		if (input.transport === "http" && !input.url?.trim()) {
			throw new Error("An HTTP server needs a URL.");
		}
		if (input.exposure !== undefined && !EXPOSURES.includes(input.exposure as McpExposure)) {
			throw new Error(`Invalid MCP exposure: ${String(input.exposure)}`);
		}
		if (input.args !== undefined) {
			if (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) {
				throw new Error('"args" must be an array of strings');
			}
		}
		for (const [label, value] of [
			["env", input.env],
			["headers", input.headers],
		] as const) {
			if (value !== undefined && asStringRecord(value) === undefined) {
				throw new Error(`"${label}" must be an object of strings`);
			}
		}
		if (
			input.bearerTokenEnvVar?.trim() &&
			!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.bearerTokenEnvVar.trim())
		) {
			throw new Error("Bearer token env var must be a valid environment variable name.");
		}
		return name;
	}

	private reportsFromCli(parsed: Record<string, unknown>): Map<string, Record<string, unknown>> {
		const reports = new Map<string, Record<string, unknown>>();
		for (const report of Array.isArray(parsed.servers) ? parsed.servers : []) {
			if (!isRecord(report) || typeof report.name !== "string") continue;
			reports.set(report.name, report);
		}
		return reports;
	}

	private applyReport(
		server: McpServerInfo,
		reports: Map<string, Record<string, unknown>>,
	): McpServerInfo {
		const report = reports.get(server.name);
		if (!report) return { ...server, state: server.enabled ? server.state : "disabled" };
		reports.delete(server.name);
		return this.mergeReport(server, report);
	}

	private appendCliMessages(base: McpListPayload, parsed: Record<string, unknown>): void {
		for (const error of Array.isArray(parsed.errors) ? parsed.errors : []) {
			if (typeof error === "string") base.errors.push(error);
		}
		if (typeof parsed.note === "string" && !base.note) base.note = parsed.note;
	}

	private mergeReport(server: McpServerInfo, report: Record<string, unknown>): McpServerInfo {
		return {
			...server,
			enabled: report.enabled !== false,
			exposure: exposureOf(report.exposure ?? server.exposure),
			transport: asString(report.transport) || server.transport,
			state: asString(report.state) || (report.enabled === false ? "disabled" : "unknown"),
			tools: asStringArray(report.tools),
			...(isRecord(report.toolExposure)
				? { toolExposure: report.toolExposure as Record<string, McpExposure> }
				: {}),
			...(report.resources === true ? { resources: true } : {}),
			...(typeof report.error === "string" ? { error: report.error } : {}),
		};
	}

	private loadConfig(): LoadedConfig {
		const files: McpFilesInfo = {
			global: path.join(this.deps.agentDir, "mcp.json"),
			project: path.join(this.deps.getCwd(), ".pi", "mcp.json"),
			projectExists: false,
			projectTrusted: false,
		};
		const servers = new Map<string, ConfigEntry>();
		const state: {
			errors: string[];
			autoEnableCodemode?: boolean;
			autoEnableCodemodeSource?: CodemodeSource;
		} = { errors: [] };

		readConfigFile(files.global, "global", servers, state);
		try {
			files.projectExists = mcpManagerInternals.existsFile(files.project);
		} catch {
			files.projectExists = false;
		}
		try {
			files.projectTrusted = this.deps.isProjectTrusted();
		} catch (error) {
			this.deps.logError("[PI] Could not read project trust state", error);
			files.projectTrusted = false;
		}
		if (files.projectTrusted) {
			readConfigFile(files.project, "project", servers, state);
		}

		const note =
			!files.projectTrusted && files.projectExists
				? `${files.project} is ignored because this project is not trusted.`
				: undefined;

		return {
			servers: [...servers.values()],
			errors: state.errors,
			...(state.autoEnableCodemode === undefined
				? {}
				: { autoEnableCodemode: state.autoEnableCodemode }),
			...(state.autoEnableCodemodeSource === undefined
				? {}
				: { autoEnableCodemodeSource: state.autoEnableCodemodeSource }),
			files,
			...(note ? { note } : {}),
		};
	}

	private editServer(
		file: string,
		name: string,
		patch: McpConfigPatch,
		addOverride: boolean,
	): void {
		const document = readConfigDocument(file);
		const server = editableServer(document, file, name, addOverride);
		applyConfigPatch(server, patch, isOverride(server));
		writeConfigDocument(file, document);
	}

	private async runCli(args: string[], timeoutMs: number): Promise<CommandResult> {
		if (this.deps.runCli) return this.deps.runCli(args, timeoutMs);
		const binary = this.deps.binaryService.getBinaryPath();
		const quoted: string[] = [];
		for (const arg of args) {
			const value = quoteShellArg(arg);
			if (value === null) {
				throw new Error(
					"This value cannot be passed to the PI CLI safely on Windows (it contains a character cmd.exe interprets).",
				);
			}
			quoted.push(value);
		}
		return execFileAsync(binary, quoted, timeoutMs, { cwd: this.deps.getCwd() });
	}
}
