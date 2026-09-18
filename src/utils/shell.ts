// ── General-purpose shell/process utilities ──────────────────────────────────

import { execFile } from "node:child_process";

/** Minimal structural view of a spawned child, so tests can inject a fake one. */
export type ShellChildProcess = {
	stdin: { end(data?: string): void } | null;
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
	options: { shell: boolean; cwd?: string },
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

/** Build a shell command object for spawning pi via shell (Unix only). */
export function getShellCommand(
	binaryPath: string,
	args: string[],
): { command: string; args: string[] } | null {
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
export async function execFileAsync(
	command: string,
	args: string[],
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return shellInternals.execFileAsync(command, args, timeoutMs, options);
}

async function execFileAsyncImpl(
	command: string,
	args: string[],
	timeoutMs = 15_000,
	options?: ShellExecOptions,
): Promise<CommandResult> {
	return new Promise((resolve) => {
		let settled = false;
		const child = execFile(
			command,
			args,
			{ shell: true, ...options },
			(error, stdout, stderr) => {
				if (settled) return;
				settled = true;
				resolve({
					code:
						error && "code" in error && typeof error.code === "number"
							? error.code
							: error
								? 1
								: 0,
					stdout: stdout || "",
					stderr: stderr || "",
				});
			},
		);

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				child.kill();
			} catch {
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
	return new Promise((resolve) => {
		let settled = false;

		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		const child = shellInternals.execFile(
			command,
			args,
			{ shell: true, ...options },
			(error, stdout, stderr) => {
				const errorCode = (error as { code?: unknown } | null)?.code;
				finish({
					code: typeof errorCode === "number" ? errorCode : error ? 1 : 0,
					stdout: stdout || "",
					stderr: stderr || "",
				});
			},
		);

		const timer = setTimeout(() => {
			if (settled) return;
			try {
				child.kill();
			} catch {
				/* already dead */
			}
			finish({
				code: 1,
				stdout: "",
				stderr: `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
			});
		}, timeoutMs);

		// Clear timer if command finishes before timeout
		child.on?.("close", () => clearTimeout(timer));

		try {
			child.stdin?.end(stdin);
		} catch {
			/* stdin already closed */
		}
	});
}

shellInternals.execFileAsync = execFileAsyncImpl;
shellInternals.execFileWithStdin = execFileWithStdinImpl;
