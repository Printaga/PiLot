import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpManager } from "../../../mcp-manager.js";
import type { CommandResult } from "../../../utils/shell.js";

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file: string): any {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createManager(opts?: {
	trusted?: boolean;
	run?: (args: string[], timeoutMs: number) => Promise<CommandResult>;
}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-mcp-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });

	const calls: Array<{ args: string[]; timeoutMs: number }> = [];
	const notifications: Array<{ type: string; data?: unknown }> = [];
	const errors: unknown[][] = [];
	let trusted = opts?.trusted ?? true;
	const run =
		opts?.run ?? (async () => ({ code: 0, stdout: "", stderr: "" }) satisfies CommandResult);

	const manager = new McpManager({
		agentDir,
		getCwd: () => cwd,
		isProjectTrusted: () => trusted,
		binaryService: { getBinaryPath: () => "pi" } as any,
		notifyWebview: (message) => notifications.push(message),
		logDebug: () => {},
		logError: (...args) => errors.push(args),
		runCli: async (args, timeoutMs) => {
			calls.push({ args, timeoutMs });
			return run(args, timeoutMs);
		},
	});

	return {
		root,
		agentDir,
		cwd,
		manager,
		calls,
		notifications,
		errors,
		setTrusted: (value: boolean) => {
			trusted = value;
		},
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

suite("McpManager: config listing", () => {
	test("merges global servers with a trusted project and applies overrides", () => {
		const ctx = createManager();
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: {
					filesystem: {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
						description: "Local files",
					},
					github: { command: "github-mcp", enabled: false, exposure: "deferred" },
				},
			});
			writeJson(path.join(ctx.cwd, ".pi", "mcp.json"), {
				mcpServers: {
					github: { enabled: true, exposure: "direct" },
					local: { url: "https://example.test/mcp" },
				},
			});

			const result = ctx.manager.list();
			assert.deepStrictEqual(
				result.servers.map((s) => s.name),
				["filesystem", "github", "local"],
			);
			const filesystem = result.servers[0];
			assert.strictEqual(filesystem.scope, "global");
			assert.strictEqual(filesystem.description, "Local files");
			assert.strictEqual(
				filesystem.transport,
				"npx -y @modelcontextprotocol/server-filesystem .",
			);
			assert.strictEqual(filesystem.state, "unknown");

			const github = result.servers[1];
			assert.strictEqual(github.scope, "global");
			assert.strictEqual(github.enabled, true);
			assert.strictEqual(github.exposure, "direct");
			assert.strictEqual(github.override, path.join(ctx.cwd, ".pi", "mcp.json"));
			assert.strictEqual(github.source, path.join(ctx.agentDir, "mcp.json"));

			const local = result.servers[2];
			assert.strictEqual(local.scope, "project");
			assert.strictEqual(local.transport, "https://example.test/mcp");
			assert.strictEqual(result.files.projectTrusted, true);
			assert.strictEqual(result.note, undefined);
		} finally {
			ctx.cleanup();
		}
	});

	test("ignores the project file and explains why when the project is untrusted", () => {
		const ctx = createManager({ trusted: false });
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { global: { command: "x" } },
			});
			writeJson(path.join(ctx.cwd, ".pi", "mcp.json"), {
				mcpServers: { project: { command: "y" } },
			});

			const result = ctx.manager.list();
			assert.deepStrictEqual(
				result.servers.map((s) => s.name),
				["global"],
			);
			assert.strictEqual(result.files.projectExists, true);
			assert.strictEqual(result.files.projectTrusted, false);
			assert.match(result.note ?? "", /not trusted/);

			ctx.setTrusted(true);
			assert.strictEqual(ctx.manager.list().servers.length, 2);
		} finally {
			ctx.cleanup();
		}
	});

	test("reports broken JSON and invalid entries without hiding valid servers", () => {
		const ctx = createManager();
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: {
					good: { command: "run" },
					missing: { description: "no command" },
					"bad name": { command: "x" },
					enabledWrong: { command: "x", enabled: "yes" },
				},
			});
			fs.mkdirSync(path.join(ctx.cwd, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(ctx.cwd, ".pi", "mcp.json"), "{not json");

			const result = ctx.manager.list();
			assert.deepStrictEqual(
				result.servers.map((s) => s.name),
				["good"],
			);
			assert.ok(
				result.errors.some((e) => e.includes('server "missing" needs "command" or "url"')),
			);
			assert.ok(result.errors.some((e) => e.includes("bad name")));
			assert.ok(result.errors.some((e) => e.includes("enabled")));
			assert.ok(result.errors.some((e) => e.includes("not json") || e.includes("JSON")));
		} finally {
			ctx.cleanup();
		}
	});

	test("normalizes legacy streamable-http type and defaults exposure", () => {
		const ctx = createManager();
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: {
					remote: { type: "streamable-http", url: "https://example.test/mcp" },
				},
			});
			const server = ctx.manager.list().servers[0];
			assert.strictEqual(server.exposure, "codemode");
			assert.strictEqual(server.enabled, true);
			assert.strictEqual(server.transport, "https://example.test/mcp");
		} finally {
			ctx.cleanup();
		}
	});
});

suite("McpManager: connection check", () => {
	test("merges pi mcp list --json state and tools, even when it exits 1", async () => {
		const ctx = createManager({
			run: async () => ({
				code: 1,
				stdout: JSON.stringify({
					servers: [
						{
							name: "filesystem",
							scope: "global",
							source: "/tmp/agent/mcp.json",
							enabled: true,
							exposure: "codemode",
							transport: "npx fs",
							state: "connected",
							tools: ["read_file", "write_file"],
							resources: true,
						},
						{
							name: "github",
							scope: "global",
							enabled: false,
							exposure: "direct",
							transport: "github-mcp",
							state: "disabled",
							tools: [],
						},
					],
					errors: [],
				}),
				stderr: "non-fatal warning",
			}),
		});
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: {
					filesystem: { command: "npx", args: ["fs"], description: "Files" },
					github: { command: "github-mcp" },
				},
			});

			const result = await ctx.manager.check();
			assert.strictEqual(result.checkError, undefined);
			assert.ok(result.checkedAt);
			const filesystem = result.servers[0];
			assert.strictEqual(filesystem.state, "connected");
			assert.deepStrictEqual(filesystem.tools, ["read_file", "write_file"]);
			assert.strictEqual(filesystem.resources, true);
			assert.strictEqual(filesystem.description, "Files");
			assert.strictEqual(result.servers[1].state, "disabled");
			assert.strictEqual(ctx.calls[0].args[1], "list");
			assert.strictEqual(ctx.calls[0].args[2], "--json");
		} finally {
			ctx.cleanup();
		}
	});

	test("reports a checkError when the CLI output is not JSON", async () => {
		const ctx = createManager({
			run: async () => ({ code: 1, stdout: "boom", stderr: "pi: command failed" }),
		});
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { server: { command: "run" } },
			});
			const result = await ctx.manager.check();
			assert.strictEqual(result.servers.length, 1);
			assert.match(result.checkError ?? "", /pi: command failed/);
		} finally {
			ctx.cleanup();
		}
	});

	test("reports a checkError when the CLI runner throws", async () => {
		const ctx = createManager({
			run: async () => {
				throw new Error("spawn ENOENT");
			},
		});
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { server: { command: "run" } },
			});
			const result = await ctx.manager.check();
			assert.match(result.checkError ?? "", /ENOENT/);
			assert.strictEqual(result.servers[0].state, "unknown");
		} finally {
			ctx.cleanup();
		}
	});
});

suite("McpManager: mutations", () => {
	test("add builds stdio CLI arguments with local, env, description and exposure", async () => {
		const ctx = createManager();
		try {
			await ctx.manager.add({
				name: "filesystem",
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
				cwd: "/tmp/work",
				env: { API_KEY: "secret" },
				description: "Local files",
				exposure: "direct",
				local: true,
			});
			assert.deepStrictEqual(ctx.calls[0].args, [
				"mcp",
				"add",
				"filesystem",
				"--local",
				"--exposure",
				"direct",
				"--description",
				"Local files",
				"--env",
				"API_KEY=secret",
				"--cwd",
				"/tmp/work",
				"--",
				"npx",
				"-y",
				"@modelcontextprotocol/server-filesystem",
				".",
			]);
			assert.ok(ctx.notifications.some((m) => m.type === "mcp-servers-updated"));
		} finally {
			ctx.cleanup();
		}
	});

	test("add builds HTTP arguments and rejects invalid input before running", async () => {
		const ctx = createManager();
		try {
			await ctx.manager.add({
				name: "docs",
				transport: "http",
				url: "https://example.test/mcp",
				headers: { Authorization: "Bearer token" },
				bearerTokenEnvVar: "DOCS_TOKEN",
				oauthClientId: "client-id",
				oauthClientSecret: "client-secret",
			});
			assert.deepStrictEqual(ctx.calls[0].args, [
				"mcp",
				"add",
				"docs",
				"--url",
				"https://example.test/mcp",
				"--header",
				"Authorization=Bearer token",
				"--bearer-token-env-var",
				"DOCS_TOKEN",
				"--oauth-client-id",
				"client-id",
				"--oauth-client-secret",
				"client-secret",
			]);

			await assert.rejects(
				() => ctx.manager.add({ name: "bad name", transport: "stdio", command: "x" }),
				/letters, digits/,
			);
			await assert.rejects(
				() => ctx.manager.add({ name: "empty", transport: "stdio", command: "  " }),
				/needs a command/,
			);
			assert.strictEqual(ctx.calls.length, 1);
		} finally {
			ctx.cleanup();
		}
	});

	test("add rejects non-string env/headers/args and invalid exposure before running", async () => {
		const ctx = createManager();
		try {
			const base = {
				name: "docs",
				transport: "http",
				url: "https://example.test/mcp",
			} as const;
			await assert.rejects(
				() => ctx.manager.add({ ...base, exposure: "bogus" as never }),
				/Invalid MCP exposure/,
			);
			await assert.rejects(
				() => ctx.manager.add({ ...base, env: { KEY: 1 as unknown as string } }),
				/env.*object of strings/,
			);
			await assert.rejects(
				() =>
					ctx.manager.add({
						...base,
						transport: "stdio",
						command: "x",
						args: ["ok", 1 as unknown as string],
					}),
				/args.*array of strings/,
			);
			assert.strictEqual(ctx.calls.length, 0);
		} finally {
			ctx.cleanup();
		}
	});

	test("add surfaces a CLI failure message", async () => {
		const ctx = createManager({
			run: async () => ({ code: 1, stdout: "", stderr: "invalid server" }),
		});
		try {
			await assert.rejects(
				() => ctx.manager.add({ name: "bad", transport: "stdio", command: "x" }),
				/invalid server/,
			);
		} finally {
			ctx.cleanup();
		}
	});

	test("remove passes --local for project servers only", async () => {
		const ctx = createManager();
		try {
			await ctx.manager.remove("global-one", "global");
			await ctx.manager.remove("project-one", "project");
			assert.deepStrictEqual(ctx.calls[0].args, ["mcp", "remove", "global-one"]);
			assert.deepStrictEqual(ctx.calls[1].args, ["mcp", "remove", "project-one", "--local"]);
		} finally {
			ctx.cleanup();
		}
	});

	test("removing a global server also removes its project override", async () => {
		const ctx = createManager();
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { shared: { command: "run" } },
			});
			writeJson(path.join(ctx.cwd, ".pi", "mcp.json"), {
				mcpServers: { shared: { enabled: false } },
			});
			await ctx.manager.remove("shared", "global");
			assert.deepStrictEqual(ctx.calls[0].args, ["mcp", "remove", "shared", "--local"]);
			assert.deepStrictEqual(ctx.calls[1].args, ["mcp", "remove", "shared"]);
		} finally {
			ctx.cleanup();
		}
	});

	test("removing a global server also removes an override the untrusted project hides", async () => {
		const ctx = createManager({ trusted: false });
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { shared: { command: "run" } },
			});
			writeJson(path.join(ctx.cwd, ".pi", "mcp.json"), {
				mcpServers: { shared: { enabled: false } },
			});

			// The untrusted project file is ignored by list(), so the
			// dangling-override cleanup must read it directly.
			assert.strictEqual(ctx.manager.list().servers.length, 1);
			await ctx.manager.remove("shared", "global");
			assert.deepStrictEqual(ctx.calls[0].args, ["mcp", "remove", "shared", "--local"]);
			assert.deepStrictEqual(ctx.calls[1].args, ["mcp", "remove", "shared"]);
		} finally {
			ctx.cleanup();
		}
	});

	test("removing a global server keeps an independent project server", async () => {
		const ctx = createManager();
		try {
			const projectFile = path.join(ctx.cwd, ".pi", "mcp.json");
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { shared: { command: "run" } },
			});
			writeJson(projectFile, {
				mcpServers: { shared: { url: "https://example.test/mcp" } },
			});

			await ctx.manager.remove("shared", "global");
			assert.deepStrictEqual(ctx.calls.length, 1);
			assert.deepStrictEqual(ctx.calls[0].args, ["mcp", "remove", "shared"]);
			assert.deepStrictEqual(readJson(projectFile).mcpServers.shared, {
				url: "https://example.test/mcp",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("disabling autoEnableCodemode with no file keeps the mcpServers key", async () => {
		const ctx = createManager();
		try {
			const globalFile = path.join(ctx.agentDir, "mcp.json");
			ctx.manager.setAutoEnableCodemode(false);
			assert.deepStrictEqual(readJson(globalFile), {
				mcpServers: {},
				autoEnableCodemode: false,
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("updateConfig edits the defining file and removes default values", async () => {
		const ctx = createManager();
		try {
			const globalFile = path.join(ctx.agentDir, "mcp.json");
			writeJson(globalFile, {
				autoEnableCodemode: false,
				mcpServers: {
					server: { command: "run", enabled: true, exposure: "codemode" },
				},
				other: { keep: true },
			});

			await ctx.manager.updateConfig("server", { enabled: false, exposure: "direct" });
			const updated = readJson(globalFile);
			assert.strictEqual(updated.mcpServers.server.enabled, false);
			assert.strictEqual(updated.mcpServers.server.exposure, "direct");
			assert.strictEqual(updated.autoEnableCodemode, false);
			assert.deepStrictEqual(updated.other, { keep: true });

			await ctx.manager.updateConfig("server", { enabled: true, exposure: "codemode" });
			const defaults = readJson(globalFile);
			assert.strictEqual(defaults.mcpServers.server.enabled, undefined);
			assert.strictEqual(defaults.mcpServers.server.exposure, undefined);
			assert.ok(
				ctx.notifications.filter((m) => m.type === "mcp-servers-updated").length >= 2,
			);
		} finally {
			ctx.cleanup();
		}
	});

	test("updateConfig with project scope creates an override for a global server", async () => {
		const ctx = createManager();
		try {
			const globalFile = path.join(ctx.agentDir, "mcp.json");
			const projectFile = path.join(ctx.cwd, ".pi", "mcp.json");
			writeJson(globalFile, {
				mcpServers: { shared: { command: "run", exposure: "direct" } },
			});

			await ctx.manager.updateConfig("shared", { enabled: false }, "project");
			assert.deepStrictEqual(readJson(projectFile), {
				mcpServers: { shared: { enabled: false } },
			});
			assert.strictEqual(readJson(globalFile).mcpServers.shared.enabled, undefined);
		} finally {
			ctx.cleanup();
		}
	});

	test("updateConfig preserves the project file's indentation and unrelated fields", async () => {
		const ctx = createManager();
		try {
			const projectFile = path.join(ctx.cwd, ".pi", "mcp.json");
			fs.mkdirSync(path.dirname(projectFile), { recursive: true });
			fs.writeFileSync(
				projectFile,
				`{\n\t"mcpServers": {\n\t\t"server": { "command": "run" }\n\t},\n\t"autoEnableCodemode": true\n}\n`,
			);

			await ctx.manager.updateConfig("server", { exposure: "deferred" }, "project");
			const text = fs.readFileSync(projectFile, "utf8");
			assert.ok(text.includes('\n\t"mcpServers"'), "keeps tab indentation");
			const parsed = JSON.parse(text);
			assert.strictEqual(parsed.mcpServers.server.exposure, "deferred");
			assert.strictEqual(parsed.autoEnableCodemode, true);
		} finally {
			ctx.cleanup();
		}
	});

	test("updateConfig rejects an unknown server", async () => {
		const ctx = createManager();
		try {
			await assert.rejects(
				() => ctx.manager.updateConfig("missing", { enabled: false }),
				/No MCP server/,
			);
		} finally {
			ctx.cleanup();
		}
	});

	test("autoEnableCodemode defaults on, persists only when disabled, and preserves servers", () => {
		const ctx = createManager();
		try {
			const globalFile = path.join(ctx.agentDir, "mcp.json");
			assert.deepStrictEqual(ctx.manager.getAutoEnableCodemodeInfo(), {
				value: true,
				source: "default",
			});
			ctx.manager.setAutoEnableCodemode(true);
			assert.strictEqual(
				fs.existsSync(globalFile),
				false,
				"enabling the default writes nothing",
			);

			writeJson(globalFile, {
				mcpServers: { server: { command: "run" } },
				other: { keep: true },
			});
			ctx.manager.setAutoEnableCodemode(false);
			assert.deepStrictEqual(ctx.manager.getAutoEnableCodemodeInfo(), {
				value: false,
				source: "global",
			});
			assert.deepStrictEqual(readJson(globalFile), {
				mcpServers: { server: { command: "run" } },
				autoEnableCodemode: false,
				other: { keep: true },
			});

			ctx.manager.setAutoEnableCodemode(true);
			assert.deepStrictEqual(ctx.manager.getAutoEnableCodemodeInfo(), {
				value: true,
				source: "default",
			});
			assert.strictEqual(readJson(globalFile).autoEnableCodemode, undefined);
		} finally {
			ctx.cleanup();
		}
	});

	test("a trusted project reports autoEnableCodemode as a project override", () => {
		const ctx = createManager();
		try {
			writeJson(path.join(ctx.agentDir, "mcp.json"), {
				mcpServers: { server: { command: "run" } },
			});
			writeJson(path.join(ctx.cwd, ".pi", "mcp.json"), { autoEnableCodemode: false });

			assert.deepStrictEqual(ctx.manager.getAutoEnableCodemodeInfo(), {
				value: false,
				source: "project",
			});

			ctx.setTrusted(false);
			assert.deepStrictEqual(ctx.manager.getAutoEnableCodemodeInfo(), {
				value: true,
				source: "default",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("login and logout use the CLI with a long login timeout", async () => {
		const ctx = createManager();
		try {
			await ctx.manager.login("sentry");
			await ctx.manager.logout("sentry");
			assert.deepStrictEqual(ctx.calls[0].args, [
				"mcp",
				"login",
				"sentry",
				"--timeout",
				"300",
			]);
			assert.ok(ctx.calls[0].timeoutMs >= 300_000);
			assert.deepStrictEqual(ctx.calls[1].args, ["mcp", "logout", "sentry"]);
		} finally {
			ctx.cleanup();
		}
	});
});
