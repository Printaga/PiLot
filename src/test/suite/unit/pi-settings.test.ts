import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_CODEMODE_INLINE_BUDGET,
	DEFAULT_CODEMODE_MODE,
	globalDefaultToolsEnableCodemode,
	readEffectiveCodemodeSettings,
	readGlobalDefaultTools,
	writeCodemodeSettings,
	writeDefaultToolsCodemode,
} from "../../../pi-settings.js";

interface TestContext {
	root: string;
	agentDir: string;
	cwd: string;
	cleanup: () => void;
}

function createContext(): TestContext {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-pi-settings-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });
	return {
		root,
		agentDir,
		cwd,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value));
}

function writeText(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

function globalSettingsFile(agentDir: string): string {
	return path.join(agentDir, "settings.json");
}

function projectSettingsFile(cwd: string): string {
	return path.join(cwd, ".pi", "settings.json");
}

suite("PI codemode settings", () => {
	test("defaults when neither global nor project settings exist", () => {
		const ctx = createContext();
		try {
			assert.deepStrictEqual(readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true), {
				mode: DEFAULT_CODEMODE_MODE,
				inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
				sources: { mode: "default", inlineBudget: "default" },
				projectFile: projectSettingsFile(ctx.cwd),
				projectStatus: "none",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("reads mode and inline budget from the global codemode object", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "only", inlineBudget: 1200 },
				other: true,
			});
			assert.deepStrictEqual(readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true), {
				mode: "only",
				inlineBudget: 1200,
				sources: { mode: "global", inlineBudget: "global" },
				projectFile: projectSettingsFile(ctx.cwd),
				projectStatus: "none",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("invalid global values fall back to defaults and report no source", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "sometimes", inlineBudget: -4 },
			});
			const settings = readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true);
			assert.strictEqual(settings.mode, DEFAULT_CODEMODE_MODE);
			assert.strictEqual(settings.inlineBudget, DEFAULT_CODEMODE_INLINE_BUDGET);
			assert.deepStrictEqual(settings.sources, {
				mode: "default",
				inlineBudget: "default",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("a trusted project overrides matching global values", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "on", inlineBudget: 3000 },
			});
			writeJson(projectSettingsFile(ctx.cwd), {
				codemode: { mode: "only", inlineBudget: 500 },
			});

			assert.deepStrictEqual(readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true), {
				mode: "only",
				inlineBudget: 500,
				sources: { mode: "project", inlineBudget: "project" },
				projectFile: projectSettingsFile(ctx.cwd),
				projectStatus: "applied",
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("a partial project codemode object keeps the unmatched global value", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "on", inlineBudget: 1200 },
			});
			writeJson(projectSettingsFile(ctx.cwd), {
				codemode: { mode: "only" },
			});

			const settings = readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true);
			assert.strictEqual(settings.mode, "only");
			assert.strictEqual(settings.inlineBudget, 1200);
			assert.deepStrictEqual(settings.sources, {
				mode: "project",
				inlineBudget: "global",
			});
			assert.strictEqual(settings.projectStatus, "applied");
		} finally {
			ctx.cleanup();
		}
	});

	test("an untrusted project file is ignored and called out", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "on", inlineBudget: 1200 },
			});
			writeJson(projectSettingsFile(ctx.cwd), {
				codemode: { mode: "only", inlineBudget: 500 },
			});

			const settings = readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, false);
			assert.strictEqual(settings.mode, "on");
			assert.strictEqual(settings.inlineBudget, 1200);
			assert.deepStrictEqual(settings.sources, {
				mode: "global",
				inlineBudget: "global",
			});
			assert.strictEqual(settings.projectStatus, "ignored");
		} finally {
			ctx.cleanup();
		}
	});

	test("a malformed project file is reported instead of hiding global values", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "only", inlineBudget: 900 },
			});
			writeText(projectSettingsFile(ctx.cwd), "{ not json");

			const settings = readEffectiveCodemodeSettings(ctx.agentDir, ctx.cwd, true);
			assert.strictEqual(settings.mode, "only");
			assert.strictEqual(settings.inlineBudget, 900);
			assert.strictEqual(settings.projectStatus, "invalid");
			assert.match(settings.projectError ?? "", /settings\.json/);
		} finally {
			ctx.cleanup();
		}
	});

	test("merges a write back while preserving unrelated settings and indentation", () => {
		const ctx = createContext();
		try {
			writeText(
				globalSettingsFile(ctx.agentDir),
				`{\n\t"theme": "dark",\n\t"codemode": {\n\t\t"mode": "on",\n\t\t"inlineBudget": 3000\n\t}\n}\n`,
			);

			writeCodemodeSettings(ctx.agentDir, { mode: "only", inlineBudget: 500 });

			const text = fs.readFileSync(globalSettingsFile(ctx.agentDir), "utf8");
			assert.ok(text.includes('\n\t"theme"'), "keeps tab indentation");
			assert.deepStrictEqual(JSON.parse(text), {
				theme: "dark",
				codemode: { mode: "only", inlineBudget: 500 },
			});
		} finally {
			ctx.cleanup();
		}
	});

	test("removes the codemode object when both values return to defaults", () => {
		const ctx = createContext();
		try {
			writeJson(globalSettingsFile(ctx.agentDir), {
				codemode: { mode: "only", inlineBudget: 500 },
				theme: "dark",
			});

			writeCodemodeSettings(ctx.agentDir, {
				mode: DEFAULT_CODEMODE_MODE,
				inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
			});

			assert.deepStrictEqual(
				JSON.parse(fs.readFileSync(globalSettingsFile(ctx.agentDir), "utf8")),
				{
					theme: "dark",
				},
			);
		} finally {
			ctx.cleanup();
		}
	});

	test("defaultTools codemode toggle adds, keeps, and removes the entry", () => {
		const ctx = createContext();
		try {
			assert.strictEqual(readGlobalDefaultTools(ctx.agentDir), undefined);
			assert.strictEqual(globalDefaultToolsEnableCodemode(ctx.agentDir), false);

			assert.deepStrictEqual(writeDefaultToolsCodemode(ctx.agentDir, true), ["+codemode"]);
			assert.strictEqual(globalDefaultToolsEnableCodemode(ctx.agentDir), true);

			// Enabling twice does not duplicate the entry.
			assert.deepStrictEqual(writeDefaultToolsCodemode(ctx.agentDir, true), ["+codemode"]);

			// Other entries are preserved.
			writeJson(globalSettingsFile(ctx.agentDir), {
				defaultTools: ["read", "+codemode"],
				theme: "dark",
			});
			assert.deepStrictEqual(writeDefaultToolsCodemode(ctx.agentDir, false), ["read"]);
			assert.deepStrictEqual(
				JSON.parse(fs.readFileSync(globalSettingsFile(ctx.agentDir), "utf8")),
				{
					defaultTools: ["read"],
					theme: "dark",
				},
			);

			// Removing the last entry removes the key; removing again is a no-op.
			writeJson(globalSettingsFile(ctx.agentDir), { defaultTools: ["+codemode"] });
			assert.deepStrictEqual(writeDefaultToolsCodemode(ctx.agentDir, false), []);
			assert.ok(
				!(
					"defaultTools" in
					JSON.parse(fs.readFileSync(globalSettingsFile(ctx.agentDir), "utf8"))
				),
			);
			assert.strictEqual(writeDefaultToolsCodemode(ctx.agentDir, false), undefined);
		} finally {
			ctx.cleanup();
		}
	});

	test("refuses to overwrite malformed global settings.json", () => {
		const ctx = createContext();
		try {
			writeText(globalSettingsFile(ctx.agentDir), "{ not json");
			assert.throws(
				() => writeCodemodeSettings(ctx.agentDir, { mode: "only" }),
				/settings\.json/,
			);
			assert.strictEqual(
				fs.readFileSync(globalSettingsFile(ctx.agentDir), "utf8"),
				"{ not json",
			);
		} finally {
			ctx.cleanup();
		}
	});
});
