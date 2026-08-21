"use strict";
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
exports.BinaryService = exports.binaryServiceInternals = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const fsSync = __importStar(require("node:fs"));
const shell_js_1 = require("./utils/shell.js");
const pi_binary_js_1 = require("./pi-binary.js");
exports.binaryServiceInternals = {
    findPiBinary: pi_binary_js_1.findPiBinary,
    resolvePiBinary: pi_binary_js_1.resolvePiBinary,
};
class BinaryService {
    deps;
    resolvedBinaryPath = null;
    cachedVersion = null;
    pathResolved = false;
    constructor(deps) {
        this.deps = deps;
    }
    resolveAtStartup() {
        if (this.pathResolved)
            return;
        this.resolvedBinaryPath = exports.binaryServiceInternals.resolvePiBinary();
        this.pathResolved = true;
        if (this.resolvedBinaryPath) {
            this.deps.logDebug(`Resolved pi binary: ${this.resolvedBinaryPath}`);
        }
        else {
            const msg = "[PI] Could not locate 'pi' binary. Set pi-agent.binaryPath in settings or ensure 'pi' is on your PATH.";
            this.deps.logError(msg);
            vscode.window.showErrorMessage(msg);
        }
    }
    prependToPath() {
        const originalPath = process.env.PATH;
        if (!originalPath || !this.resolvedBinaryPath)
            return;
        if (!path.isAbsolute(this.resolvedBinaryPath))
            return;
        const binaryDir = path.dirname(this.resolvedBinaryPath);
        const pathSep = process.platform === "win32" ? ";" : ":";
        process.env.PATH = `${binaryDir}${pathSep}${originalPath}`;
    }
    restorePath(originalPath) {
        if (originalPath !== undefined) {
            process.env.PATH = originalPath;
        }
    }
    async getCliVersion() {
        if (this.cachedVersion)
            return this.cachedVersion;
        try {
            const binaryPath = this.resolvedBinaryPath || exports.binaryServiceInternals.findPiBinary();
            const result = await (0, shell_js_1.execFileAsync)(binaryPath, ["--version"]);
            const versionOutput = result.stdout?.trim() || result.stderr?.trim();
            if (result.code === 0 && versionOutput) {
                this.cachedVersion = versionOutput;
                this.deps.logDebug(`Resolved PI CLI version: ${this.cachedVersion}`);
                return this.cachedVersion;
            }
        }
        catch {
            // logging handled by caller
        }
        return null;
    }
    getResolvedPath() {
        return this.resolvedBinaryPath;
    }
    resolveBinary() {
        return exports.binaryServiceInternals.resolvePiBinary();
    }
    getBinaryPath() {
        return exports.binaryServiceInternals.findPiBinary();
    }
    isBinaryAvailable() {
        return this.resolvedBinaryPath !== null;
    }
    resolveGitBranch(cwd) {
        try {
            let dir = cwd;
            while (true) {
                const gitPath = path.join(dir, ".git");
                if (fsSync.existsSync(gitPath)) {
                    const stat = fsSync.statSync(gitPath);
                    if (stat.isDirectory()) {
                        const headPath = path.join(gitPath, "HEAD");
                        if (!fsSync.existsSync(headPath))
                            return null;
                        const content = fsSync.readFileSync(headPath, "utf8").trim();
                        if (content.startsWith("ref: refs/heads/")) {
                            return content.slice(16);
                        }
                        return "detached";
                    }
                    else if (stat.isFile()) {
                        const content = fsSync.readFileSync(gitPath, "utf8").trim();
                        if (content.startsWith("gitdir: ")) {
                            const gitDir = path.resolve(dir, content.slice(8).trim());
                            const headPath = path.join(gitDir, "HEAD");
                            if (!fsSync.existsSync(headPath))
                                return null;
                            const headContent = fsSync.readFileSync(headPath, "utf8").trim();
                            if (headContent.startsWith("ref: refs/heads/")) {
                                return headContent.slice(16);
                            }
                            return "detached";
                        }
                    }
                }
                const parent = path.dirname(dir);
                if (parent === dir)
                    return null;
                dir = parent;
            }
        }
        catch {
            return null;
        }
    }
}
exports.BinaryService = BinaryService;
//# sourceMappingURL=binary-service.js.map