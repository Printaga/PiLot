// postinstall-patch.mjs — Apply patches to SDK packages after install
// Current patches:
//   pi-coding-agent: use "pi" discovery mode for .agents/skills/ (same as .pi/skills/)
//   pi-coding-agent: stub corrupt upstream dist/utils/photon.js (binary garbage in
//     published tarball across 0.80.x–0.83.x; crashes ESM loader with
//     "SyntaxError: Invalid or unexpected token"). All consumers null-check
//     loadPhoton(), so a no-op stub is safe and unblocks PiLot Studio + CLI.
//
// This ensures root .md files are discovered as individual skills in ALL locations,
// not just in .pi/skills/ directories.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Stub for the corrupt upstream photon.js. The original is a WASM (photon-rs)
// image lib loader; every consumer null-checks the returned photon handle, so
// returning null makes image clipboard/EXIF/convert features no-ops while
// keeping the rest of PI loadable.
const PHOTON_STUB = `// Stub for corrupt upstream photon.js (binary garbage in published package).
// Original is a WASM (photon-rs) image lib loader; consumers handle null.
export async function loadPhoton() {
  return null;
}
export default { loadPhoton };
`;

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
	const files = findFiles("@earendil-works/pi-coding-agent/dist/core/package-manager.js");
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
	process.stdout.write(`[patch] pi-coding-agent agents→pi mode: ${patched} file(s)\n`);
}

function patchPhotonStub() {
	const files = findFiles("@earendil-works/pi-coding-agent/dist/utils/photon.js");
	if (files.length === 0) {
		process.stderr.write("[patch] photon.js not found, skipping\n");
		return;
	}

	let patched = 0;
	for (const file of files) {
		try {
			const content = execSync(`head -c 16 "${file}"`, {
				encoding: "utf-8",
				timeout: 5000,
			});
			// Healthy photon.js starts with our stub comment or JS code.
			// The corrupt upstream file starts with binary bytes (e.g. 0xe8...).
			const startsJs =
				content.startsWith("//") ||
				content.startsWith("/*") ||
				/^[A-Za-z_'"`]/.test(content);
			if (!startsJs) {
				writeFileSync(file, PHOTON_STUB, "utf-8");
				patched++;
			}
		} catch (err) {
			process.stderr.write(`[patch] photon fail ${file}: ${err.message}\n`);
		}
	}
	process.stdout.write(`[patch] pi-coding-agent photon stub: ${patched} file(s)\n`);
}

patchAgentsMode();
patchPhotonStub();
