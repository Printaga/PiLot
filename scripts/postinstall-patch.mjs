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
//
// Implementation notes: everything runs through node:fs (no shell), so paths from
// any source are inert and the script also works on Windows.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/** Depth-first search under `dir` for files whose relative path matches
 * `relativePattern` (e.g. "@earendil-works/pi-coding-agent/dist/utils/photon.js"). */
function findFilesUnder(dir, relativePattern, depth = 0, out = []) {
	if (depth > 12) return out; // bounded: node_modules nesting never goes deeper
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out; // unreadable/missing dir: nothing to find here
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			findFilesUnder(full, relativePattern, depth + 1, out);
		} else if (path.relative(dir, full).replace(/\\/g, "/") === relativePattern) {
			out.push(full);
		}
	}
	return out;
}

function findFiles(pattern) {
	return findFilesUnder(path.join(root, "node_modules"), pattern);
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
			const content = readFileSync(file, "utf-8");
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
			process.stderr.write(
				`[patch] fail ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
			);
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
			// Read the first 16 bytes as a Buffer (never utf-8): a healthy file
			// starts with ASCII JS, the corrupt upstream file starts with binary
			// bytes, and decoding binary garbage as text can throw.
			const head = Buffer.from(readFileSync(file)).subarray(0, 16);
			// Healthy photon.js starts with our stub comment or JS code.
			// The corrupt upstream file starts with binary bytes (e.g. 0xe8...).
			const headAscii = head.toString("latin1");
			const startsJs =
				headAscii.startsWith("//") ||
				headAscii.startsWith("/*") ||
				/^[A-Za-z_'"`]/.test(headAscii);
			if (!startsJs) {
				writeFileSync(file, PHOTON_STUB, "utf-8");
				patched++;
			}
		} catch (err) {
			process.stderr.write(
				`[patch] photon fail ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
	}
	process.stdout.write(`[patch] pi-coding-agent photon stub: ${patched} file(s)\n`);
}

patchAgentsMode();
patchPhotonStub();
