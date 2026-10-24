// Host-independent Svelte 5 webview test for the MCP panel contract.
//
// The panel is the user-visible half of MCP management: it must request both
// the fast config list and the live connection check, render scope/state/tools
// from the host payload, and route the config buttons to `openMcpConfig`.

import * as assert from "node:assert";
import { domWindow, hostMessageSource } from "./test-dom-setup.mjs";

const { render, cleanup } = await import("@testing-library/svelte");
const { default: McpPanel } = await import("../../webview/components/McpPanel.svelte");

const flush = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

let postedToHost = [];
domWindow.vscode = {
	postMessage: (msg) => {
		postedToHost.push(msg);
	},
};

function textOf(root, selector) {
	const element = root.querySelector(selector);
	if (!element) return "";
	return element.textContent ?? "";
}

function pushServers(data) {
	globalThis.window.dispatchEvent(
		new domWindow.MessageEvent("message", {
			data: { type: "mcp-servers", data },
			source: hostMessageSource,
		}),
	);
}

const PAYLOAD = {
	servers: [
		{
			name: "filesystem",
			scope: "global",
			source: "/home/u/.pi/agent/mcp.json",
			enabled: true,
			exposure: "codemode",
			transport: "npx -y @modelcontextprotocol/server-filesystem .",
			description: "Local files",
			state: "connected",
			tools: ["read_file", "write_file", "list_directory"],
			resources: true,
		},
		{
			name: "sentry",
			scope: "project",
			source: "/work/.pi/mcp.json",
			override: "/work/.pi/mcp.json",
			enabled: true,
			exposure: "deferred",
			transport: "https://mcp.sentry.dev/mcp",
			description: "",
			state: "needs-auth",
			tools: [],
		},
	],
	errors: [],
	files: {
		global: "/home/u/.pi/agent/mcp.json",
		project: "/work/.pi/mcp.json",
		projectExists: true,
		projectTrusted: true,
	},
	checkedAt: Date.now(),
};

suite("McpPanel", () => {
	setup(() => {
		postedToHost = [];
		domWindow.vscode = {
			postMessage: (msg) => {
				postedToHost.push(msg);
			},
		};
	});

	teardown(() => cleanup());

	test("requests the config list and a live connection check on mount", async () => {
		render(McpPanel, {});
		await flush();
		const types = postedToHost.map((message) => message.type);
		assert.ok(types.includes("getMcpServers"), "requests configured servers");
		assert.ok(types.includes("checkMcpServers"), "requests live connection state");
	});

	test("renders scope, state and project overrides", async () => {
		const mounted = render(McpPanel, {});
		pushServers(PAYLOAD);
		await flush();

		const cards = [...mounted.container.querySelectorAll(".server-card")];
		assert.strictEqual(cards.length, 2, "both servers render");

		const first = cards[0];
		assert.strictEqual(textOf(first, ".server-name").trim(), "filesystem");
		assert.match(textOf(first, ".scope-badge"), /user/);
		assert.strictEqual(textOf(first, ".state-badge"), "connected");

		const second = cards[1];
		assert.match(textOf(second, ".scope-badge"), /project/);
		assert.strictEqual(textOf(second, ".state-badge"), "needs sign-in");
		assert.ok(
			second.textContent.includes("/work/.pi/mcp.json"),
			"shows the project override path",
		);
	});

	test("renders tools and the resources badge", async () => {
		const mounted = render(McpPanel, {});
		pushServers(PAYLOAD);
		await flush();

		const first = mounted.container.querySelector(".server-card");
		assert.match(textOf(first, ".tools"), /read_file/);
		assert.ok(first.textContent.includes("resources"));
	});

	test("malformed payloads do not take down the panel", async () => {
		const mounted = render(McpPanel, {});
		pushServers({
			servers: [null, 42, { name: 7 }, PAYLOAD.servers[0]],
			errors: "not an array",
			files: null,
		});
		await flush();

		const cards = [...mounted.container.querySelectorAll(".server-card")];
		assert.strictEqual(cards.length, 1, "only the well-formed server renders");
		assert.match(cards[0].textContent, /filesystem/);
	});

	test("config buttons route to openMcpConfig", async () => {
		const mounted = render(McpPanel, {});
		pushServers(PAYLOAD);
		await flush();

		const openGlobal = [...mounted.container.querySelectorAll("button")].find((button) =>
			button.textContent.includes("Open main mcp.json"),
		);
		assert.ok(openGlobal, "global config button renders");
		openGlobal.click();
		assert.deepStrictEqual(postedToHost.at(-1), {
			type: "openMcpConfig",
			data: { scope: "global" },
		});

		const openProject = [...mounted.container.querySelectorAll("button")].find((button) =>
			button.textContent.includes("Open project mcp.json"),
		);
		assert.ok(openProject, "project config button renders");
		openProject.click();
		assert.deepStrictEqual(postedToHost.at(-1), {
			type: "openMcpConfig",
			data: { scope: "project" },
		});
	});

	test("a config-only reply does not clear the per-server spinner early", async () => {
		const mounted = render(McpPanel, {});
		pushServers(PAYLOAD);
		await flush();

		const toggle = [...mounted.container.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Disable",
		);
		assert.ok(toggle, "enabled server offers Disable");
		toggle.click();
		await flush();
		const busy = [...mounted.container.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Disable",
		);
		assert.strictEqual(busy.disabled, true, "mutation marks the server busy");

		// The host answers a mutation with `mcp-servers-updated`, which the
		// panel turns into a config + check refresh (setting isChecking).
		globalThis.window.dispatchEvent(
			new domWindow.MessageEvent("message", {
				data: { type: "mcp-servers-updated" },
				source: hostMessageSource,
			}),
		);
		await flush();

		const configOnly = { ...PAYLOAD };
		delete configOnly.checkedAt;
		pushServers(configOnly);
		await flush();
		const stillBusy = [...mounted.container.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Disable",
		);
		assert.strictEqual(
			stillBusy.disabled,
			true,
			"config reply must not clear the spinner while a check is running",
		);

		pushServers({ ...PAYLOAD, checkedAt: Date.now() });
		await flush();
		const idle = [...mounted.container.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Disable",
		);
		assert.strictEqual(idle.disabled, false, "check reply clears the spinner");
	});

	test("enabling a server sends the effective scope", async () => {
		const mounted = render(McpPanel, {});
		pushServers({
			...PAYLOAD,
			servers: [{ ...PAYLOAD.servers[0], enabled: false, state: "disabled" }],
		});
		await flush();

		const toggle = [...mounted.container.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Enable",
		);
		assert.ok(toggle, "disabled server offers Enable");
		toggle.click();
		assert.deepStrictEqual(postedToHost.at(-1), {
			type: "updateMcpServerConfig",
			data: { name: "filesystem", patch: { enabled: true } },
		});
	});
});
