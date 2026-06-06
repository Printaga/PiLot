import * as vscode from "vscode";
import { VERSION, getAgentDir, DefaultPackageManager, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiAgentProvider } from "./pi-agent-provider.js";
import { logDiagnostics } from "./commands/index.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface PiReleaseInfo {
	version: string;
	packageName?: string;
	note?: string;
}

interface PackageUpdateInfo {
	source: string;
	displayName: string;
	type: "npm" | "git";
}

// ── Constants ──────────────────────────────────────────────────────────────

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const VERSION_CHECK_TIMEOUT_MS = 10_000;
const STORAGE_KEY_LAST_CHECK = "updateChecker.lastCheck";
const STORAGE_KEY_KNOWN_PI_UPDATE = "updateChecker.knownPiUpdate";
const STORAGE_KEY_KNOWN_PACKAGE_UPDATES = "updateChecker.knownPackageUpdates";

// ── Version helpers ────────────────────────────────────────────────────────

interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
}

function parsePackageVersion(version: string): ParsedVersion | undefined {
	const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
	if (!match) return undefined;
	return {
		major: Number.parseInt(match[1]!, 10),
		minor: Number.parseInt(match[2]!, 10),
		patch: Number.parseInt(match[3]!, 10),
		prerelease: match[4],
	};
}

function isNewerVersion(candidate: string, current: string): boolean {
	const c = parsePackageVersion(candidate);
	const r = parsePackageVersion(current);
	if (!c || !r) return candidate.trim() !== current.trim();

	if (c.major !== r.major) return c.major > r.major;
	if (c.minor !== r.minor) return c.minor > r.minor;
	if (c.patch !== r.patch) return c.patch > r.patch;
	if (c.prerelease === r.prerelease) return false;
	// No prerelease on candidate means it's a stable release > current prerelease
	if (!c.prerelease) return true;
	if (!r.prerelease) return false;
	return c.prerelease.localeCompare(r.prerelease) > 0;
}

// ── API calls ──────────────────────────────────────────────────────────────

async function fetchLatestPiRelease(): Promise<PiReleaseInfo | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) {
		return undefined;
	}

	try {
		const response = await fetch(LATEST_VERSION_URL, {
			headers: {
				"User-Agent": `pilots-studio/${VERSION}`,
				accept: "application/json",
			},
			signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS),
		});

		if (!response.ok) return undefined;

		const data = (await response.json()) as Record<string, unknown>;

		if (typeof data.version !== "string" || !data.version.trim()) {
			return undefined;
		}

		return {
			version: data.version.trim(),
			packageName: typeof data.packageName === "string" && data.packageName.trim()
				? data.packageName.trim()
				: undefined,
			note: typeof data.note === "string" && data.note.trim()
				? data.note.trim()
				: undefined,
		};
	} catch {
		return undefined;
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a newer pi CLI version is available.
 * Returns the release info if a newer version exists, or undefined if not.
 */
export async function checkForPiUpdate(): Promise<PiReleaseInfo | undefined> {
	const latest = await fetchLatestPiRelease();
	if (!latest) return undefined;

	if (isNewerVersion(latest.version, VERSION)) {
		return latest;
	}

	return undefined;
}

/**
 * Check available package (extension) updates using the DefaultPackageManager.
 * Returns an array of package update info.
 */
export async function checkForPackageUpdates(
	settingsManager?: SettingsManager,
): Promise<PackageUpdateInfo[]> {
	if (process.env.PI_OFFLINE) return [];

	try {
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

		if (!settingsManager) return [];

		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir: getAgentDir(),
			settingsManager,
		});

		const updates = await packageManager.checkForAvailableUpdates();
		return updates.map((u) => ({
			source: u.source,
			displayName: u.displayName,
			type: u.type as "npm" | "git",
		}));
	} catch {
		return [];
	}
}

/**
 * Show a VS Code notification about available updates.
 * Returns the action the user chose, or undefined if they dismissed it.
 */
export async function showUpdateNotification(
	piUpdate: PiReleaseInfo | undefined,
	packageUpdates: PackageUpdateInfo[],
): Promise<string | undefined> {
	const parts: string[] = [];

	if (piUpdate) {
		parts.push(`**PI CLI v${piUpdate.version}**`);
		if (piUpdate.note) {
			parts.push(`— ${piUpdate.note}`);
		}
	}

	if (packageUpdates.length > 0) {
		const displayNames = packageUpdates
			.slice(0, 3)
			.map((p) => p.displayName)
			.join(", ");
		parts.push(`**${packageUpdates.length} package update(s)** (${displayNames}${packageUpdates.length > 3 ? ", …" : ""})`);
	}

	if (parts.length === 0) return undefined;

	const message = `Package Updates Available\n${parts.join("\n")}`;
	const selection = await vscode.window.showInformationMessage(
		message,
		{ modal: false },
		"Update All",
		"Update Extensions Only",
		"View Details",
	);

	return selection;
}

/**
 * Open a VS Code terminal to run `pi update`.
 */
export async function runPiUpdateInTerminal(): Promise<void> {
	const terminal = vscode.window.createTerminal({
		name: "PI Update",
		message: "Running pi update…",
	});
	terminal.show();
	terminal.sendText("pi update");
}

/**
 * Open a VS Code terminal to run `pi update --extensions`.
 */
export async function runPiExtensionsUpdateInTerminal(): Promise<void> {
	const terminal = vscode.window.createTerminal({
		name: "PI Extension Update",
		message: "Running pi update --extensions…",
	});
	terminal.show();
	terminal.sendText("pi update --extensions");
}

/**
 * Perform a full update check and notify the user if updates are available.
 * This is the main entry point for a check cycle.
 */
export async function runUpdateCheck(
	provider: PiAgentProvider,
): Promise<void> {
	logDiagnostics("[Update Checker] Starting update check…");
	logDiagnostics(`[Update Checker] Current PI version: ${VERSION}`);

	// Check for pi CLI updates
	const piUpdate = await checkForPiUpdate();
	if (piUpdate) {
		logDiagnostics(`[Update Checker] New PI version available: ${piUpdate.version}`);
	} else {
		logDiagnostics("[Update Checker] PI version is up to date.");
	}

	// Check for package updates
	const settingsManager = provider.getSettingsManager();
	const packageUpdates = settingsManager
		? await checkForPackageUpdates(settingsManager)
		: [];

	if (packageUpdates.length > 0) {
		logDiagnostics(
			`[Update Checker] Package updates available: ${packageUpdates.map((p) => p.displayName).join(", ")}`,
		);
	} else {
		logDiagnostics("[Update Checker] All packages are up to date.");
	}

	// Notify the webview about update status
	provider.sendUpdatesToWebview(
		piUpdate?.version ?? null,
		packageUpdates.length,
	);

	// Nothing to update
	if (!piUpdate && packageUpdates.length === 0) {
		logDiagnostics("[Update Checker] No updates found.");
		vscode.window.showInformationMessage(
			`✓ PiLot Studio is up to date (PI v${VERSION})`,
		);
		return;
	}

	// Check auto-update setting
	const config = vscode.workspace.getConfiguration("pi-agent");
	const autoUpdate = config.get<boolean>("autoUpdate", false);

	if (autoUpdate) {
		logDiagnostics("[Update Checker] Auto-update is enabled, running pi update…");
		try {
			if (piUpdate || packageUpdates.length > 0) {
				await runPiUpdateInTerminal();
			}
		} catch (error) {
			logDiagnostics(`[Update Checker] Auto-update failed: ${error}`);
		}
		return;
	}

	// Show notification
	const action = await showUpdateNotification(piUpdate, packageUpdates);

	switch (action) {
		case "Update All":
			logDiagnostics("[Update Checker] User chose 'Update All'");
			await runPiUpdateInTerminal();
			break;
		case "Update Extensions Only":
			logDiagnostics("[Update Checker] User chose 'Update Extensions Only'");
			await runPiExtensionsUpdateInTerminal();
			break;
		case "View Details": {
			logDiagnostics("[Update Checker] User chose 'View Details'");
			// Show full update info in a message box
			const details: string[] = [];
			if (piUpdate) {
				details.push(`PI CLI: v${piUpdate.version} available`);
				if (piUpdate.note) details.push(`Note: ${piUpdate.note}`);
				if (piUpdate.packageName) details.push(`Package: ${piUpdate.packageName}`);
			}
			if (packageUpdates.length > 0) {
				details.push("");
				details.push("Package updates:");
				for (const pkg of packageUpdates) {
					details.push(`  • ${pkg.displayName} (${pkg.type})`);
				}
			}
			vscode.window.showInformationMessage(
				`Package Updates Available\n${details.join("\n")}`,
				"Update All",
				"Update Extensions Only",
				"Close",
			).then(async (choice) => {
				if (choice === "Update All") {
					await runPiUpdateInTerminal();
				} else if (choice === "Update Extensions Only") {
					await runPiExtensionsUpdateInTerminal();
				}
			});
			break;
		}
	}
}

// ── Background checker ─────────────────────────────────────────────────────

/**
 * Start the periodic update checker. It will:
 * 1. Check immediately on start (non-blocking)
 * 2. Re-check at the configured interval
 * 3. Notify the user only once per discovered update (tracks via globalState)
 */
export function startUpdateChecker(
	context: vscode.ExtensionContext,
	provider: PiAgentProvider,
): vscode.Disposable {
	// Run an initial check after a short delay (let the extension fully initialize)
	const initialTimeout = setTimeout(async () => {
		try {
			logDiagnostics("[Update Checker] Initializing periodic update checker…");
			await performCheckWithDeduplication(context, provider);
		} catch (err) {
			logDiagnostics(`[Update Checker] Initial update check failed: ${err}`);
		}
	}, 15_000); // 15 seconds after activation

	// Set up periodic checks
	const interval = setInterval(async () => {
		try {
			logDiagnostics("[Update Checker] Running periodic update check…");
			await performCheckWithDeduplication(context, provider);
		} catch (err) {
			logDiagnostics(`[Update Checker] Periodic update check failed: ${err}`);
		}
	}, DEFAULT_CHECK_INTERVAL_MS);

	return {
		dispose: () => {
			clearTimeout(initialTimeout);
			clearInterval(interval);
		},
	};
}

/**
 * Perform a check, but only notify if the updates haven't been reported before.
 * Uses globalState to remember which updates were already shown.
 */
async function performCheckWithDeduplication(
	context: vscode.ExtensionContext,
	provider: PiAgentProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("pi-agent");

	// Skip if offline mode is active
	if (config.get<boolean>("offline", false)) {
		logDiagnostics("[Update Checker] Offline mode active, skipping check.");
		return;
	}

	const lastCheck = context.globalState.get<number>(STORAGE_KEY_LAST_CHECK, 0);
	const now = Date.now();

	// Don't check more than once per hour at minimum (respects the 6-hour default too)
	if (now - lastCheck < 60 * 60 * 1000) {
		logDiagnostics("[Update Checker] Last check was less than 1 hour ago, skipping.");
		return;
	}

	// Update last check timestamp
	await context.globalState.update(STORAGE_KEY_LAST_CHECK, now);

	// Check for pi CLI update
	let piUpdate: PiReleaseInfo | undefined;
	try {
		piUpdate = await checkForPiUpdate();
	} catch {
		piUpdate = undefined;
	}

	// Check for package updates
	const settingsManager = provider.getSettingsManager();
	let packageUpdates: PackageUpdateInfo[];
	try {
		packageUpdates = settingsManager
			? await checkForPackageUpdates(settingsManager)
			: [];
	} catch {
		packageUpdates = [];
	}

	// Build update identifiers for deduplication
	const piUpdateId = piUpdate ? `pi:v${piUpdate.version}` : "";
	const packageUpdateIds = packageUpdates.map((p) => `pkg:${p.source}`).sort().join(",");

	// Get previously known updates
	const knownPiUpdate = context.globalState.get<string>(STORAGE_KEY_KNOWN_PI_UPDATE, "");
	const knownPackageUpdates = context.globalState.get<string>(STORAGE_KEY_KNOWN_PACKAGE_UPDATES, "");

	// Determine if there are new updates to report
	const hasNewPiUpdate = piUpdate && piUpdateId !== knownPiUpdate;
	const hasNewPackageUpdates = packageUpdates.length > 0 && packageUpdateIds !== knownPackageUpdates;

	// Notify the webview about current update state (even if already known)
	provider.sendUpdatesToWebview(
		piUpdate?.version ?? null,
		packageUpdates.length,
	);

	if (!hasNewPiUpdate && !hasNewPackageUpdates) {
		logDiagnostics("[Update Checker] No new updates since last notification.");
		return;
	}

	// Persist what we just reported
	if (piUpdate) {
		await context.globalState.update(STORAGE_KEY_KNOWN_PI_UPDATE, piUpdateId);
	}
	if (packageUpdates.length > 0) {
		await context.globalState.update(STORAGE_KEY_KNOWN_PACKAGE_UPDATES, packageUpdateIds);
	}

	// Show notification or auto-update
	if (config.get<boolean>("autoUpdate", false)) {
		logDiagnostics("[Update Checker] Auto-update enabled, running pi update…");
		try {
			await runPiUpdateInTerminal();
		} catch (error) {
			logDiagnostics(`[Update Checker] Auto-update failed: ${error}`);
		}
		return;
	}

	const action = await showUpdateNotification(piUpdate, packageUpdates);

	switch (action) {
		case "Update All":
			await runPiUpdateInTerminal();
			break;
		case "Update Extensions Only":
			await runPiExtensionsUpdateInTerminal();
			break;
		case "View Details": {
			const details: string[] = [];
			if (piUpdate) {
				details.push(`PI CLI: v${piUpdate.version} available`);
				if (piUpdate.note) details.push(`Note: ${piUpdate.note}`);
			}
			if (packageUpdates.length > 0) {
				details.push("");
				details.push("Package updates:");
				for (const pkg of packageUpdates) {
					details.push(`  • ${pkg.displayName} (${pkg.type})`);
				}
			}
			vscode.window.showInformationMessage(
				`Package Updates Available\n${details.join("\n")}`,
				"Update All",
				"Update Extensions Only",
				"Close",
			).then(async (choice) => {
				if (choice === "Update All") {
					await runPiUpdateInTerminal();
				} else if (choice === "Update Extensions Only") {
					await runPiExtensionsUpdateInTerminal();
				}
			});
			break;
		}
	}
}

/**
 * Clear the stored update notification state.
 * Useful when the user manually runs `pi update`.
 */
export async function clearKnownUpdates(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(STORAGE_KEY_KNOWN_PI_UPDATE, "");
	await context.globalState.update(STORAGE_KEY_KNOWN_PACKAGE_UPDATES, "");
}
