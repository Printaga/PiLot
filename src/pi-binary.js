"use strict";
// ── Pi binary resolution and package output parsing ─────────────────────────
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.piBinaryInternals = void 0;
exports.resolvePiBinaryFromSetting = resolvePiBinaryFromSetting;
exports.findPiBinary = findPiBinary;
exports.resolvePiBinary = resolvePiBinary;
exports.parseInstalledPackages = parseInstalledPackages;
exports.readPackageManifest = readPackageManifest;
exports.readPackageSourcesFromSettingsFile = readPackageSourcesFromSettingsFile;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const childProcess = __importStar(require("node:child_process"));
const shell_js_1 = require("./utils/shell.js");
exports.piBinaryInternals = {
    spawnSync: childProcess.spawnSync,
};
// ── Binary resolution ───────────────────────────────────────────────────
/** Check if the user-configured pi binary path is valid. Returns null to fall through to default resolution. */
function resolvePiBinaryFromSetting(rawPath) {
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed === "pi") {
        return null; // Use default resolution
    }
    if (path.isAbsolute(trimmed)) {
        try {
            fs.accessSync(trimmed, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            return trimmed;
        }
        catch {
            // On Windows, try common executable suffixes when the bare path doesn't exist
            if (process.platform === "win32") {
                for (const ext of [".exe", ".cmd"]) {
                    try {
                        fs.accessSync(trimmed + ext, fs.constants.F_OK);
                        return trimmed + ext;
                    }
                    catch {
                        /* suffix not found, try next */
                    }
                }
            }
            return null;
        }
    }
    const hasPathSep = trimmed.includes("/") ||
        (process.platform === "win32" && trimmed.includes("\\"));
    if (hasPathSep) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const basePath = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const resolvedPath = path.join(basePath, trimmed);
        try {
            fs.accessSync(resolvedPath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            return resolvedPath;
        }
        catch {
            return null;
        }
    }
    return trimmed;
}
/** Find the pi binary using VS Code settings, workspace node_modules, and well-known paths. */
function findPiBinary() {
    const settingPath = vscode.workspace
        .getConfiguration("pi-agent")
        .get("binaryPath", "pi");
    const settingResult = resolvePiBinaryFromSetting(settingPath);
    if (settingResult) {
        return settingResult;
    }
    const home = process.env.HOME || process.env.USERPROFILE || "";
    // Check global well-known paths first — prefer the user's global PI install
    // over any workspace-local copy that may come from an SDK dependency.
    // NOTE: workspace node_modules/.bin/pi is intentionally excluded — it may
    // point to a devDependency copy, not the user's global PI install.
    const candidates = process.platform === "win32"
        ? [
            // pnpm global
            path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi"),
            path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi.exe"),
            path.join(process.env.LOCALAPPDATA || "", "pnpm", "pi.cmd"),
            // npm global (APPDATA/npm)
            path.join(process.env.APPDATA || "", "npm", "pi"),
            path.join(process.env.APPDATA || "", "npm", "pi.exe"),
            path.join(process.env.APPDATA || "", "npm", "pi.cmd"),
            // npm global (LOCALAPPDATA/npm)
            path.join(process.env.LOCALAPPDATA || "", "npm", "pi"),
            path.join(process.env.LOCALAPPDATA || "", "npm", "pi.exe"),
            path.join(process.env.LOCALAPPDATA || "", "npm", "pi.cmd"),
            // ProgramFiles/nodejs (nodejs installer global dir)
            path.join(process.env.ProgramFiles || "", "nodejs", "pi"),
            path.join(process.env.ProgramFiles || "", "nodejs", "pi.exe"),
            path.join(process.env.ProgramFiles || "", "nodejs", "pi.cmd"),
            // bun / other
            path.join(home, ".bun", "bin", "pi"),
            path.join(home, ".npm-global", "pi"),
            path.join(home, ".npm-global", "pi.exe"),
            path.join(home, ".npm-global", "pi.cmd"),
            path.join(home, ".local", "bin", "pi"),
            path.join(home, ".local", "share", "pnpm", "bin", "pi"),
        ]
        : [
            path.join(home, ".bun/bin/pi"),
            path.join(home, ".local/bin/pi"),
            path.join(home, ".npm-global/bin/pi"),
            path.join(home, ".local/share/pnpm/bin/pi"),
            "pi",
        ];
    for (const c of candidates) {
        try {
            fs.accessSync(c, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            return c;
        }
        catch {
            continue;
        }
    }
    return "pi";
}
/** Resolve pi binary to absolute path, returning null if not found. */
function resolvePiBinary() {
    const binary = findPiBinary();
    if (path.isAbsolute(binary)) {
        try {
            fs.accessSync(binary, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            return binary;
        }
        catch {
            return null;
        }
    }
    try {
        if (process.platform === "win32") {
            const result = exports.piBinaryInternals.spawnSync("where", [binary], {
                shell: true,
                timeout: 1000,
            });
            if (result.status === 0 && result.stdout) {
                const resolved = result.stdout.toString().split(/\r?\n/)[0]?.trim();
                return resolved || null;
            }
            return null;
        }
        else {
            const result = exports.piBinaryInternals.spawnSync(`command -v "${binary.replace(/"/g, '\\"')}"`, {
                shell: true,
                timeout: 1000,
            });
            if (result.status === 0 && result.stdout) {
                const resolved = result.stdout.toString().trim();
                return resolved || null;
            }
            return null;
        }
    }
    catch {
        return null;
    }
}
// ── Package parsing ─────────────────────────────────────────────────────
/** Parse the output of `pi list` into structured InstalledPackage entries. */
function parseInstalledPackages(output) {
    const packages = [];
    const lines = (0, shell_js_1.stripAnsi)(output).split("\n");
    let pendingSource = null;
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r/g, "");
        const trimmed = line.trim();
        if (!trimmed ||
            trimmed === "No packages installed." ||
            /packages:\s*$/i.test(trimmed)) {
            continue;
        }
        if (/^\s{4,}\S/.test(line) && pendingSource) {
            packages.push({ source: pendingSource, path: trimmed });
            pendingSource = null;
            continue;
        }
        if (/^\s{2,}\S/.test(line)) {
            if (pendingSource) {
                packages.push({ source: pendingSource, path: "" });
            }
            pendingSource = trimmed.replace(/\s+\(filtered\)$/, "");
        }
    }
    if (pendingSource) {
        packages.push({ source: pendingSource, path: "" });
    }
    return packages;
}
/** Read package.json from an installed package path, returning description + version. */
function readPackageManifest(installedPath) {
    if (!installedPath)
        return { description: "", version: "" };
    try {
        const pkgJsonPath = path.join(installedPath, "package.json");
        if (!fs.existsSync(pkgJsonPath))
            return { description: "", version: "" };
        const raw = fs.readFileSync(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(raw);
        return {
            description: typeof pkg.description === "string" ? pkg.description : "",
            version: typeof pkg.version === "string" ? pkg.version : "",
        };
    }
    catch {
        return { description: "", version: "" };
    }
}
/** Read package source entries from a pi settings.json file. */
function readPackageSourcesFromSettingsFile(filePath, logDebug) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed.packages)) {
            return [];
        }
        return parsed.packages
            .map((entry) => typeof entry === "string" ? entry.trim() : entry.source?.trim())
            .filter((entry) => typeof entry === "string" && entry.length > 0);
    }
    catch (error) {
        logDebug?.("[PI] Failed to read package sources from settings file:", filePath, error);
        return [];
    }
}
//# sourceMappingURL=pi-binary.js.map