import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	PiAgentProvider,
	piAgentProviderInternals,
	type PiAgentConfig,
} from "../../pi-agent-provider.js";
import { MessageHandler } from "../../message-handler.js";

// Real-host lane: exercises openConfigFile against the actual VS Code API
// (real dialogs auto-answered, real editor tabs, real filesystem) with the
// agent dir pointed at a temp folder so nothing touches ~/.pi/agent.

const tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-agent-"));
process.env.PI_CODING_AGENT_DIR = tempAgentDir;

suite("REALHOST openConfigFile", () => {
	let provider: PiAgentProvider;
	let handler: MessageHandler;
	const recorded: {
		infoMessages: Array<{ msg: string; choice: string | undefined }>;
		shownDocs: unknown[];
	} = {
		infoMessages: [],
		shownDocs: [],
	};
	let savedInfo: any;
	let savedShow: any;

	suiteSetup(() => {
		// The SDK must resolve the agent dir from the env bridge.
		assert.strictEqual(piAgentProviderInternals.getAgentDir(), tempAgentDir);

		const config: PiAgentConfig = {
			defaultModel: "anthropic/claude-sonnet-4-5",
			defaultProvider: "anthropic",
			autoContext: false,
			maxTokens: 8192,
			thinkingLevel: "medium",
		};
		provider = new PiAgentProvider({ globalState: { get: () => undefined, update: async () => {} } } as any, config);
		(provider as any).isInitialized = true; // skip real session bootstrap
		handler = new MessageHandler(provider);

		// Auto-answer dialogs (a real user clicking "Create"), delegate the rest.
		savedInfo = vscode.window.showInformationMessage;
		savedShow = vscode.window.showTextDocument;
		(vscode.window as any).showInformationMessage = async (msg: string, ...rest: any[]) => {
			const choice = rest.find((r) => typeof r === "string");
			recorded.infoMessages.push({ msg, choice });
			return choice;
		};
		(vscode.window as any).showTextDocument = async (doc: unknown, ...rest: any[]) => {
			recorded.shownDocs.push(doc);
			return savedShow.call(vscode.window, doc, ...rest);
		};
	});

	// Real host hands us documents with uri.fsPath; the plain-Node shim's docs
	// have no resolvable path. Exact-path assertions apply only where the lane
	// can resolve one; "a document was opened" is checked in both.
	function lastShownPath(): string | undefined {
		const doc = recorded.shownDocs.at(-1) as any;
		if (typeof doc === "string") return doc;
		return doc?.uri?.fsPath;
	}

	suiteTeardown(async () => {
		vscode.window.showInformationMessage = savedInfo;
		vscode.window.showTextDocument = savedShow;
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		fs.rmSync(tempAgentDir, { recursive: true, force: true });
	});

	test("append-system-prompt creates empty file and opens a real editor tab", async () => {
		await handler.handle({ type: "openConfigFile", data: { file: "append-system-prompt" } } as any);
		const file = path.join(tempAgentDir, "APPEND_SYSTEM.md");
		assert.ok(fs.existsSync(file), "APPEND_SYSTEM.md created on disk");
		assert.strictEqual(fs.readFileSync(file, "utf8"), "", "created empty");
		assert.ok(recorded.shownDocs.length > 0, "editor opened for the file");
		const shown = lastShownPath();
		if (shown !== undefined) assert.strictEqual(shown, file, "editor tab is the file");
	});

	test("second click does not clobber user content", async () => {
		const file = path.join(tempAgentDir, "APPEND_SYSTEM.md");
		fs.writeFileSync(file, "user rules", "utf8");
		await handler.handle({ type: "openConfigFile", data: { file: "append-system-prompt" } } as any);
		assert.strictEqual(fs.readFileSync(file, "utf8"), "user rules", "content preserved");
		assert.strictEqual(recorded.infoMessages.length, 0, "no dialog for existing file");
	});

	test("system-prompt confirms, then creates empty SYSTEM.md", async () => {
		await handler.handle({ type: "openConfigFile", data: { file: "system-prompt" } } as any);
		const file = path.join(tempAgentDir, "SYSTEM.md");
		assert.strictEqual(recorded.infoMessages.length, 1, "confirmation dialog shown");
		assert.ok(recorded.infoMessages[0].msg.includes("SYSTEM.md"));
		assert.ok(fs.existsSync(file), "SYSTEM.md created after confirm");
		assert.strictEqual(fs.readFileSync(file, "utf8"), "");
		assert.ok(recorded.shownDocs.length > 0, "editor opened for the file");
		const shown = lastShownPath();
		if (shown !== undefined) assert.strictEqual(shown, file, "editor tab is the file");
	});

	test("existing SYSTEM.md opens without dialog", async () => {
		const before = recorded.infoMessages.length;
		await handler.handle({ type: "openConfigFile", data: { file: "system-prompt" } } as any);
		assert.strictEqual(recorded.infoMessages.length, before, "no second dialog");
	});

	test("careless garbage key is rejected with no file and no editor", async () => {
		const shownBefore = recorded.shownDocs.length;
		const result = await handler.handle({ type: "openConfigFile", data: { file: "../escape" } } as any);
		assert.ok((result as any).error, "garbage key rejected");
		assert.ok(!fs.existsSync(path.join(tempAgentDir, "escape")), "nothing created");
		assert.strictEqual(recorded.shownDocs.length, shownBefore, "no editor opened");
	});

	test("SYSTEM.md cancel path leaves nothing behind", async () => {
		fs.rmSync(path.join(tempAgentDir, "SYSTEM.md"), { force: true });
		(vscode.window as any).showInformationMessage = async (msg: string) => {
			recorded.infoMessages.push({ msg, choice: undefined });
			return undefined; // user dismisses
		};
		const shownBefore = recorded.shownDocs.length;
		await handler.handle({ type: "openConfigFile", data: { file: "system-prompt" } } as any);
		assert.ok(!fs.existsSync(path.join(tempAgentDir, "SYSTEM.md")), "no file on cancel");
		assert.strictEqual(recorded.shownDocs.length, shownBefore, "no tab on cancel");
	});
});
