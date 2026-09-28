import { downloadAndUnzipVSCode } from "@vscode/test-electron";

// Default mirrors package.json's engines.vscode; overridable via argv[1].
const DEFAULT_VSCODE_VERSION = "1.85.0";
const version = process.argv[2] || DEFAULT_VSCODE_VERSION;
try {
	const exe = await downloadAndUnzipVSCode({ version });
	console.log(exe);
} catch (err) {
	console.error(
		`dl-vscode: failed to download VS Code ${version}:`,
		err instanceof Error ? err.message : err,
	);
	process.exit(1);
}
