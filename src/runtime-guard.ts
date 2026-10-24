/**
 * PI 1.4 declares `engines.node >= 22.19.0`. The extension host runs whatever
 * Node the installed VS Code bundles, and VS Code only reached that floor in
 * 1.105 (Node 22.19.0). VS Code itself does not enforce an extension's Node
 * requirement, so activation checks it explicitly and fails with a readable
 * message instead of a module-load error.
 */
export const MINIMUM_NODE_VERSION = "22.19.0";

/** Parse the leading `major.minor.patch` of a Node version string. */
function parseVersion(version: string): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!match) return null;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (
		!Number.isSafeInteger(major) ||
		!Number.isSafeInteger(minor) ||
		!Number.isSafeInteger(patch)
	) {
		return null;
	}
	return [major, minor, patch];
}

/** Whether `version` (e.g. `process.versions.node`) meets the PI 1.4 floor. */
export function isNodeVersionSupported(
	version: string,
	minimum: string = MINIMUM_NODE_VERSION,
): boolean {
	const actual = parseVersion(version);
	const required = parseVersion(minimum);
	if (!actual || !required) return false;
	const [major, minor, patch] = actual;
	const [minMajor, minMinor, minPatch] = required;
	if (major !== minMajor) return major > minMajor;
	if (minor !== minMinor) return minor > minMinor;
	return patch >= minPatch;
}

/** User-facing reason shown when activation cannot continue. */
export function nodeVersionErrorMessage(
	version: string,
	minimum: string = MINIMUM_NODE_VERSION,
): string {
	return (
		`PiLot Studio requires Node ${minimum} or newer (the PI 1.4 runtime), ` +
		`but this VS Code instance runs Node ${version}. Update VS Code to 1.105 or newer ` +
		`and reload the window.`
	);
}
