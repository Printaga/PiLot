// postinstall-patch.mjs — Apply patches to SDK packages after install
// Current patches:
//   pi-coding-agent: use "pi" discovery mode for .agents/skills/ (same as .pi/skills/)
//
// This ensures root .md files are discovered as individual skills in ALL locations,
// not just in .pi/skills/ directories.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function findFiles(pattern) {
	try {
		const out = execSync(
			`find "${root}/node_modules" -path "*/${pattern}" -type f 2>/dev/null`,
			{ encoding: "utf-8", timeout: 10_000 },
		);
		return out.trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

function patchAgentsMode() {
	const files = findFiles(
		"@earendil-works/pi-coding-agent/dist/core/package-manager.js",
	);
	if (files.length === 0) {
		process.stderr.write("[patch] package-manager.js not found, skipping\n");
		return;
	}

	let patched = 0;
	for (const file of files) {
		try {
			const content = execSync(`cat "${file}"`, {
				encoding: "utf-8",
				timeout: 5000,
			});
			const next = content
				.replace(
					'collectAutoSkillEntries(agentsSkillsDir, "agents")',
					'collectAutoSkillEntries(agentsSkillsDir, "pi")',
				)
				.replace(
					'collectAutoSkillEntries(userAgentsSkillsDir, "agents")',
					'collectAutoSkillEntries(userAgentsSkillsDir, "pi")',
				);

			if (next !== content) {
				writeFileSync(file, next, "utf-8");
				patched++;
			}
		} catch (err) {
			process.stderr.write(`[patch] fail ${file}: ${err.message}\n`);
		}
	}
	process.stdout.write(
		`[patch] pi-coding-agent agents→pi mode: ${patched} file(s)\n`,
	);
}

patchAgentsMode();
