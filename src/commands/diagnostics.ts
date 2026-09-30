import * as vscode from "vscode";

// ── Diagnostics output channel and log buffer ──────────────────────────────

// Lazily created so the channel is not allocated (and never disposed) when
// diagnostics stay off; callers dispose it via disposeDiagnosticsChannel().
let diagnosticsChannelInstance: vscode.LogOutputChannel | undefined;

export function getDiagnosticsChannel(): vscode.LogOutputChannel {
	if (!diagnosticsChannelInstance) {
		diagnosticsChannelInstance = vscode.window.createOutputChannel("PiLot Studio Diagnostics", {
			log: true,
		});
	}
	return diagnosticsChannelInstance;
}

/** Dispose the output channel (call from extension deactivate/subscriptions). */
export function disposeDiagnosticsChannel(): void {
	diagnosticsChannelInstance?.dispose();
	diagnosticsChannelInstance = undefined;
}

const diagnosticsBuffer: string[] = [];
let isDiagnosticsEnabled = false;

/** FIFO cap on the retained log so a long session can't leak memory via an
 *  unbounded buffer (exports then also stay a reasonable size). */
const MAX_DIAGNOSTICS_LINES = 2000;
/** Per-entry cap: one pretty-printed object is one entry and could otherwise
 *  be megabytes, defeating the buffer cap entirely. */
const MAX_DIAGNOSTICS_LINE_CHARS = 2000;

function pushDiagnosticLine(line: string): void {
	const clamped =
		line.length > MAX_DIAGNOSTICS_LINE_CHARS
			? `${line.slice(0, MAX_DIAGNOSTICS_LINE_CHARS)}… [truncated ${line.length} chars]`
			: line;
	diagnosticsBuffer.push(clamped);
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
	// Defensive copy: the readonly type hides mutation at compile time only; a
	// caller pushing into the live array would bypass the cap and corrupt the
	// export while it is being iterated.
	return [...diagnosticsBuffer];
}

/** Append a message to the diagnostics log if diagnostics are enabled. */
export function logDiagnostics(message: string, ...args: unknown[]) {
	if (!isDiagnosticsEnabled) return;
	const channel = getDiagnosticsChannel();
	const line = `[${new Date().toISOString()}] ${message}`;
	channel.appendLine(line);
	pushDiagnosticLine(line);
	if (args.length > 0) {
		for (const arg of args) {
			// JSON.stringify throws on circular refs / BigInt, and returns
			// undefined (not a string) for undefined/function/symbol values —
			// fall back to String() instead of pushing a literal `undefined`.
			let argLine: string;
			if (typeof arg === "string") {
				argLine = arg;
			} else {
				try {
					argLine = JSON.stringify(arg) ?? String(arg);
				} catch {
					argLine = String(arg);
				}
			}
			channel.appendLine(argLine);
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
	if (isDiagnosticsEnabled === enabled) return;
	isDiagnosticsEnabled = enabled;
	if (enabled) {
		logDiagnostics("Diagnostics logging enabled");
	} else {
		// Logging is off; make the discontinuity explicit for later exports so
		// stale entries cannot be mistaken for current output.
		getDiagnosticsChannel().appendLine("[Diagnostics logging disabled]");
		pushDiagnosticLine("[Diagnostics logging disabled]");
	}
}
