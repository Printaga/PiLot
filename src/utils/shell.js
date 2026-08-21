"use strict";
// ── General-purpose shell/process utilities ──────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripAnsi = stripAnsi;
exports.shellQuote = shellQuote;
exports.getShellCommand = getShellCommand;
exports.execFileAsync = execFileAsync;
const node_child_process_1 = require("node:child_process");
/** Strip ANSI escape sequences from a string */
function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}
/** Single-quote a string for shell (safe for POSIX shells) */
function shellQuote(arg) {
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}
/** Build a shell command object for spawning pi via shell (Unix only). */
function getShellCommand(binaryPath, args) {
    if (process.platform === "win32") {
        return null;
    }
    const shell = process.env.SHELL || "/bin/bash";
    const quotedBinary = shellQuote(binaryPath);
    const quotedArgs = args.map(shellQuote).join(" ");
    const command = `${quotedBinary} ${quotedArgs}`;
    return { command: shell, args: ["-lc", command] };
}
/** Execute a command via execFile with shell: true and return a CommandResult promise.
 * Times out after the specified duration (default 15s) to prevent indefinite hangs. */
function execFileAsync(command, args, timeoutMs = 15_000) {
    return new Promise((resolve) => {
        let settled = false;
        const child = (0, node_child_process_1.execFile)(command, args, { shell: true }, (error, stdout, stderr) => {
            if (settled)
                return;
            settled = true;
            resolve({
                code: error && "code" in error && typeof error.code === "number"
                    ? error.code
                    : error
                        ? 1
                        : 0,
                stdout: stdout || "",
                stderr: stderr || "",
            });
        });
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            try {
                child.kill();
            }
            catch {
                /* already dead */
            }
            resolve({
                code: 1,
                stdout: "",
                stderr: `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
            });
        }, timeoutMs);
        // Clear timer if command finishes before timeout
        child.on?.("close", () => clearTimeout(timer));
    });
}
//# sourceMappingURL=shell.js.map