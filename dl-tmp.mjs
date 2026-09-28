import { downloadAndUnzipVSCode } from "@vscode/test-electron";

try {
	const p = await downloadAndUnzipVSCode();
	console.log("VSCODE_PATH=" + p);
} catch (err) {
	console.error("dl-tmp: download failed:", err instanceof Error ? err.message : err);
	process.exit(1);
}
