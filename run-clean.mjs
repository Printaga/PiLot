import { spawn } from "node:child_process";

const blockPrefixes = [
	"VSCODE_",
	"ELECTRON_",
	"KILO",
	"ICUBE_",
	"OPENCODE",
	"FALLOW_",
	"RG_PATH",
	"VISUAL",
	"EDITOR",
];
for (const k of Object.keys(process.env)) {
	if (blockPrefixes.some((p) => k.startsWith(p))) {
		delete process.env[k];
	}
}
process.env.VSCODE_PATH =
	"/home/lenovo/Applications/PiLot/.vscode-test/vscode-linux-x64-1.134.0/bin/code";
process.env.DISPLAY = process.env.DISPLAY || ":0";

const child = spawn("node", ["./dist-tsc/test/runTest.js"], {
	stdio: "inherit",
	env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
