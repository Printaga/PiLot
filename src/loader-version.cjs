/**
 * Version helpers shared by the CommonJS loader.
 *
 * Kept in a dependency-free module so the loader can reject an incompatible
 * globally installed PI SDK before it requires the extension bundle (which
 * statically imports 1.4-only exports).
 */

const MIN_PI_SDK_VERSION = "1.4.0";

function parseVersion(value) {
	if (typeof value !== "string") return null;
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
	if (!match) return null;
	const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
	return parts.every((part) => Number.isSafeInteger(part)) ? parts : null;
}

/**
 * Compare two versions: 1 when `actual` is newer, -1 when older, 0 when equal,
 * and null when either side is unparseable (so callers cannot mistake an
 * unreadable version for a valid comparison).
 */
function compareVersions(actual, expected) {
	const parsedActual = parseVersion(actual);
	const parsedExpected = parseVersion(expected);
	if (!parsedActual || !parsedExpected) return null;
	for (let i = 0; i < parsedActual.length; i++) {
		if (parsedActual[i] !== parsedExpected[i]) {
			return parsedActual[i] > parsedExpected[i] ? 1 : -1;
		}
	}
	return 0;
}

/** Whether `actual` is the same as or newer than `minimum`. */
function isVersionAtLeast(actual, minimum) {
	const comparison = compareVersions(actual, minimum);
	// `null` (unreadable version) is not "at least": a missing version must
	// never pass the floor check via JS's `null >= 0` coercion.
	return comparison !== null && comparison >= 0;
}

/** Whether `version` is a real version at all ("1.4.0"), not a placeholder. */
function isComparableVersion(version) {
	// parseVersion accepts exactly what compareVersions can order, so a version
	// is comparable when it can be compared with itself. A non-empty placeholder
	// ("latest") is unreadable for ranking purposes even though it is truthy.
	return compareVersions(version, version) === 0;
}

/**
 * Pick the candidate carrying the newest readable version.
 *
 * Package managers keep every installed version side by side (mise one
 * directory per version, pnpm one per Node version) and directory iteration
 * order is arbitrary, so "first SDK found" is not "current SDK". Candidates
 * with an unreadable version never displace a readable one, and a tie keeps the
 * earlier candidate's order (discovery priority is the caller's intent).
 *
 * @param {Array<{ version: unknown }>} candidates in discovery order
 * @returns the preferred candidate, or null for an empty list
 */
function pickNewestVersion(candidates) {
	if (!Array.isArray(candidates) || candidates.length === 0) return null;
	let best = candidates[0];
	for (const candidate of candidates.slice(1)) {
		if (!isComparableVersion(candidate.version)) continue;
		if (
			!isComparableVersion(best.version) ||
			compareVersions(candidate.version, best.version) > 0
		) {
			best = candidate;
		}
	}
	return best;
}

module.exports = { MIN_PI_SDK_VERSION, isVersionAtLeast, pickNewestVersion };
