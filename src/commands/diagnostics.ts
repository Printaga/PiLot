import * as vscode from "vscode";

// ── Diagnostics output channel and log buffer ──────────────────────────────

export const diagnosticsChannel = vscode.window.createOutputChannel("PiLot Studio Diagnostics", {
	log: true,
});

const diagnosticsBuffer: string[] = [];
let isDiagnosticsEnabled = false;

/** FIFO cap on the retained log so a long session can't leak memory via an
 *  unbounded buffer (exports then also stay a reasonable size). */
const MAX_DIAGNOSTICS_LINES = 2000;

function pushDiagnosticLine(line: string): void {
	diagnosticsBuffer.push(line);
	if (diagnosticsBuffer.length > MAX_DIAGNOSTICS_LINES) {
		diagnosticsBuffer.splice(0, diagnosticsBuffer.length - MAX_DIAGNOSTICS_LINES);
	}
}

/** @internal Reset diagnostics state for tests. guarded by PI_TEST env. */
export function resetDiagnosticsStateForTests(): void {
	if (process.env.PI_TEST !== "1") {
		throw new Error("resetDiagnosticsStateForTests is only available under PI_TEST=1");
	}
	diagnosticsBuffer.length = 0;
	isDiagnosticsEnabled = false;
}

/** @internal Read diagnostics buffer for tests. guarded by PI_TEST env. */
export function getDiagnosticsBuffer(): readonly string[] {
	if (process.env.PI_TEST !== "1") {
		throw new Error("getDiagnosticsBuffer is only available under PI_TEST=1");
	}
	return diagnosticsBuffer;
}

/** Append a message to the diagnostics log if diagnostics are enabled. */
export function logDiagnostics(message: string, ...args: unknown[]) {
	if (!isDiagnosticsEnabled) return;
	const line = `[${new Date().toISOString()}] ${message}`;
	diagnosticsChannel.appendLine(line);
	pushDiagnosticLine(line);
	if (args.length > 0) {
		for (const arg of args) {
			// JSON.stringify throws on circular refs / BigInt, and callers pass
			// arbitrary error objects — fall back to String() instead of letting
			// a logging call break the code it is trying to observe.
			let argLine: string;
			if (typeof arg === "string") {
				argLine = arg;
			} else {
				try {
					argLine = JSON.stringify(arg, null, 2);
				} catch {
					argLine = String(arg);
				}
			}
			diagnosticsChannel.appendLine(argLine);
			pushDiagnosticLine(argLine);
		}
	}
}

/** @internal Build the full diagnostics log content for export. */
export function getDiagnosticsLogContent(): string {
	return diagnosticsBuffer.length > 0
		? diagnosticsBuffer.join("\n") + "\n"
		: "[PiLot Studio Diagnostics — no log entries yet]\n";
}

/** Enable or disable diagnostics logging. */
export function setDiagnosticsEnabled(enabled: boolean) {
	isDiagnosticsEnabled = enabled;
	if (enabled) {
		logDiagnostics("Diagnostics logging enabled");
	}
}
