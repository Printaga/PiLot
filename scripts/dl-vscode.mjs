import { readFileSync } from "node:fs";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

// Keep a single source of truth: derive the fallback from package.json's
// engines.vscode range instead of duplicating the literal here.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const DEFAULT_VSCODE_VERSION = pkg.engines.vscode.replace(/^[\^~>=<\s]+/, "");

// Overridable via the first CLI argument, i.e. `process.argv[2]`
// (`node scripts/dl-vscode.mjs 1.90.0`), or the VSCODE_VERSION env var.
const version = process.env.VSCODE_VERSION || process.argv[2] || DEFAULT_VSCODE_VERSION;

if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
	console.error(
		`dl-vscode: "${version}" is not a plain version. Pass a bare version like 1.90.0 (ranges such as "^1.85.0" are not valid here).`,
	);
	process.exit(2);
}

try {
	const exe = await downloadAndUnzipVSCode({ version });
	console.log(exe);
} catch (err) {
	console.error(
		`dl-vscode: failed to download VS Code ${version}:`,
		err instanceof Error
			? process.env.VSCODE_DL_DEBUG
				? (err.stack ?? err.message)
				: err.message
			: err,
	);
	process.exit(1);
}
