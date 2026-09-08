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
	const directSdkPath = path.join(
		nodeModulesPath,
		"@earendil-works",
		"pi-coding-agent",
	);
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
					fs.existsSync(
						path.join(realNodeModules, "@earendil-works", "pi-coding-agent"),
					)
				) {
					return realNodeModules;
				}
			}
		} catch (e) {
			// Fall through to check original path
		}
		return nodeModulesPath;
	}

	// Check pnpm store symlinks (e.g., .pi-coding-agent-llEO51dR -> ../../store/v11/links/...)
	const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".pi-coding-agent-") && entry.isSymbolicLink()) {
			try {
				const linkTarget = fs.realpathSync(
					path.join(nodeModulesPath, entry.name),
				);
				// The real path points to the actual package in pnpm store
				const sdkNodeModules = path.join(
					linkTarget,
					"..",
					"..",
					"..",
					"..",
					"..",
					"node_modules",
				);
				if (fs.existsSync(sdkNodeModules)) {
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
 * Find the global PI installation directory
 * Checks multiple possible locations across different platforms and installation methods
 */
function findGlobalPiInstallation() {
	const homeDir = getHomeDir();
	const possiblePaths = [];

	// First, try to find via user-configured binary path setting (highest priority)
	const settingSdkPath = findPiSdkFromSetting();
	if (settingSdkPath) {
		possiblePaths.unshift(settingSdkPath);
	}

	// Then, try to find via 'pi' command in PATH
	const piSdkPath = findPiSdkFromCommand();
	if (piSdkPath) {
		possiblePaths.unshift(piSdkPath);
	}

	if (homeDir) {
		// Standard PI installation locations
		possiblePaths.push(
			path.join(homeDir, ".pi", "agent", "npm", "node_modules"), // Linux/macOS default
			path.join(homeDir, ".pi", "node_modules"), // Alternative location
		);

		// pnpm global installations - check multiple versions
		const pnpmGlobalBase = path.join(
			homeDir,
			".local",
			"share",
			"pnpm",
			"global",
		);
		if (fs.existsSync(pnpmGlobalBase)) {
			// pnpm v9+ uses v11 subdirectories with hashed folder names
			const pnpmVersionDirs = fs
				.readdirSync(pnpmGlobalBase)
				.filter((name) => name.startsWith("v") || /^\d+$/.test(name));
			for (const versionDir of pnpmVersionDirs) {
				const versionedPath = path.join(pnpmGlobalBase, versionDir);
				const entries = fs
					.readdirSync(versionedPath)
					.filter(
						(name) => name !== "pnpm-workspace.yaml" && !name.startsWith("."),
					);
				for (const hashDir of entries) {
					const nodeModulesPath = path.join(
						versionedPath,
						hashDir,
						"node_modules",
					);
					if (fs.existsSync(nodeModulesPath)) {
						possiblePaths.push(nodeModulesPath);
					}
				}
			}
		}

		// bun global installation
		const bunGlobalPath = path.join(
			homeDir,
			".bun",
			"install",
			"global",
			"node_modules",
		);
		if (fs.existsSync(bunGlobalPath)) {
			possiblePaths.push(bunGlobalPath);
		}

		// Windows installation locations
		possiblePaths.push(
			path.join(
				homeDir,
				"AppData",
				"Roaming",
				"pi",
				"agent",
				"npm",
				"node_modules",
			),
			path.join(
				homeDir,
				"AppData",
				"Local",
				"pi",
				"agent",
				"npm",
				"node_modules",
			),
		);

		// Windows pnpm global installations (versioned dirs like Linux)
		const pnpmWinBase = path.join(
			homeDir,
			"AppData",
			"Local",
			"pnpm",
			"global",
		);
		if (fs.existsSync(pnpmWinBase)) {
			const pnpmVersionDirs = fs
				.readdirSync(pnpmWinBase)
				.filter((name) => name.startsWith("v") || /^\d+$/.test(name));
			for (const versionDir of pnpmVersionDirs) {
				const versionedPath = path.join(pnpmWinBase, versionDir);
				const entries = fs
					.readdirSync(versionedPath)
					.filter(
						(name) => name !== "pnpm-workspace.yaml" && !name.startsWith("."),
					);
				for (const hashDir of entries) {
					const nodeModulesPath = path.join(
						versionedPath,
						hashDir,
						"node_modules",
					);
					if (fs.existsSync(nodeModulesPath)) {
						possiblePaths.push(nodeModulesPath);
					}
				}
			}
		}

		// Windows Roaming pnpm (less common, flat structure)
		possiblePaths.push(
			path.join(
				homeDir,
				"AppData",
				"Roaming",
				"pnpm",
				"global",
				"node_modules",
			),
		);
	}

	// Check environment variable overrides
	if (process.env.PI_AGENT_DIR) {
		possiblePaths.unshift(
			path.join(process.env.PI_AGENT_DIR, "npm", "node_modules"),
		);
		possiblePaths.unshift(path.join(process.env.PI_AGENT_DIR, "node_modules"));
	}

	if (process.env.PI_HOME) {
		possiblePaths.unshift(
			path.join(process.env.PI_HOME, "agent", "npm", "node_modules"),
		);
		possiblePaths.unshift(path.join(process.env.PI_HOME, "node_modules"));
	}

	// Check global npm installation
	try {
		const { execSync } = require("child_process");
		const npmRoot = execSync("npm root -g", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (npmRoot && fs.existsSync(npmRoot)) {
			possiblePaths.push(npmRoot);
		}
	} catch (e) {
		// npm not available or command failed, skip
	}

	// Check pnpm global root as fallback
	try {
		const { execSync } = require("child_process");
		const pnpmRoot = execSync("pnpm root -g", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (pnpmRoot && fs.existsSync(pnpmRoot)) {
			possiblePaths.push(pnpmRoot);
		}
	} catch (e) {
		// pnpm not available, skip
	}

	// Check mise installations (covers installs where the 'pi' binary is not on
	// PATH seen by VS Code, e.g. launched from desktop dock instead of terminal)
	if (homeDir) {
		const miseInstallsBase = path.join(
			homeDir,
			".local",
			"share",
			"mise",
			"installs",
		);
		if (fs.existsSync(miseInstallsBase)) {
			try {
				for (const category of fs.readdirSync(miseInstallsBase)) {
					// Only scan tool categories that match the PI CLI package name.
					// Version subdirectories (e.g. "0.85.1", "latest") do not repeat
					// the tool name, so the filter must be on the category, not the entry.
					if (!category.includes("pi-coding-agent")) continue;
					const categoryPath = path.join(miseInstallsBase, category);
					if (!fs.statSync(categoryPath).isDirectory()) continue;

					// Each entry (e.g. "0.85.1", "latest") IS a version directory.
					// node_modules/ is a direct child of the version dir, not nested.
					// Wrap in try-catch so a single bad version dir doesn't abort the scan.
					try {
						for (const entry of fs.readdirSync(categoryPath)) {
							const entryPath = path.join(categoryPath, entry);
							if (!fs.statSync(entryPath).isDirectory()) continue;
							const nmEntry = path.join(entryPath, "node_modules");
							if (
								fs.existsSync(nmEntry) &&
								fs.statSync(nmEntry).isDirectory()
							) {
								possiblePaths.push(nmEntry);
								// Also check .mise subdirectory (aube-bin-shim layout:
								// node_modules/.mise/@earendel-works+pi-coding-agent@ver/node_modules/)
								const miseSubdir = path.join(nmEntry, ".mise");
								if (fs.existsSync(miseSubdir)) {
									for (const miseEntry of fs.readdirSync(miseSubdir)) {
										if (!miseEntry.includes("pi-coding-agent")) continue;
										const miseEntryPath = path.join(
											miseSubdir,
											miseEntry,
										);
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

	// Try each possible path
	const attemptedPaths = [];
	for (const piNodeModules of possiblePaths) {
		const found = findPiSdkAtPath(piNodeModules);
		if (found) {
			return found;
		}
		attemptedPaths.push(piNodeModules);
	}

	console.error("[PiLot] PI SDK not found. Tried the following paths:");
	for (const p of attemptedPaths) {
		console.error("  - " + p);
	}
	console.error("[PiLot] VS Code process PATH: " + (process.env.PATH || "(empty)"));
	return null;
}

/**
 * Find PI SDK by locating the 'pi' command in PATH and deriving the SDK location
 */
function findPiSdkFromCommand() {
	const isWindows = process.platform === "win32";

	try {
		const { execSync } = require("child_process");
		let piPath;

		if (isWindows) {
			// Use 'where' on Windows
			piPath = execSync("where pi", {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			})
				.trim()
				.split("\n")[0];
		} else {
			// Use 'which' on Unix-like systems
			piPath = execSync("which pi", {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			})
				.trim()
				.split("\n")[0];
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
					console.error(
						"[PiLot] Skipping mise binary shim (not a text shim): " + piPath,
					);
					return null;
				}
			}
		} catch (_e) {
			// lstat/realpath failed — fall through and let deriveSdkPathFromBinary try
		}

		// The pi executable reference is typically at:
		// - npm: ~/.nvm/versions/node/.../lib/node_modules/@earendel-works/pi-coding-agent/dist/cli.js
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
			console.error("[PiLot] Could not derive SDK path from binary (unrecognized shim format)");
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
				fs.existsSync(
					path.join(sdkNodeModules, "@earendil-works", "pi-coding-agent"),
				)
			) {
				return sdkNodeModules;
			}
		}

		// Check for aube-bin-shim target comment (mise, bun-managed installs)
		// Format: # aube-bin-shim v2 target=../.mise/@earendel-works+pi-coding-agent@0.85.1/node_modules/@earendel-works/pi-coding-agent/dist/bundle/cli.js
		const aubeMatch = content.match(/#\s*aube-bin-shim\s+v\d+\s+target=(.+)/);
		if (aubeMatch) {
			const targetPath = aubeMatch[1].trim();
			// Resolve relative to the shim file's real directory (follows symlinks
			// so "latest" style symlinks resolve to the real version path)
			const realPiPath = fs.realpathSync(piPath);
			const resolvedTarget = path.resolve(
				path.dirname(realPiPath),
				targetPath,
			);
			const sdkNodeModules = extractNodeModulesPath(resolvedTarget);
			if (
				sdkNodeModules &&
				fs.existsSync(
					path.join(sdkNodeModules, "@earendel-works", "pi-coding-agent"),
				)
			) {
				return sdkNodeModules;
			}
		}

		// Check pnpm exec line
		const pnpmExecMatch = content.match(
			/node_modules[^'"]*pi-coding-agent[^'"]*cli\.js/,
		);
		if (pnpmExecMatch) {
			const fullMatch = pnpmExecMatch[0];
			// Resolve relative path fragments relative to the binary's directory
			const resolvedPath = path.isAbsolute(fullMatch)
				? fullMatch
				: path.resolve(path.dirname(piPath), fullMatch);
			const sdkNodeModules = extractNodeModulesPath(resolvedPath);
			if (
				sdkNodeModules &&
				fs.existsSync(
					path.join(sdkNodeModules, "@earendil-works", "pi-coding-agent"),
				)
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
			if (
				fs.existsSync(
					path.join(nodeModulesPath, "@earendil-works", "pi-coding-agent"),
				)
			) {
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
	const originalResolveFilename = Module._resolveFilename;

	Module._resolveFilename = function (request, parent, isMain, options) {
		// Intercept @earendil-works/* packages, resolve from global PI install
		if (request.startsWith("@earendil-works/")) {
			const parts = request.split("/");
			if (parts.length >= 2) {
				const scope = parts[0];
				const name = parts[1];
				const pkgDir = path.join(piNodeModules, scope, name);

				if (fs.existsSync(pkgDir)) {
					if (parts.length === 2) {
						// Bare import: @earendil-works/pi-coding-agent
						// Bypass exports map, resolve directly to main file
						try {
							const pkgJson = JSON.parse(
								fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
							);
							const mainFile = path.resolve(
								pkgDir,
								pkgJson.main || "dist/index.js",
							);
							if (fs.existsSync(mainFile)) {
								return mainFile;
							}
						} catch (_e) {
							// Fall through to normal resolution
						}
					} else {
						// Sub-path: @earendil-works/pi-coding-agent/package.json
						const subPath = parts.slice(2).join("/");
						const resolvedPath = path.resolve(pkgDir, subPath);

						if (fs.existsSync(resolvedPath)) {
							const stat = fs.statSync(resolvedPath);
							if (stat.isDirectory()) {
								// Directory resolution: append /index.js
								const indexPath = path.join(resolvedPath, "index.js");
								if (fs.existsSync(indexPath)) {
									return indexPath;
								}
							}
							return resolvedPath;
						}

						// Non-existent sub-path, try appending .js extension
						const withJs = resolvedPath + ".js";
						if (fs.existsSync(withJs)) {
							return withJs;
						}
					}
				}
			}
		}

		return originalResolveFilename.call(this, request, parent, isMain, options);
	};
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

				let installInstructions;
				if (isWindows) {
					installInstructions =
						"1. Open PowerShell or Command Prompt\n" +
						"2. Run: npm install -g --ignore-scripts @earendil-works/pi-coding-agent\n" +
						"3. Restart VS Code";
				} else {
					installInstructions =
						"1. Open Terminal\n" +
						"2. Run: npm install -g --ignore-scripts @earendel-works/pi-coding-agent\n" +
						"3. Restart VS Code\n\n" +
						"If 'pi' works in Terminal but not here, VS Code may not see your PATH.\n" +
						"Try: launch VS Code from Terminal (run 'code .' from your project dir).\n" +
						"Alternatively, set pi-agent.binaryPath in VS Code settings to the full path from 'which pi'.";
				}

				const message =
					"PiLot Studio requires PI CLI to be installed.\n\n" +
					"Installation steps:\n" +
					installInstructions +
					"\n\n" +
					"Or visit the documentation for alternative installation methods.";

				vscode.window
					.showErrorMessage(
						message,
						"Open Documentation",
						"Copy Install Command",
					)
					.then(function (selection) {
						if (selection === "Open Documentation") {
							vscode.env.openExternal(
								vscode.Uri.parse(
									"https://github.com/earendil-works/pi-coding-agent",
								),
							);
						} else if (selection === "Copy Install Command") {
							vscode.env.clipboard.writeText(
								"npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
							);
							vscode.window.showInformationMessage(
								"Install command copied to clipboard!",
							);
						}
					});

				console.error("[PiLot] PI SDK not found. Searched locations:");
				console.error("  - ~/.pi/agent/npm/node_modules");
				console.error("  - ~/.pi/node_modules");
				if (isWindows) {
					console.error("  - %APPDATA%/pi/agent/npm/node_modules");
					console.error("  - %LOCALAPPDATA%/pi/agent/npm/node_modules");
				}
				console.error(
					"  - ~/.local/share/pnpm/global/[version]/node_modules (pnpm)",
				);
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

	// Add global PI node_modules to module resolution paths as secondary fallback
	Module.globalPaths.push(piNodeModules);

	// Hook module resolution to bypass ESM-only exports map
	hookModuleResolution(piNodeModules);

	// Load the CJS extension bundle
	try {
		const extension = require("./extension.cjs");
		return extension;
	} catch (error) {
		console.error("[PiLot] Failed to load extension:", error);

		return {
			activate(_context) {
				const vscode = require("vscode");
				vscode.window.showErrorMessage(
					"PiLot Studio failed to load: " +
						error.message +
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
