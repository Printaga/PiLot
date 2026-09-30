/**
 * PiLot Studio - CommonJS Loader
 *
 * This loader resolves the PI SDK from the user's global PI installation
 * instead of bundling it with the extension. This approach:
 * - Makes the extension much smaller (~50MB reduction)
 * - Avoids version conflicts between bundled and global PI SDK
 * - Uses the user's installed PI packages and extensions
 *
 * How it works:
 * 1. Finds the global PI SDK by checking ~/.pi/, pnpm global, npm global, etc.
 * 2. Hooks Node.js module resolution to intercept @earendil-works/pi-coding-agent
 *    requires, reading package.json directly and resolving to the main file.
 *    This bypasses the ESM-only exports map (which has only "import", no "require"),
 *    allowing Node.js 22+'s native require(esm) to load the ESM package.
 * 3. Adds the global PI node_modules to Node's globalPaths for secondary fallback.
 * 4. Loads and returns the CJS extension bundle.
 */

const Module = require("module");
const path = require("path");
const fs = require("fs");

// ── Constants (previously inlined strings scattered through the file) ──────
const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_SDK_DOCS_URL = "https://github.com/earendil-works/pi-coding-agent";
const PI_SDK_INSTALL_COMMAND = "npm install -g --ignore-scripts " + PI_SDK_PACKAGE;
/** Timeout for the `which pi` / `where pi` probes: a wedged PATH lookup must
 * not stall extension activation indefinitely. */
const PATH_PROBE_TIMEOUT_MS = 3000;

/** Subprocess helper: argv-array spawnSync with a hard timeout. Replaces the
 * unbounded `execSync("which pi")` / `execSync("where pi")` calls that could
 * hang activation. Returns { ok, stdout } with stdout trimmed, or ok:false. */
function runProbeSync(command, args, timeoutMs) {
	try {
		const { spawnSync } = require("child_process");
		const result = spawnSync(command, args, {
			encoding: "utf8",
			timeout: timeoutMs,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		if (result.error || result.status !== 0 || !result.stdout) {
			return { ok: false, stdout: "" };
		}
		return { ok: true, stdout: String(result.stdout).trim() };
	} catch (e) {
		return { ok: false, stdout: "" };
	}
}

/**
 * Get the user's home directory in a cross-platform way
 */
function getHomeDir() {
	// Try environment variables first (works on all platforms)
	if (process.env.HOME) {
		return process.env.HOME;
	}
	if (process.env.USERPROFILE) {
		return process.env.USERPROFILE;
	}
	if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
		return path.join(process.env.HOMEDRIVE, process.env.HOMEPATH);
	}

	// Fallback to os.homedir()
	try {
		const os = require("os");
		return os.homedir();
	} catch (e) {
		return null;
	}
}

/**
 * Find the PI SDK at a specific node_modules path, checking both versioned and symlinked locations
 */
function findPiSdkAtPath(nodeModulesPath) {
	if (!fs.existsSync(nodeModulesPath)) {
		return null;
	}

	// Check direct @earendil-works/pi-coding-agent path
	const directSdkPath = path.join(nodeModulesPath, "@earendil-works", "pi-coding-agent");
	if (fs.existsSync(directSdkPath)) {
		// Resolve to real path for pnpm store symlinks, then find the real node_modules.
		// Use lastIndexOf so that for mise's nested layout
		// (outer node_modules/.mise/@earendil-works+pi-coding-agent@ver/node_modules/@earendil-works/pi-coding-agent)
		// we extract the outer node_modules, not the inner .mise/.../node_modules.
		try {
			const realSdkPath = fs.realpathSync(directSdkPath);
			const normalizedReal = realSdkPath.replace(/\\/g, "/");
			const nodeModulesIdx = normalizedReal.lastIndexOf("/node_modules/");
			if (nodeModulesIdx > 0) {
				const realNodeModules = realSdkPath.substring(
					0,
					nodeModulesIdx + "/node_modules".length,
				);
				// Verify this real path has all required @earendil-works packages
				if (
					fs.existsSync(path.join(realNodeModules, "@earendil-works", "pi-coding-agent"))
				) {
					return realNodeModules;
				}
			}
		} catch (e) {
			// Fall through to check original path
		}
		return nodeModulesPath;
	}

	// Also check .mise subdirectory (aube-bin-shim layout:
	// node_modules/.mise/@earendil-works+pi-coding-agent@ver/node_modules/)
	// Guarded: an unreadable/looping directory must be skipped, not break load().
	let entries;
	try {
		entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
	} catch (e) {
		return null; // unreadable node_modules — treat as "not a PI install"
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".pi-coding-agent-") && entry.isSymbolicLink()) {
			try {
				const linkTarget = fs.realpathSync(path.join(nodeModulesPath, entry.name));
				// Same derivation used everywhere else: take the outermost
				// /node_modules/ segment of a plausible CLI path inside the package,
				// instead of a hard-coded and fragile multi-level ".." walk-up.
				const sdkNodeModules = extractNodeModulesPath(
					path.join(linkTarget, "dist", "cli.js"),
				);
				if (sdkNodeModules && fs.existsSync(sdkNodeModules)) {
					const targetSdkPath = path.join(
						sdkNodeModules,
						"@earendil-works",
						"pi-coding-agent",
					);
					if (fs.existsSync(targetSdkPath)) {
						return sdkNodeModules;
					}
				}
			} catch (e) {
				// Ignore symlink resolution errors
			}
		}
	}

	return null;
}

/**
 * Collect the node_modules directories of pnpm's versioned global installs
 * (shared by the Linux/macOS and Windows pnpm layouts, which are identical
 * apart from their base directory).
 */
function collectPnpmGlobalNodeModules(pnpmGlobalBase, possiblePaths) {
	if (!fs.existsSync(pnpmGlobalBase)) return;
	let versionDirs;
	try {
		versionDirs = fs
			.readdirSync(pnpmGlobalBase)
			.filter((name) => name.startsWith("v") || /^\d+$/.test(name));
	} catch (e) {
		return; // unreadable pnpm global dir — skip it
	}
	for (const versionDir of versionDirs) {
		const versionedPath = path.join(pnpmGlobalBase, versionDir);
		let hashDirs;
		try {
			hashDirs = fs
				.readdirSync(versionedPath)
				.filter((name) => name !== "pnpm-workspace.yaml" && !name.startsWith("."));
		} catch (e) {
			continue; // unreadable version dir — try the next one
		}
		for (const hashDir of hashDirs) {
			const nodeModulesPath = path.join(versionedPath, hashDir, "node_modules");
			if (fs.existsSync(nodeModulesPath)) {
				possiblePaths.push(nodeModulesPath);
			}
		}
	}
}

/**
 * Blocking global-root probes (`which pi`, `npm root -g`, `pnpm root -g`).
 * Each spawnSync freezes the extension host for up to PATH_PROBE_TIMEOUT_MS,
 * so they must only run when the cheap filesystem candidates all missed.
 */
function runGlobalRootProbes() {
	const probed = [];

	const piSdkPath = findPiSdkFromCommand();
	if (piSdkPath) {
		probed.push(piSdkPath);
	}

	// Check global npm installation
	try {
		const npmProbe = runProbeSync("npm", ["root", "-g"], PATH_PROBE_TIMEOUT_MS);
		if (npmProbe.ok && npmProbe.stdout && fs.existsSync(npmProbe.stdout)) {
			probed.push(npmProbe.stdout);
		}
	} catch (e) {
		// npm not available or command failed, skip
	}

	// Check pnpm global root as fallback
	try {
		const pnpmProbe = runProbeSync("pnpm", ["root", "-g"], PATH_PROBE_TIMEOUT_MS);
		if (pnpmProbe.ok && pnpmProbe.stdout && fs.existsSync(pnpmProbe.stdout)) {
			probed.push(pnpmProbe.stdout);
		}
	} catch (e) {
		// pnpm not available, skip
	}

	return probed;
}

/**
 * Find the global PI installation directory
 * Checks multiple possible locations across different platforms and installation methods
 */
function findGlobalPiInstallation() {
	const homeDir = getHomeDir();
	const possiblePaths = [];

	if (homeDir) {
		// Standard PI installation locations
		possiblePaths.push(
			path.join(homeDir, ".pi", "agent", "npm", "node_modules"), // Linux/macOS default
			path.join(homeDir, ".pi", "node_modules"), // Alternative location
		);

		// pnpm global installations - check multiple versions
		collectPnpmGlobalNodeModules(
			path.join(homeDir, ".local", "share", "pnpm", "global"),
			possiblePaths,
		);

		// bun global installation
		const bunGlobalPath = path.join(homeDir, ".bun", "install", "global", "node_modules");
		if (fs.existsSync(bunGlobalPath)) {
			possiblePaths.push(bunGlobalPath);
		}

		// Windows installation locations
		possiblePaths.push(
			path.join(homeDir, "AppData", "Roaming", "pi", "agent", "npm", "node_modules"),
			path.join(homeDir, "AppData", "Local", "pi", "agent", "npm", "node_modules"),
		);

		// Windows pnpm global installations (versioned dirs like Linux)
		collectPnpmGlobalNodeModules(
			path.join(homeDir, "AppData", "Local", "pnpm", "global"),
			possiblePaths,
		);

		// Windows Roaming pnpm (less common, flat structure)
		possiblePaths.push(
			path.join(homeDir, "AppData", "Roaming", "pnpm", "global", "node_modules"),
		);

		// Check mise installations (covers installs where the 'pi' binary is not on
		// PATH seen by VS Code, e.g. launched from desktop dock instead of terminal)
		const miseInstallsBase = path.join(homeDir, ".local", "share", "mise", "installs");
		if (fs.existsSync(miseInstallsBase)) {
			try {
				for (const category of fs.readdirSync(miseInstallsBase)) {
					// Only scan tool categories that match the PI CLI package name.
					// Version subdirectories (e.g. "0.85.1", "latest") do not repeat
					// the tool name, so the filter must be on the category, not the entry.
					if (!category.includes("pi-coding-agent")) continue;
					const categoryPath = path.join(miseInstallsBase, category);
					// statSync must be INSIDE a per-category guard: a single broken
					// symlink or unreadable entry must not abort the whole scan.
					try {
						if (!fs.statSync(categoryPath).isDirectory()) continue;
					} catch (_e) {
						continue; // unreadable category — try the next one
					}

					// Each entry (e.g. "0.85.1", "latest") IS a version directory.
					// node_modules/ is a direct child of the version dir, not nested.
					// Wrap in try-catch so a single bad version dir doesn't abort the scan.
					try {
						for (const entry of fs.readdirSync(categoryPath)) {
							const entryPath = path.join(categoryPath, entry);
							if (!fs.statSync(entryPath).isDirectory()) continue;
							const nmEntry = path.join(entryPath, "node_modules");
							if (fs.existsSync(nmEntry) && fs.statSync(nmEntry).isDirectory()) {
								possiblePaths.push(nmEntry);
								// Also check .mise subdirectory (aube-bin-shim layout:
								// node_modules/.mise/@earendil-works+pi-coding-agent@ver/node_modules/)
								const miseSubdir = path.join(nmEntry, ".mise");
								if (fs.existsSync(miseSubdir)) {
									for (const miseEntry of fs.readdirSync(miseSubdir)) {
										if (!miseEntry.includes("pi-coding-agent")) continue;
										const miseEntryPath = path.join(miseSubdir, miseEntry);
										if (!fs.statSync(miseEntryPath).isDirectory()) continue;
										for (const subVer of fs.readdirSync(miseEntryPath)) {
											const subNodeModules = path.join(
												miseEntryPath,
												subVer,
												"node_modules",
											);
											if (fs.existsSync(subNodeModules)) {
												possiblePaths.push(subNodeModules);
											}
										}
									}
								}
							}
						}
					} catch (_e) {
						// Ignore errors from scanning this category; try next category
					}
				}
			} catch (_e) {
				// Ignore errors from mise directory scanning
			}
		}
	}

	// Check environment variable overrides (below the user setting, above the
	// generic filesystem candidates).
	if (process.env.PI_AGENT_DIR) {
		possiblePaths.unshift(path.join(process.env.PI_AGENT_DIR, "npm", "node_modules"));
		possiblePaths.unshift(path.join(process.env.PI_AGENT_DIR, "node_modules"));
	}

	if (process.env.PI_HOME) {
		possiblePaths.unshift(path.join(process.env.PI_HOME, "agent", "npm", "node_modules"));
		possiblePaths.unshift(path.join(process.env.PI_HOME, "node_modules"));
	}

	// Try each possible path. The user-configured binaryPath setting is resolved
	// last and unshifted, so it ends up at index 0 (highest priority).
	const settingSdkPath = findPiSdkFromSetting();
	if (settingSdkPath) {
		possiblePaths.unshift(settingSdkPath);
	}

	const attemptedPaths = [];
	const tryPaths = (paths) => {
		for (const piNodeModules of paths) {
			// A broken candidate (EACCES, ELOOP, ENOTDIR...) must only skip that
			// candidate, never abort the whole search with a raw stack trace.
			let found;
			try {
				found = findPiSdkAtPath(piNodeModules);
			} catch (_e) {
				found = null;
			}
			if (found) {
				return found;
			}
			attemptedPaths.push(piNodeModules);
		}
		return null;
	};

	let found = tryPaths(possiblePaths);

	// The probes below spawn subprocesses and block the extension host for up
	// to 3 × PATH_PROBE_TIMEOUT_MS, so they only run when every cheap
	// filesystem candidate missed.
	if (!found) {
		found = tryPaths(runGlobalRootProbes());
	}

	if (!found) {
		console.error("[PiLot] PI SDK not found. Tried the following paths:");
		for (const p of attemptedPaths) {
			console.error("  - " + p);
		}
		console.error("[PiLot] VS Code process PATH: " + (process.env.PATH || "(empty)"));
		return null;
	}
	return found;
}

/**
 * Find PI SDK by locating the 'pi' command in PATH and deriving the SDK location
 */
function findPiSdkFromCommand() {
	const isWindows = process.platform === "win32";

	try {
		let piPath;

		if (isWindows) {
			// Use 'where' on Windows (argv-array + timeout: never hangs activation)
			const probe = runProbeSync("where", ["pi"], PATH_PROBE_TIMEOUT_MS);
			piPath = probe.ok ? probe.stdout.split("\n")[0] : "";
		} else {
			// Use 'which' on Unix-like systems
			const probe = runProbeSync("which", ["pi"], PATH_PROBE_TIMEOUT_MS);
			piPath = probe.ok ? probe.stdout.split("\n")[0] : "";
		}

		if (!piPath || !fs.existsSync(piPath)) {
			console.error("[PiLot] 'which pi' / 'where pi' did not find 'pi' on PATH");
			console.error("[PiLot]   VS Code process PATH: " + (process.env.PATH || "(empty)"));
			return null;
		}

		// Skip workspace-local copies (e.g., node_modules/.bin/pi from devDependencies)
		// These may not match the user's global PI installation.
		const cwd = process.cwd();
		if (piPath.startsWith(cwd + path.sep)) {
			console.error("[PiLot] Skipping workspace-local 'pi' binary at: " + piPath);
			return null;
		}

		// Skip the mise binary shim (~/.local/share/mise/shims/pi) — it is a
		// symlink to the compiled mise binary itself, not a text script. We can't
		// derive the SDK path from it here; the installs-directory scan in
		// findGlobalPiInstallation() will find the actual install instead.
		try {
			if (fs.lstatSync(piPath).isSymbolicLink()) {
				const resolved = fs.realpathSync(piPath);
				const baseName = path.basename(resolved).toLowerCase();
				if (baseName === "mise" || baseName === "mise.exe") {
					console.error("[PiLot] Skipping mise binary shim (not a text shim): " + piPath);
					return null;
				}
			}
		} catch (_e) {
			// lstat/realpath failed — fall through and let deriveSdkPathFromBinary try
		}

		// The pi executable reference is typically at:
		// - npm: ~/.nvm/versions/node/.../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
		// - pnpm shim: ~/.local/share/pnpm/bin/pi (shell script with # cmd-shim-target)
		// - mise install dir: ~/.local/share/mise/installs/.../node_modules/.bin/pi (aube-bin-shim text script)
		// - mise shim dir: ~/.local/share/mise/shims/pi (symlink to compiled mise binary — skipped above)
		// - bun: ~/.bun/bin/pi (shim that runs: bun <path>)

		// For pnpm, the shim contains # cmd-shim-target=... pointing to the actual CLI
		// For npm/pnpm, it might also contain exec "..." lines with the actual path
		// For mise (install dir), the shim contains # aube-bin-shim v2 target=... pointing to the CLI
		// Binary files (e.g. compiled mise binary shim in ~/.local/share/mise/shims/)
		// throw from readFileSync("utf8") and are silently skipped here — they are
		// handled upstream by the null return from findPiSdkFromCommand().

		const result = deriveSdkPathFromBinary(piPath);
		if (!result) {
			console.error("[PiLot] Found 'pi' at: " + piPath);
			console.error(
				"[PiLot] Could not derive SDK path from binary (unrecognized shim format)",
			);
		}
		return result;
	} catch (e) {
		// pi command not found
		console.error("[PiLot] 'which pi' / 'where pi' command failed (is 'pi' on your PATH?)");
		console.error("[PiLot]   VS Code process PATH: " + (process.env.PATH || "(empty)"));
		console.error("[PiLot]   Error: " + (e instanceof Error ? e.message : String(e)));
		return null;
	}
}

/**
 * Try to find the PI SDK by reading the pi-agent.binaryPath VS Code setting.
 * This respects the user-configured path when 'pi' is not on PATH.
 */
function findPiSdkFromSetting() {
	try {
		const vscode = require("vscode");
		const config = vscode.workspace.getConfiguration("pi-agent");
		const rawPath = config.get("binaryPath", "pi");
		if (!rawPath || rawPath.trim() === "pi") {
			return null; // Default value, not a custom path
		}

		const trimmed = rawPath.trim();

		// Only handle absolute paths — relative paths are ambiguous without workspace context
		if (!path.isAbsolute(trimmed)) {
			return null;
		}

		if (!fs.existsSync(trimmed)) {
			return null;
		}

		// Try the same derivation logic as findPiSdkFromCommand
		return deriveSdkPathFromBinary(trimmed);
	} catch (e) {
		// VS Code not available yet or config read failed
		return null;
	}
}

/**
 * Derive the PI SDK node_modules path from a binary path.
 * Shared by findPiSdkFromCommand and findPiSdkFromSetting.
 */
function deriveSdkPathFromBinary(piPath) {
	// Try to parse as a text script (shim, .cmd, .js wrapper)
	try {
		const content = fs.readFileSync(piPath, "utf8");

		// Check for pnpm cmd-shim-target comment (Unix pnpm)
		const cmdShimMatch = content.match(/# cmd-shim-target=(.+)/);
		if (cmdShimMatch) {
			let targetPath = cmdShimMatch[1].trim();
			const sdkNodeModules = extractNodeModulesPath(targetPath);
			if (
				sdkNodeModules &&
				fs.existsSync(path.join(sdkNodeModules, "@earendil-works", "pi-coding-agent"))
			) {
				return sdkNodeModules;
			}
		}

		// Check for aube-bin-shim target comment (mise, bun-managed installs)
		// Format: # aube-bin-shim v2 target=../.mise/@earendil-works+pi-coding-agent@0.85.1/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
		const aubeMatch = content.match(/#\s*aube-bin-shim\s+v\d+\s+target=(.+)/);
		if (aubeMatch) {
			const targetPath = aubeMatch[1].trim();
			// Resolve relative to the shim file's real directory (follows symlinks
			// so "latest" style symlinks resolve to the real version path)
			const realPiPath = fs.realpathSync(piPath);
			const resolvedTarget = path.resolve(path.dirname(realPiPath), targetPath);
			const sdkNodeModules = extractNodeModulesPath(resolvedTarget);
			if (
				sdkNodeModules &&
				fs.existsSync(path.join(sdkNodeModules, "@earendil-works", "pi-coding-agent"))
			) {
				return sdkNodeModules;
			}
		}

		// Check pnpm exec line
		const pnpmExecMatch = content.match(/node_modules[^'"]*pi-coding-agent[^'"]*cli\.js/);
		if (pnpmExecMatch) {
			const fullMatch = pnpmExecMatch[0];
			// Resolve relative path fragments relative to the binary's directory
			const resolvedPath = path.isAbsolute(fullMatch)
				? fullMatch
				: path.resolve(path.dirname(piPath), fullMatch);
			const sdkNodeModules = extractNodeModulesPath(resolvedPath);
			if (
				sdkNodeModules &&
				fs.existsSync(path.join(sdkNodeModules, "@earendil-works", "pi-coding-agent"))
			) {
				return sdkNodeModules;
			}
		}

		// Derive node_modules path from the CLI location (for direct JS files)
		// cli.js is at: .../node_modules/@earendil-works/pi-coding-agent/dist/cli.js
		const normalizedPiPath = piPath.replace(/\\/g, "/");
		const distIndex = normalizedPiPath.indexOf("/dist/");
		if (distIndex > 0) {
			const nodeModulesPath = piPath.substring(0, distIndex);
			if (fs.existsSync(path.join(nodeModulesPath, "@earendil-works", "pi-coding-agent"))) {
				return nodeModulesPath;
			}
		}
	} catch (_e) {
		// Binary is not a text file (e.g. native .exe) — fall through to directory checks
	}

	// For .exe/.cmd binaries on Windows, try to find sibling node_modules
	try {
		const binDir = path.dirname(piPath);
		const parentDir = path.dirname(binDir);
		for (const candidate of [binDir, parentDir]) {
			const sdkPath = path.join(
				candidate,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
			);
			if (fs.existsSync(sdkPath)) {
				return path.join(candidate, "node_modules");
			}
		}
	} catch (_e) {
		// Directory access failed
	}

	return null;
}

/**
 * Extract node_modules path from a PI CLI path string
 * Input:  ~/.local/share/pnpm/global/v11/.../node_modules/@earendil-works/pi-coding-agent/dist/cli.js
 * Output: ~/.local/share/pnpm/global/v11/.../node_modules
 */
function extractNodeModulesPath(cliPath) {
	if (!cliPath) return null;
	// Find the position of /node_modules/ or \node_modules\ (Windows)
	const normalized = cliPath.replace(/\\/g, "/");
	// Use lastIndexOf to handle nested node_modules structures (e.g., mise
	// installs where the SDK lives under .../node_modules/.mise/.../node_modules/
	// instead of the outer .../node_modules/).
	const nodeModulesIdx = normalized.lastIndexOf("/node_modules/");
	if (nodeModulesIdx >= 0) {
		return cliPath.substring(0, nodeModulesIdx + "/node_modules".length);
	}
	return null;
}

/**
 * Hook Node.js module resolution to bypass the ESM-only exports map
 * of @earendil-works/pi-coding-agent (and related packages).
 *
 * The package declares "exports" with only an "import" condition, which
 * causes CJS require() to fail with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * We intercept the request and resolve directly to the package's main file
 * or sub-path, bypassing the exports map entirely. Node.js 22+'s native
 * require(esm) then loads the ESM module correctly.
 *
 * This also handles sub-path imports like
 * @earendil-works/pi-coding-agent/package.json which the extension uses
 * via require.resolve().
 */
function hookModuleResolution(piNodeModules) {
	// Guard against double-hooking: the extension host can reload this module
	// (hot restart), and re-capturing our own wrapper would build an unbounded
	// chain of resolvers that slows every require() in the host.
	if (Module._resolveFilename.__pillotHooked) {
		// Already hooked: just re-point the existing hook at the SDK found this
		// time, otherwise a stale install path stays pinned in the old closure
		// after a reload picks up a different install.
		Module._resolveFilename.__pillotSdkRoot = piNodeModules;
		return;
	}
	const originalResolveFilename = Module._resolveFilename;

	const hooked = function (request, parent, isMain, options) {
		// Intercept @earendil-works/* packages, resolve from global PI install.
		if (request.startsWith("@earendil-works/")) {
			const resolved = resolveSdkRequest(hooked.__pillotSdkRoot, request);
			if (resolved) {
				return resolved;
			}
			// Unresolvable or traversal attempt: fall through to Node's normal
			// resolution, which produces its own (correctly scoped) error.
		}
		return originalResolveFilename.call(this, request, parent, isMain, options);
	};
	hooked.__pillotHooked = true;
	hooked.__pillotSdkRoot = piNodeModules;
	Module._resolveFilename = hooked;
}

/**
 * Read a package.json and produce the ordered list of entry-point candidates
 * for a bare `@earendil-works/*` import: exports map ("." entry, then its
 * require/import/default conditions), then "main", then the historical
 * dist/index.js guess. Returns an empty array when the manifest is unreadable.
 *
 * Results are memoized per package directory: every intercepted require()
 * would otherwise re-read and re-parse the same manifest for the lifetime
 * of the process, even though the result never changes.
 */
const bareImportCache = new Map();

function exportsDotEntryTargets(dotEntry) {
	if (typeof dotEntry === "string") return [dotEntry];
	if (dotEntry && typeof dotEntry === "object") {
		return ["require", "import", "default"]
			.filter((cond) => typeof dotEntry[cond] === "string")
			.map((cond) => dotEntry[cond]);
	}
	return [];
}

function exportsMapTargets(exportsMap) {
	if (typeof exportsMap === "string") return [exportsMap];
	if (exportsMap && typeof exportsMap === "object") {
		return exportsDotEntryTargets(exportsMap["."]);
	}
	return [];
}

function bareImportCandidates(pkgDir) {
	const cached = bareImportCache.get(pkgDir);
	if (cached) return cached;
	let candidates = [];
	try {
		const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
		const targets = exportsMapTargets(pkgJson.exports);
		if (typeof pkgJson.main === "string") targets.push(pkgJson.main);
		targets.push("dist/index.js");
		candidates = targets;
	} catch (_e) {
		// Unreadable/broken package.json: fall through with the empty list.
	}
	bareImportCache.set(pkgDir, candidates);
	return candidates;
}

/**
 * Resolve a bare `@earendil-works/*` import to its entry file within pkgDir,
 * or null when no candidate exists on disk.
 */
function resolveBareImport(pkgDir) {
	for (const target of bareImportCandidates(pkgDir)) {
		const candidate = path.resolve(pkgDir, target);
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Resolve a sub-path import (`@earendil-works/pkg/sub`) inside pkgDir.
 * Refuses traversal: a request like `pkg/../../x` returns null instead of a
 * path outside the package directory — including when a symlink inside the
 * package directory points elsewhere (pnpm/mise installs are symlink farms).
 */
function resolveSubPathImport(pkgDir, subPath) {
	const resolvedPath = path.resolve(pkgDir, subPath);
	// path.relative is case-insensitive on Windows/macOS where startsWith
	// (case-sensitive) could be bypassed by differing path casing.
	const rel = path.relative(pkgDir, resolvedPath);
	if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
		return null; // traversal attempt
	}
	if (fs.existsSync(resolvedPath)) {
		if (fs.statSync(resolvedPath).isDirectory()) {
			const indexPath = path.join(resolvedPath, "index.js");
			// A directory without index.js must fail resolution cleanly, not come
			// back as a directory path that Module._load reads as a file (EISDIR).
			return fs.existsSync(indexPath) ? indexPath : null;
		}
		// Validate containment on the REAL path: the lexical check above passes
		// for a symlink inside pkgDir whose target is outside it.
		let realTarget;
		let realRoot;
		try {
			realTarget = fs.realpathSync(resolvedPath);
			realRoot = fs.realpathSync(pkgDir);
		} catch (_e) {
			return null; // cannot prove containment
		}
		const realRel = path.relative(realRoot, realTarget);
		if (realRel === ".." || realRel.startsWith(".." + path.sep) || path.isAbsolute(realRel)) {
			return null; // traversal attempt via symlink
		}
		return resolvedPath;
	}
	const withJs = resolvedPath + ".js";
	return fs.existsSync(withJs) ? withJs : null;
}

/**
 * Resolve an `@earendil-works/*` request against the global PI install.
 * Returns the absolute file path, or null when the request cannot be served
 * from this install (caller falls back to Node's normal resolution).
 */
function resolveSdkRequest(piNodeModules, request) {
	if (!piNodeModules) return null;
	const parts = request.split("/");
	if (parts.length < 2) return null;
	// Reject traversal at parse time (defense-in-depth): `@earendil-works/../../etc`
	// must not build a pkgDir outside piNodeModules.
	for (const part of parts) {
		if (part === "" || part === "." || part === "..") return null;
	}
	const pkgDir = path.join(piNodeModules, parts[0], parts[1]);
	if (!fs.existsSync(pkgDir)) return null;
	if (parts.length === 2) {
		return resolveBareImport(pkgDir);
	}
	return resolveSubPathImport(pkgDir, parts.slice(2).join("/"));
}

/**
 * Loading the bundle pulls in the PI SDK's ESM entry via require(esm), which
 * only works on Node.js >= 22.12. Detect the capability up front so the user
 * gets an actionable error instead of a bare ERR_REQUIRE_ESM from deep inside
 * the require() below.
 */
function assertRequireEsmSupported() {
	if ((process.features && process.features.require_module) === true) return;
	const nodeVersion = process.versions.node || "0.0.0";
	const [major, minor] = nodeVersion.split(".").map(Number);
	if (major > 22 || (major === 22 && minor >= 12)) return;
	throw new Error(
		"PiLot Studio requires an extension host with Node.js 22.12+ (require(ESM) support). " +
			"Running Node.js " +
			nodeVersion +
			". Please update VS Code.",
	);
}

/**
 * Main loader function
 */
function load() {
	const piNodeModules = findGlobalPiInstallation();

	if (!piNodeModules) {
		// PI SDK not found - show helpful error when activate() is called
		return {
			activate(_context) {
				const vscode = require("vscode");
				const platform = process.platform;
				const isWindows = platform === "win32";

				const installInstructions =
					"1. Open PowerShell or Command Prompt\n" +
					"2. Run: " +
					PI_SDK_INSTALL_COMMAND +
					"\n" +
					"3. Restart VS Code";

				const message =
					"PiLot Studio requires PI CLI to be installed.\n\n" +
					"Installation steps:\n" +
					installInstructions +
					"\n\nIf 'pi' works in a terminal but not here, VS Code may not see your PATH.\n" +
					"Try launching VS Code from a terminal ('code .' from your project dir),\n" +
					"or set pi-agent.binaryPath in VS Code settings to the full path from 'which pi'.\n\n" +
					"Or visit the documentation for alternative installation methods.";

				// void + catch: a rejected dialog promise (host shutting down) must
				// not surface as an unhandled rejection.
				void vscode.window
					.showErrorMessage(message, "Open Documentation", "Copy Install Command")
					.then(function (selection) {
						if (selection === "Open Documentation") {
							vscode.env.openExternal(vscode.Uri.parse(PI_SDK_DOCS_URL));
						} else if (selection === "Copy Install Command") {
							vscode.env.clipboard.writeText(PI_SDK_INSTALL_COMMAND);
							vscode.window.showInformationMessage(
								"Install command copied to clipboard!",
							);
						}
					})
					.catch(function () {
						/* dialog unavailable */
					});

				console.error("[PiLot] PI SDK not found. Searched locations:");
				console.error("  - ~/.pi/agent/npm/node_modules");
				console.error("  - ~/.pi/node_modules");
				if (isWindows) {
					console.error("  - %APPDATA%/pi/agent/npm/node_modules");
					console.error("  - %LOCALAPPDATA%/pi/agent/npm/node_modules");
				}
				console.error("  - ~/.local/share/pnpm/global/[version]/node_modules (pnpm)");
				console.error("  - ~/.bun/install/global/node_modules (bun)");
				console.error("  - npm global installation directory");
				console.error("  - pnpm global installation directory");
				console.error('  - "pi" command in PATH');
				console.error("  - PI_HOME and PI_AGENT_DIR environment variables");
				return { subscriptions: [] };
			},
			deactivate() {},
		};
	}

	// NOTE: runs before VS Code extension host — no logDebug() available here.
	console.log("[PiLot] Using global PI SDK from: " + piNodeModules);

	// Add global PI node_modules to module resolution paths as secondary fallback.
	// Unshift only when absent: repeated activation previously grew the list and
	// re-injected the same path at a lower priority each time.
	if (!Module.globalPaths.includes(piNodeModules)) {
		Module.globalPaths.unshift(piNodeModules);
	}

	// Hook module resolution to bypass ESM-only exports map
	hookModuleResolution(piNodeModules);

	// The bundled extension requires the PI SDK's ESM entry via require(esm).
	assertRequireEsmSupported();

	// Load the CJS extension bundle
	try {
		const extension = require("./extension.cjs");
		return extension;
	} catch (error) {
		console.error("[PiLot] Failed to load extension:", error);

		return {
			activate(_context) {
				const vscode = require("vscode");
				// A thrown string/object has no .message — stringify defensively.
				const detail = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(
					"PiLot Studio failed to load: " +
						detail +
						"\n\nCheck the developer console for details.",
				);
				return { subscriptions: [] };
			},
			deactivate() {},
		};
	}
}

// Export the loader
module.exports = load();
