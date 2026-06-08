// ── General-purpose shell/process utilities ──────────────────────────────────

import { execFile } from "node:child_process";

type CommandResult = { code: number | null; stdout: string; stderr: string };

/** Strip ANSI escape sequences from a string */
export function stripAnsi(text: string): string {
	let result = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\u001b" && text[index + 1] === "[") {
			index += 2;
			while (index < text.length && !/[A-Za-z]/.test(text[index]!)) {
				index++;
			}
			continue;
		}
		result += char;
	}
	return result;
}

/** Single-quote a string for shell (safe for POSIX shells) */
export function shellQuote(arg: string): string {
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Build a shell command object for spawning pi via shell (Unix only). */
export function getShellCommand(binaryPath: string, args: string[]): { command: string; args: string[] } | null {
	if (process.platform === "win32") {
		return null;
	}

	const shell = process.env.SHELL || "/bin/bash";
	const quotedBinary = shellQuote(binaryPath);
	const quotedArgs = args.map(shellQuote).join(" ");
	const command = `${quotedBinary} ${quotedArgs}`;
	return { command: shell, args: ["-lc", command] };
}

/** Execute a command via execFile with shell: true and return a CommandResult promise */
export function execFileAsync(
	command: string,
	args: string[],
): Promise<CommandResult> {
	return new Promise((resolve) => {
		execFile(command, args, { shell: true }, (error, stdout, stderr) => {
			resolve({
				code:
					error && "code" in error && typeof error.code === "number"
						? error.code
						: 0,
				stdout: stdout || "",
				stderr: stderr || "",
			});
		});
	});
}
