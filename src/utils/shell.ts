// ── General-purpose shell/process utilities ──────────────────────────────────

import { execFile } from "node:child_process";

/** Minimal structural view of a spawned child, so tests can inject a fake one. */
export type ShellChildProcess = {
	stdin: { end(data?: string): void } | null;
	/** OS process id; undefined for stubs. A number enables group kills. */
	readonly pid?: number;
	kill(signal?: string): void;
	on(event: string, listener: (...args: unknown[]) => void): unknown;
};

/** Extra process options. `cwd` is applied to the child, not interpolated into the
 * command string, so it stays safe under `shell: true`. */
export interface ShellExecOptions {
	cwd?: string;
}

/** Structural view of `child_process.execFile`. */
type ExecFileLike = (
	command: string,
	args: string[],
	options: { shell: boolean; cwd?: string; detached?: boolean },
	callback: (error: unknown, stdout: string, stderr: string) => void,
) => ShellChildProcess;

/**
 * Mutable holder for process execution. ESM module namespaces are frozen, so
 * tests stub `execFileAsync` / `execFile` here instead of patching the module
 * namespace.
 */
export const shellInternals = {
	execFileAsync: (
		_command: string,
		_args: string[],
		_timeoutMs?: number,
		_options?: ShellExecOptions,
	): Promise<CommandResult> => {
		throw new Error("shellInternals.execFileAsync not initialized");
	},
	execFile: execFile as unknown as ExecFileLike,
	execFileWithStdin: (
		_command: string,
		_args: string[],
		_stdin: string,
		_timeoutMs?: number,
		_options?: ShellExecOptions,
	): Promise<CommandResult> => {
		throw new Error("shellInternals.execFileWithStdin not initialized");
	},
};

export type CommandResult = { code: number | null; stdout: string; stderr: string };

/** Strip ANSI escape sequences from a string */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Single-quote a string for shell (safe for POSIX shells) */
export function shellQuote(arg: string): string {
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Characters cmd.exe interprets even inside quotes, so they cannot be escaped
 * by wrapping: `"` closes the wrapping quote, `%` expands a variable, `^` is an
 * escape, `!` expands under delayed expansion. */
const CMD_UNQUOTABLE = /["%^!\n\r]/;

/**
 * Render `value` so a `shell: true` child receives it as one literal argument.
 *
 * Node concatenates argv into the shell command line without escaping it, so an
 * argument carrying spaces is word-split and one carrying shell syntax is
 * interpreted. Single quotes make every byte literal on a POSIX shell, so that
 * branch always succeeds; cmd.exe has no equivalent, so a value containing one of
 * `CMD_UNQUOTABLE` reports failure and the caller must refuse it.
 *
 * Returns null when the value cannot be passed safely on `platform`.
 */
export function quoteShellArg(value: string, platform: string = process.platform): string | null {
	if (platform === "win32") {
		return CMD_UNQUOTABLE.test(value) ? null : `"${value}"`;
	}
	return shellQuote(value);
}

/**
 * Last-line defense for the Windows `shell: true` seam.
 *
 * Callers are expected to pre-quote with `quoteShellArg()`, but a caller that
 * forgets hands cmd.exe raw argv: Node joins command + args into the shell line
 * without escaping, so `%VAR%`, `^`, `!`, an embedded quote, or a newline would
 * be executed. POSIX shells are covered by `quoteShellArg` at the call sites and
 * by the argv-injection-guard tests; cmd.exe has no safe quoting, so the seam
 * itself refuses the run instead of interpreting hostile argv.
 *
 * Returns an error message when the invocation must not be spawned, or null when
 * it is safe to hand to the shell.
 */
function windowsShellSafetyRejection(command: string, args: string[]): string | null {
	// A value already rendered by `quoteShellArg(v, "win32")` is a literal, but
	// its own wrapping quotes would trip `CMD_UNQUOTABLE`; inspect the payload.
	const payload = (value: string): string =>
		value.length >= 2 && value.startsWith('"') && value.endsWith('"')
			? value.slice(1, -1)
			: value;

	const offenders: string[] = [];
	if (CMD_UNQUOTABLE.test(payload(command))) {
		offenders.push("command");
	}
	for (const arg of args) {
		if (CMD_UNQUOTABLE.test(payload(arg))) offenders.push("arg");
	}
	// Values are redacted: the message can reach user-visible error reports.
	return offenders.length > 0
		? `Refused to run under cmd.exe: unquotable shell metacharacters in ${offenders.join(", ")} (values redacted)`
		: null;
}

/** Build a shell command object for spawning pi via shell (Unix only). */
export function getShellCommand(
	binaryPath: string,
	args: string[],
): { command: string; args: string[] } | null {
	if (process.platform === "win32") {
		return null;
	}

	// SHELL is environment-controlled (a workspace/task/test runner can set it),
	// so only known-good shells are executed; `-lc` sources the login profile,
	// which makes picking the program even more sensitive.
	const ALLOWED_SHELLS = new Set([
		"/bin/bash",
		"/bin/sh",
		"/bin/zsh",
		"/bin/fish",
		"/usr/bin/bash",
		"/usr/bin/sh",
		"/usr/bin/zsh",
		"/usr/bin/fish",
	]);
	const configured = process.env.SHELL;
	const shell = configured && ALLOWED_SHELLS.has(configured) ? configured : "/bin/bash";
	const quotedBinary = shellQuote(binaryPath);
	const quotedArgs = args.map(shellQuote).join(" ");
	const command = `${quotedBinary} ${quotedArgs}`;
	return { command: shell, args: ["-lc", command] };
}

/** Execute a command via execFile with shell: true and return a CommandResult promise.
 * Times out after the specified duration (default 15s) to prevent indefinite hangs. */
export async function execFileAsync(
	command: string,
	args: string[],
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return shellInternals.execFileAsync(command, args, timeoutMs, options);
}

/** Extract a numeric exit code from an exec error without throwing on
 * non-object errors (stub callbacks may reject with strings/numbers). */
function toExitCode(error: unknown): number {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "number" ? code : error ? 1 : 0;
}

/** Render a command for error messages without echoing argv, which can carry
 * credentials (e.g. `--token <secret>`). */
function redactCommand(command: string, args: string[]): string {
	return `${command} <${args.length} argument${args.length === 1 ? "" : "s"} redacted>`;
}

/**
 * Shared runner behind execFileAsyncImpl / execFileWithStdinImpl: win32 argv
 * gate, spawn via the `shellInternals.execFile` seam, timeout with process-group
 * kill, and exit-code mapping. The only difference between the two entry points
 * is whether `stdin` is written to the child.
 */
function runShellCommand(
	command: string,
	args: string[],
	timeoutMs: number,
	options: ShellExecOptions | undefined,
	stdin: string | undefined,
): Promise<CommandResult> {
	if (process.platform === "win32") {
		const rejection = windowsShellSafetyRejection(command, args);
		if (rejection) {
			return Promise.resolve({ code: 1, stdout: "", stderr: rejection });
		}
	}
	return new Promise((resolve) => {
		let settled = false;
		// Holder keeps the timer readable by finish() (declared below) while the
		// write happens after the spawn: a stubbed execFile may invoke the
		// callback synchronously, so the binding must exist before that call.
		const timerHolder: { current?: ReturnType<typeof setTimeout> } = {};

		// Single settle path so the timeout timer is always cleared when the
		// promise resolves (a pending timer would keep the event loop alive for
		// up to timeoutMs after the work is done).
		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			if (timerHolder.current !== undefined) clearTimeout(timerHolder.current);
			resolve(result);
		};

		const child = shellInternals.execFile(
			command,
			args,
			{
				shell: true,
				// The timeout kill targets the process group: `shell: true` runs
				// `/bin/sh -c "…"`, so the real command is a child of the shell.
				// Windows would open a new console window when detached, so this is
				// POSIX-only.
				detached: process.platform !== "win32",
				...options,
			},
			(error, stdout, stderr) => {
				finish({
					code: toExitCode(error),
					stdout: stdout || "",
					stderr: stderr || "",
				});
			},
		);

		timerHolder.current = setTimeout(() => {
			if (settled) return;
			try {
				// Signal the whole group so pipes/`&&` chains do not leave the real
				// command (and its grandchildren) running past the timeout; SIGKILL
				// so a process that ignores SIGTERM still dies.
				if (typeof child.pid === "number" && process.platform !== "win32") {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch {
						child.kill("SIGKILL");
					}
				} else {
					child.kill("SIGKILL");
				}
			} catch {
				/* already dead */
			}
			finish({
				code: 1,
				stdout: "",
				// Do not echo argv: it can carry tokens (e.g. `--token <secret>`).
				stderr: `Command timed out after ${timeoutMs}ms: ${redactCommand(command, args)}`,
			});
		}, timeoutMs);

		try {
			if (stdin !== undefined) child.stdin?.end(stdin);
		} catch {
			/* stdin already closed */
		}
	});
}

async function execFileAsyncImpl(
	command: string,
	args: string[],
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return runShellCommand(command, args, timeoutMs, options, undefined);
}

/**
 * Execute a command via execFile with shell: true, writing `stdin` to the
 * child's standard input before closing it.
 *
 * Repository-derived content MUST be passed as `stdin`, never as an argument:
 * with `shell: true` an argv element is reinterpreted as shell syntax (command
 * substitution executes, quoting and word-splitting corrupt the value). This
 * path exists so callers that pipe untrusted text have a safe way to do it.
 *
 * Times out after `timeoutMs` and terminates the child on expiry.
 */
export async function execFileWithStdin(
	command: string,
	args: string[],
	stdin: string,
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return shellInternals.execFileWithStdin(command, args, stdin, timeoutMs, options);
}

async function execFileWithStdinImpl(
	command: string,
	args: string[],
	stdin: string,
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return runShellCommand(command, args, timeoutMs, options, stdin);
}

shellInternals.execFileAsync = execFileAsyncImpl;
shellInternals.execFileWithStdin = execFileWithStdinImpl;
