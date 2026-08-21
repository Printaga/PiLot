"use strict";
// ── Session resources: context gathering, file resolution, and project info ─
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
exports.SessionResources = void 0;
exports.isBinaryExtension = isBinaryExtension;
exports.areImagesValid = areImagesValid;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const pi_coding_agent_1 = require("@earendil-works/pi-coding-agent");
const pi_binary_js_1 = require("./pi-binary.js");
/** Check whether a file extension indicates a binary (non-text) file. */
function isBinaryExtension(filePath) {
    const binaryExts = new Set([
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".ico",
        ".tiff",
        ".tif",
        ".svg",
        ".avif",
        ".heic",
        ".heif",
        ".mp3",
        ".wav",
        ".ogg",
        ".flac",
        ".aac",
        ".wma",
        ".m4a",
        ".mp4",
        ".mov",
        ".avi",
        ".mkv",
        ".webm",
        ".flv",
        ".wmv",
        ".zip",
        ".tar",
        ".gz",
        ".bz2",
        ".7z",
        ".rar",
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".wasm",
        ".o",
        ".a",
        ".lib",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".eot",
        ".db",
        ".sqlite",
        ".sqlite3",
    ]);
    const ext = path.extname(filePath).toLowerCase();
    return binaryExts.has(ext);
}
/** Validate that an array of image objects is well-formed. */
function areImagesValid(images) {
    if (!Array.isArray(images) || images.length === 0)
        return false;
    return images.every((img) => img &&
        typeof img === "object" &&
        "type" in img &&
        img.type === "image" &&
        typeof img.data === "string" &&
        typeof img.mimeType === "string" &&
        img.data.length > 0);
}
class SessionResources {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Update the settingsManager reference after late initialization. */
    setSettingsManager(manager) {
        this.deps.settingsManager = manager;
    }
    /** Get the current workspace root path. */
    getWorkspacePath() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    }
    /** Get packages configured in settings files, enriched with install paths. */
    getConfiguredPackages() {
        const workspacePath = this.getWorkspacePath();
        const agentDir = (0, pi_coding_agent_1.getAgentDir)();
        const userSettingsPath = path.join(agentDir, "settings.json");
        const projectSettingsPath = path.join(workspacePath, ".pi", "settings.json");
        const packageSources = [
            ...(0, pi_binary_js_1.readPackageSourcesFromSettingsFile)(userSettingsPath, this.deps.logDebug),
            ...(0, pi_binary_js_1.readPackageSourcesFromSettingsFile)(projectSettingsPath, this.deps.logDebug),
        ];
        const packages = new Map();
        for (const source of packageSources) {
            packages.set(source, { source, path: "" });
        }
        if (packages.size === 0 || !this.deps.settingsManager) {
            return [...packages.values()];
        }
        try {
            const packageManager = new pi_coding_agent_1.DefaultPackageManager({
                cwd: workspacePath,
                agentDir,
                settingsManager: this.deps.settingsManager,
            });
            for (const pkg of packageManager.listConfiguredPackages()) {
                const existing = packages.get(pkg.source);
                packages.set(pkg.source, {
                    source: pkg.source,
                    path: pkg.installedPath || existing?.path || "",
                });
            }
        }
        catch (error) {
            this.deps.logError("[PI] Failed to enrich configured packages with install paths:", error);
        }
        return [...packages.values()];
    }
    /** Resolve @file mentions in text, replacing them with file content blocks. */
    async resolveFileMentions(text) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return text;
        }
        const root = workspaceFolders[0].uri.fsPath;
        const mentionRegex = /@([^\s]+)/g;
        const mentions = [];
        let match;
        while ((match = mentionRegex.exec(text)) !== null) {
            mentions.push({
                match: match[0],
                filePath: match[1],
                index: match.index,
            });
        }
        if (mentions.length === 0)
            return text;
        const fileContexts = [];
        let resolvedText = text;
        for (const mention of mentions) {
            const absPath = path.resolve(root, mention.filePath);
            if (!fs.existsSync(absPath))
                continue;
            if (isBinaryExtension(mention.filePath))
                continue;
            try {
                const content = fs.readFileSync(absPath, "utf-8");
                const maxBytes = 50 * 1024;
                const truncated = content.length > maxBytes
                    ? content.slice(0, maxBytes) + "\n... [file truncated at 50KB]"
                    : content;
                fileContexts.push(`<file path="${mention.filePath}">\n${truncated}\n</file>`);
                resolvedText = resolvedText.replace(mention.match, "");
            }
            catch (e) {
                this.deps.logError(`[PI] Failed to read file ${absPath}:`, e);
            }
        }
        if (fileContexts.length === 0)
            return text;
        const fileBlock = fileContexts.join("\n\n");
        const cleanText = resolvedText.replace(/\s+/g, " ").trim();
        return `${fileBlock}\n\n${cleanText}`;
    }
    /** Build a project context string from package.json. */
    async getProjectContext() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return "";
        const root = workspaceFolders[0].uri.fsPath;
        try {
            const packageJsonPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "package.json");
            const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonPath);
            const pkg = JSON.parse(packageJsonContent.toString());
            return `
        Project Root: ${root}
        Project Name: ${pkg.name || "Unknown"}
        Project Version: ${pkg.version || "Unknown"}
      `.trim();
        }
        catch {
            return `Project Root: ${root}`;
        }
    }
}
exports.SessionResources = SessionResources;
//# sourceMappingURL=session-resources.js.map