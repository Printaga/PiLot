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
exports.diagnosticsChannel = void 0;
exports.resetDiagnosticsStateForTests = resetDiagnosticsStateForTests;
exports.getDiagnosticsBuffer = getDiagnosticsBuffer;
exports.logDiagnostics = logDiagnostics;
exports.getDiagnosticsLogContent = getDiagnosticsLogContent;
exports.setDiagnosticsEnabled = setDiagnosticsEnabled;
const vscode = __importStar(require("vscode"));
// ── Diagnostics output channel and log buffer ──────────────────────────────
exports.diagnosticsChannel = vscode.window.createOutputChannel("PiLot Studio Diagnostics", { log: true });
const diagnosticsBuffer = [];
let isDiagnosticsEnabled = false;
/** @internal Reset diagnostics state for tests. guarded by PI_TEST env. */
function resetDiagnosticsStateForTests() {
    if (process.env.PI_TEST !== "1") {
        throw new Error("resetDiagnosticsStateForTests is only available under PI_TEST=1");
    }
    diagnosticsBuffer.length = 0;
    isDiagnosticsEnabled = false;
}
/** @internal Read diagnostics buffer for tests. guarded by PI_TEST env. */
function getDiagnosticsBuffer() {
    if (process.env.PI_TEST !== "1") {
        throw new Error("getDiagnosticsBuffer is only available under PI_TEST=1");
    }
    return diagnosticsBuffer;
}
/** Append a message to the diagnostics log if diagnostics are enabled. */
function logDiagnostics(message, ...args) {
    if (!isDiagnosticsEnabled)
        return;
    const line = `[${new Date().toISOString()}] ${message}`;
    exports.diagnosticsChannel.appendLine(line);
    diagnosticsBuffer.push(line);
    if (args.length > 0) {
        for (const arg of args) {
            const argLine = typeof arg === "string" ? arg : JSON.stringify(arg, null, 2);
            exports.diagnosticsChannel.appendLine(argLine);
            diagnosticsBuffer.push(argLine);
        }
    }
}
/** @internal Build the full diagnostics log content for export. */
function getDiagnosticsLogContent() {
    return diagnosticsBuffer.length > 0
        ? diagnosticsBuffer.join("\n") + "\n"
        : "[PiLot Studio Diagnostics — no log entries yet]\n";
}
/** Enable or disable diagnostics logging. */
function setDiagnosticsEnabled(enabled) {
    isDiagnosticsEnabled = enabled;
    if (enabled) {
        logDiagnostics("Diagnostics logging enabled");
    }
}
//# sourceMappingURL=diagnostics.js.map