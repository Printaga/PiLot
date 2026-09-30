// run-e2e.mjs — portable entry for the VS Code integration suite.
// Replaces POSIX-only shell syntax in the `test` package script (cmd.exe
// cannot run `if ...; then ... fi`), so `pnpm test` works on Windows too.
// When no display server exists (Linux CI) and xvfb-run is available, the
// suite runs under a virtual display; otherwise the host is used directly.
import { spawnSync } from "node:child_process";
import process from "node:process";

const runner = process.execPath;
const entry = "./dist-tsc/test/runTest.js";

function hasXvfb() {
	const probe = spawnSync("command", ["-v", "xvfb-run"], { shell: true });
	return probe.status === 0;
}

const underXvfb = process.platform === "linux" && hasXvfb();

const result = spawnSync(
	underXvfb ? "xvfb-run" : runner,
	underXvfb ? ["-a", runner, entry] : [entry],
	{
		stdio: "inherit",
		shell: process.platform === "win32",
	},
);

if (result.error) {
	console.error(`[run-e2e] failed to start: ${result.error.message}`);
	process.exit(3);
}
if (result.signal) {
	const signum = result.signal;
	console.error(`[run-e2e] test host terminated by signal ${signum}.`);
	process.exit(2);
}
process.exit(
	typeof result.status === "number" && result.status > 0 && result.status < 256
		? result.status
		: result.status === 0
			? 0
			: 1,
);
