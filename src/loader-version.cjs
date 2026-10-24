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

/** Whether `actual` is the same as or newer than `minimum`. */
function isVersionAtLeast(actual, minimum) {
	const parsedActual = parseVersion(actual);
	const parsedMinimum = parseVersion(minimum);
	if (!parsedActual || !parsedMinimum) return false;
	const differing = parsedActual.findIndex((part, i) => part !== parsedMinimum[i]);
	return differing < 0 || parsedActual[differing] > parsedMinimum[differing];
}

module.exports = { MIN_PI_SDK_VERSION, isVersionAtLeast };
