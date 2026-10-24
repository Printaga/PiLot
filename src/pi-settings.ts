import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type {
	CodemodeMode,
	CodemodeProjectStatus,
	CodemodeSettings,
	CodemodeSettingsPatch,
	CodemodeSources,
} from "./protocol/types.js";

export const DEFAULT_CODEMODE_MODE: CodemodeMode = "on";
export const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;

/** `defaultTools` modifier that opts the session into the codemode tool. */
export const CODEMODE_DEFAULT_TOOL = "+codemode";

type SettingsRecord = Record<string, unknown>;

interface CodemodeValues {
	mode?: CodemodeMode;
	inlineBudget?: number;
}

export interface EffectiveCodemodeSettings {
	mode: CodemodeMode;
	inlineBudget: number;
	sources: Pick<CodemodeSources, "mode" | "inlineBudget">;
	projectFile?: string;
	projectStatus: CodemodeProjectStatus;
	projectError?: string;
}

function isRecord(value: unknown): value is SettingsRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsPath(agentDir: string): string {
	return path.join(agentDir, "settings.json");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readSettingsFile(file: string): { parsed: SettingsRecord; text?: string } {
	if (!existsSync(file)) return { parsed: {} };
	const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`${file}: ${errorMessage(error)}`, { cause: error });
	}
	if (!isRecord(parsed)) throw new Error(`${file}: expected a JSON object`);
	return { parsed, text };
}

function validMode(value: unknown): CodemodeMode | undefined {
	return value === "on" || value === "only" ? value : undefined;
}

function validBudget(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Only include values PI itself would accept, so invalid keys fall through. */
function codemodeValues(value: unknown): CodemodeValues {
	const codemode = isRecord(value) ? value : {};
	return {
		...(validMode(codemode.mode) ? { mode: validMode(codemode.mode) } : {}),
		...(validBudget(codemode.inlineBudget)
			? { inlineBudget: validBudget(codemode.inlineBudget) }
			: {}),
	};
}

/**
 * Resolve the effective `codemode` values from PI's global settings.json and,
 * when a workspace is trusted, its `.pi/settings.json`. Project values override
 * the matching global value; omitted project keys keep the global value.
 *
 * A malformed project file is reported instead of thrown: PI ignores it, so the
 * effective values remain the global ones. A malformed global file still throws,
 * because showing defaults there would hide a broken user config.
 */
export function readEffectiveCodemodeSettings(
	agentDir: string,
	cwd: string | undefined,
	projectTrusted: boolean,
): EffectiveCodemodeSettings {
	const global = codemodeValues(readSettingsFile(settingsPath(agentDir)).parsed.codemode);
	const projectFile = cwd ? path.join(cwd, ".pi", "settings.json") : undefined;
	const result: EffectiveCodemodeSettings = {
		mode: global.mode ?? DEFAULT_CODEMODE_MODE,
		inlineBudget: global.inlineBudget ?? DEFAULT_CODEMODE_INLINE_BUDGET,
		sources: {
			mode: global.mode !== undefined ? "global" : "default",
			inlineBudget: global.inlineBudget !== undefined ? "global" : "default",
		},
		projectStatus: "none",
		...(projectFile ? { projectFile } : {}),
	};
	if (!projectFile || !existsSync(projectFile)) return result;
	if (!projectTrusted) return { ...result, projectStatus: "ignored" };

	try {
		const project = codemodeValues(readSettingsFile(projectFile).parsed.codemode);
		if (project.mode !== undefined) {
			result.mode = project.mode;
			result.sources.mode = "project";
		}
		if (project.inlineBudget !== undefined) {
			result.inlineBudget = project.inlineBudget;
			result.sources.inlineBudget = "project";
		}
		return { ...result, projectStatus: "applied" };
	} catch (error) {
		return {
			...result,
			projectStatus: "invalid",
			projectError: errorMessage(error),
		};
	}
}

/**
 * Read the global `defaultTools` list (PI has no setter; the SDK only exposes
 * a getter, and project entries layer on top at session start).
 */
export function readGlobalDefaultTools(agentDir: string): string[] | undefined {
	const parsed = readSettingsFile(settingsPath(agentDir)).parsed;
	return Array.isArray(parsed.defaultTools)
		? (parsed.defaultTools.filter((t): t is string => typeof t === "string") as string[])
		: undefined;
}

/** Whether the global `defaultTools` opts into codemode. */
export function globalDefaultToolsEnableCodemode(agentDir: string): boolean {
	return readGlobalDefaultTools(agentDir)?.includes(CODEMODE_DEFAULT_TOOL) ?? false;
}

/**
 * Toggle the `+codemode` entry in the global settings.json `defaultTools`.
 * Project-level `defaultTools` still layer on top at session start; callers
 * should surface that when present. Returns the resulting global list
 * (`undefined` when the key was removed for being empty and previously unset).
 */
export function writeDefaultToolsCodemode(
	agentDir: string,
	enabled: boolean,
): string[] | undefined {
	const file = settingsPath(agentDir);
	const { parsed, text } = readSettingsFile(file);
	const current = Array.isArray(parsed.defaultTools)
		? (parsed.defaultTools.filter((t): t is string => typeof t === "string") as string[])
		: [];
	const hadKey = Array.isArray(parsed.defaultTools);
	const next = enabled
		? current.includes(CODEMODE_DEFAULT_TOOL)
			? current
			: [...current, CODEMODE_DEFAULT_TOOL]
		: current.filter((t) => t !== CODEMODE_DEFAULT_TOOL);
	if (next.length === 0) {
		if (!hadKey) return undefined;
		delete parsed.defaultTools;
	} else {
		parsed.defaultTools = next;
	}
	const indent = (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(file, `${JSON.stringify(parsed, null, indent)}\n`);
	return next.length === 0 && !hadKey ? undefined : next;
}

/**
 * Merge a codemode patch into PI's global settings.json, preserving unrelated
 * settings and the file's indentation. Default values remove the `codemode`
 * object again so the file stays close to what the CLI writes.
 */
export function writeCodemodeSettings(
	agentDir: string,
	patch: CodemodeSettingsPatch,
): Pick<CodemodeSettings, "mode" | "inlineBudget"> {
	const file = settingsPath(agentDir);
	const { parsed, text } = readSettingsFile(file);
	const current = codemodeValues(parsed.codemode);
	const next = {
		mode: patch.mode ?? current.mode ?? DEFAULT_CODEMODE_MODE,
		inlineBudget: patch.inlineBudget ?? current.inlineBudget ?? DEFAULT_CODEMODE_INLINE_BUDGET,
	};
	if (
		next.mode === DEFAULT_CODEMODE_MODE &&
		next.inlineBudget === DEFAULT_CODEMODE_INLINE_BUDGET
	) {
		delete parsed.codemode;
	} else {
		parsed.codemode = next;
	}
	const indent = (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(file, `${JSON.stringify(parsed, null, indent)}\n`);
	return next;
}
