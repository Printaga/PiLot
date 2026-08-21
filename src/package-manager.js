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
exports.PackageManager = void 0;
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const pi_binary_js_1 = require("./pi-binary.js");
const shell_js_1 = require("./utils/shell.js");
class PackageManager {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Enrich installed packages with description, version, types, and per-package resources from the resource loader. */
    enrichPackages(packages) {
        const rl = this.deps.getResourceLoader();
        let skills = [];
        let extensions = [];
        let prompts = [];
        if (rl) {
            try {
                skills = rl.getSkills().skills || [];
            }
            catch {
                skills = [];
            }
            try {
                extensions = rl.getExtensions().extensions || [];
            }
            catch {
                extensions = [];
            }
            try {
                prompts = rl.getPrompts().prompts || [];
            }
            catch {
                prompts = [];
            }
        }
        return packages.map((pkg) => {
            const manifest = (0, pi_binary_js_1.readPackageManifest)(pkg.path);
            // Match resource sourceInfo.source to this package's source string
            const srcLower = pkg.source.toLowerCase();
            const matchesSource = (sourceName) => sourceName?.toLowerCase() === srcLower;
            const pkgSkills = skills
                .filter((s) => matchesSource(s.sourceInfo?.source))
                .map((s) => ({
                name: s.name || "",
                description: s.description || "",
            }));
            const pkgExtensions = extensions
                .filter((e) => matchesSource(e.sourceInfo?.source))
                .map((e) => ({
                path: e.path || "",
                sourceName: e.sourceInfo?.source || null,
            }));
            const pkgPrompts = prompts
                .filter((p) => matchesSource(p.sourceInfo?.source))
                .map((p) => ({
                name: p.name || "",
                description: p.description || "",
            }));
            const types = [];
            if (pkgExtensions.length > 0)
                types.push("extensions");
            if (pkgSkills.length > 0)
                types.push("skills");
            if (pkgPrompts.length > 0)
                types.push("prompts");
            return {
                ...pkg,
                description: manifest.description,
                version: manifest.version,
                types,
                skills: pkgSkills,
                extensions: pkgExtensions,
                prompts: pkgPrompts,
            };
        });
    }
    // Package management methods using CLI
    async listPackages() {
        this.deps.logDebug("[PI] listPackages called");
        const configuredPackages = this.deps.getConfiguredPackages();
        if (configuredPackages.length > 0) {
            this.deps.logDebug("[PI] listPackages: found configured packages:", configuredPackages);
            return this.enrichPackages(configuredPackages);
        }
        return this.enrichPackages(await this.listPackagesFromCli());
    }
    async listPackagesFromCli() {
        const binaryPath = this.deps.binaryService.getBinaryPath();
        const direct = await (0, shell_js_1.execFileAsync)(binaryPath, ["list"]);
        let packages = (0, pi_binary_js_1.parseInstalledPackages)(direct.stdout);
        this.deps.logDebug("[PI] listPackagesFromCli: direct parsed packages:", packages);
        if (packages.length > 0) {
            return packages;
        }
        const shellCommand = (0, shell_js_1.getShellCommand)(binaryPath, ["list"]);
        if (!shellCommand) {
            if (direct.stderr) {
                this.deps.logError("[PI] listPackagesFromCli error:", direct.stderr);
            }
            return packages;
        }
        const fromShell = await (0, shell_js_1.execFileAsync)(shellCommand.command, shellCommand.args);
        packages = (0, pi_binary_js_1.parseInstalledPackages)(fromShell.stdout);
        this.deps.logDebug("[PI] listPackagesFromCli: shell parsed packages:", packages);
        if (packages.length === 0 && (direct.stderr || fromShell.stderr)) {
            this.deps.logError("[PI] listPackagesFromCli error:", direct.stderr || fromShell.stderr);
        }
        return packages;
    }
    spawnPackageCommand(args) {
        const binaryPath = this.deps.binaryService.getBinaryPath();
        // Use shell to resolve via PATH on all platforms when binaryPath is a simple name
        if (binaryPath === "pi" || !path.isAbsolute(binaryPath)) {
            return (0, node_child_process_1.spawn)(binaryPath, args, { shell: true });
        }
        // On non-Windows, use shell for better output streaming
        if (process.platform !== "win32") {
            const shellCommand = (0, shell_js_1.getShellCommand)(binaryPath, args);
            if (shellCommand) {
                return (0, node_child_process_1.spawn)(shellCommand.command, shellCommand.args);
            }
        }
        return (0, node_child_process_1.spawn)(binaryPath, args);
    }
    async runPackageCommand(args) {
        return new Promise((resolve, reject) => {
            // Send loading start
            this.deps.notifyWebview({ type: "loading", data: { loading: true } });
            const proc = this.spawnPackageCommand(args);
            let output = "";
            proc.stdout?.on("data", (chunk) => {
                output += chunk.toString();
                this.deps.notifyWebview({
                    type: "output",
                    data: { text: chunk.toString() },
                });
            });
            proc.stderr?.on("data", (chunk) => {
                output += chunk.toString();
                this.deps.notifyWebview({
                    type: "output",
                    data: { text: chunk.toString() },
                });
            });
            proc.on("close", (code) => {
                // Send loading end
                this.deps.notifyWebview({ type: "loading", data: { loading: false } });
                if (code === 0) {
                    this.deps.notifyWebview({ type: "packages-updated" });
                    resolve();
                }
                else {
                    reject(new Error(output || `Command failed with code ${code}`));
                }
            });
            proc.on("error", (err) => {
                this.deps.notifyWebview({ type: "loading", data: { loading: false } });
                reject(err);
            });
        });
    }
    async installPackage(source) {
        await this.runPackageCommand(["install", source]);
    }
    async uninstallPackage(source) {
        await this.runPackageCommand(["remove", source]);
    }
    async updatePackages() {
        await this.runPackageCommand(["update"]);
    }
}
exports.PackageManager = PackageManager;
//# sourceMappingURL=package-manager.js.map