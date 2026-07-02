import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { readPackageManifest } from "../../../pi-binary.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResourceLoader(opts: {
	skills?: any[];
	extensions?: any[];
	prompts?: any[];
	throwOnSkills?: boolean;
	throwOnExtensions?: boolean;
	throwOnPrompts?: boolean;
}) {
	const {
		skills = [],
		extensions = [],
		prompts = [],
		throwOnSkills = false,
		throwOnExtensions = false,
		throwOnPrompts = false,
	} = opts;

	return {
		getSkills: () => {
			if (throwOnSkills) throw new Error("skills boom");
			return { skills };
		},
		getExtensions: () => {
			if (throwOnExtensions) throw new Error("extensions boom");
			return { extensions };
		},
		getPrompts: () => {
			if (throwOnPrompts) throw new Error("prompts boom");
			return { prompts };
		},
	};
}

function makeSkill(skill: {
	name?: string;
	description?: string;
	sourceInfo?: { source?: string };
}) {
	return {
		name: skill.name ?? "",
		description: skill.description ?? "",
		sourceInfo: skill.sourceInfo ?? {},
	};
}

function makeExtension(ext: {
	path?: string;
	sourceInfo?: { source?: string };
}) {
	return {
		path: ext.path ?? "",
		sourceInfo: ext.sourceInfo ?? {},
	};
}

function makePrompt(prompt: {
	name?: string;
	description?: string;
	sourceInfo?: { source?: string };
}) {
	return {
		name: prompt.name ?? "",
		description: prompt.description ?? "",
		sourceInfo: prompt.sourceInfo ?? {},
	};
}

function makeInstalledPackage(pkg: { source: string; path: string }) {
	return { source: pkg.source, path: pkg.path };
}

function createDeps(opts?: {
	resourceLoader?: any;
	configuredPackages?: any[];
	binaryService?: any;
	notifyWebviewMessages?: any[];
}) {
	const _notifyWebviewMessages: any[] = (opts?.notifyWebviewMessages ?? []);
	const _logDebugMessages: any[][] = [];
	const _logErrorMessages: any[][] = [];

	const deps: any = {
		getResourceLoader: () => opts?.resourceLoader,
		getConfiguredPackages: () => opts?.configuredPackages ?? [],
		binaryService: opts?.binaryService ?? { getBinaryPath: () => "pi" },
		notifyWebview: (message: any) => _notifyWebviewMessages.push(message),
		logDebug: (...details: any[]) => _logDebugMessages.push(details),
		logError: (...details: any[]) => _logErrorMessages.push(details),
	};

	return {
		deps,
		notifyWebviewMessages: _notifyWebviewMessages,
		logDebugMessages: _logDebugMessages,
		logErrorMessages: _logErrorMessages,
	};
}

async function requirePackageManager(deps: any) {
	const { PackageManager } = await import("../../../package-manager.js");
	return new PackageManager(deps);
}

function writeManifest(dir: string, description: string, version: string): string {
	const pkgDir = fs.mkdtempSync(path.join(dir, "pkg-"));
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: "test-pkg", description, version }),
	);
	return pkgDir;
}

// ---------------------------------------------------------------------------
// enrichPackages
// ---------------------------------------------------------------------------

suite("PackageManager: enrichPackages", () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-enrich-"));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns empty array for empty packages input", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);
		const result = pm.enrichPackages([]);
		assert.deepStrictEqual(result, []);
	});

	test("returns enriched packages when resource loader provides skills, extensions, and prompts", async () => {
		const pkgDir = writeManifest(tmpDir, "my desc", "1.2.3");

		const loader = makeResourceLoader({
			skills: [
				makeSkill({
					name: "skill-a",
					description: "skill desc",
					sourceInfo: { source: "my-source" },
				}),
			],
			extensions: [
				makeExtension({
					path: "ext-a.ts",
					sourceInfo: { source: "my-source" },
				}),
			],
			prompts: [
				makePrompt({
					name: "prompt-a",
					description: "prompt desc",
					sourceInfo: { source: "my-source" },
				}),
			],
		});

		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "my-source", path: pkgDir }),
		]);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].description, "my desc");
		assert.strictEqual(result[0].version, "1.2.3");
		assert.deepStrictEqual(result[0].types, ["extensions", "skills", "prompts"]);
		assert.deepStrictEqual(result[0].skills, [
			{ name: "skill-a", description: "skill desc" },
		]);
		assert.deepStrictEqual(result[0].extensions, [
			{ path: "ext-a.ts", sourceName: "my-source" },
		]);
		assert.deepStrictEqual(result[0].prompts, [
			{ name: "prompt-a", description: "prompt desc" },
		]);
	});

	test("returns packages with empty extra fields when no resources match source", async () => {
		const pkgDir = writeManifest(tmpDir, "desc", "1.0.0");

		const loader = makeResourceLoader({
			skills: [
				makeSkill({
					name: "other",
					description: "other desc",
					sourceInfo: { source: "other-src" },
				}),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "my-source", path: pkgDir }),
		]);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].types.length, 0);
		assert.deepStrictEqual(result[0].skills, []);
		assert.deepStrictEqual(result[0].extensions, []);
		assert.deepStrictEqual(result[0].prompts, []);
	});

	test("matching resource source comparison is case-insensitive", async () => {
		const pkgDir = writeManifest(tmpDir, "d", "1");

		const loader = makeResourceLoader({
			skills: [
				makeSkill({
					name: "s",
					description: "d",
					sourceInfo: { source: "My-Source" },
				}),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "my-source", path: pkgDir }),
		]);

		assert.strictEqual(result[0].skills.length, 1);
		assert.strictEqual(result[0].skills[0].name, "s");
	});

	test("returns packages with empty description/version when manifest is missing", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src", path: "/nonexistent/pkg" }),
		]);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].description, "");
		assert.strictEqual(result[0].version, "");
		assert.strictEqual(result[0].types.length, 0);
	});

	test("handles getSkills throwing by falling back to empty skill list", async () => {
		const pkgDir = writeManifest(tmpDir, "d", "1.0.0");

		const loader = makeResourceLoader({
			throwOnSkills: true,
			extensions: [
				makeExtension({
					path: "e",
					sourceInfo: { source: "src" },
				}),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src", path: pkgDir }),
		]);

		assert.strictEqual(result[0].skills.length, 0);
		assert.strictEqual(result[0].extensions.length, 1);
	});

	test("handles getExtensions throwing by falling back to empty extension list", async () => {
		const pkgDir = writeManifest(tmpDir, "d", "1.0.0");

		const loader = makeResourceLoader({
			throwOnExtensions: true,
			skills: [
				makeSkill({
					name: "s",
					description: "d",
					sourceInfo: { source: "src" },
				}),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src", path: pkgDir }),
		]);

		assert.strictEqual(result[0].skills.length, 1);
		assert.strictEqual(result[0].extensions.length, 0);
	});

	test("handles getPrompts throwing by falling back to empty prompt list", async () => {
		const pkgDir = writeManifest(tmpDir, "d", "1.0.0");

		const loader = makeResourceLoader({
			throwOnPrompts: true,
			skills: [
				makeSkill({
					name: "s",
					description: "d",
					sourceInfo: { source: "src" },
				}),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src", path: pkgDir }),
		]);

		assert.strictEqual(result[0].skills.length, 1);
		assert.strictEqual(result[0].prompts.length, 0);
	});

	test("handles resource loader returning undefined getters via destructuring fallback", async () => {
		const pkgDir = writeManifest(tmpDir, "d", "1.0.0");

		const brokenLoader: any = {
			getSkills: () => undefined,
			getExtensions: () => undefined,
			getPrompts: () => undefined,
		};
		const { deps } = createDeps({ resourceLoader: brokenLoader });
		const pm = await requirePackageManager(deps);

		assert.doesNotThrow(() => {
			pm.enrichPackages([
				makeInstalledPackage({ source: "src", path: pkgDir }),
			]);
		});
	});

	test("handles null/undefined resource loader without throwing", async () => {
		const { deps } = createDeps({ resourceLoader: undefined });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src", path: "/nonexistent" }),
		]);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].skills.length, 0);
	});

	test("round-trips source and path through the enriched package output", async () => {
		const pkgDir = writeManifest(tmpDir, "desc", "v");

		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src-a", path: pkgDir }),
			makeInstalledPackage({ source: "src-b", path: "/other/path" }),
		]);

		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].source, "src-a");
		assert.strictEqual(result[0].path, pkgDir);
		assert.strictEqual(result[0].description, "desc");
		assert.strictEqual(result[0].version, "v");
		assert.strictEqual(result[1].source, "src-b");
		assert.strictEqual(result[1].path, "/other/path");
		assert.strictEqual(result[1].description, "");
		assert.strictEqual(result[1].version, "");
	});

	test("matches resources independently for packages with different (but case-matched) sources", async () => {
		const pkgDirA = writeManifest(tmpDir, "desc-a", "1.0.0");
		const pkgDirB = writeManifest(tmpDir, "desc-b", "2.0.0");

		const loader = makeResourceLoader({
			skills: [
				makeSkill({ name: "skill-a", sourceInfo: { source: "src-a" } }),
				makeSkill({ name: "skill-b", sourceInfo: { source: "src-b" } }),
			],
		});
		const { deps } = createDeps({ resourceLoader: loader });
		const pm = await requirePackageManager(deps);

		const result = pm.enrichPackages([
			makeInstalledPackage({ source: "src-a", path: pkgDirA }),
			makeInstalledPackage({ source: "src-b", path: pkgDirB }),
		]);

		assert.strictEqual(result[0].skills[0].name, "skill-a");
		assert.strictEqual(result[1].skills[0].name, "skill-b");
		assert.deepStrictEqual(result[0].extensions, []);
		assert.deepStrictEqual(result[1].extensions, []);
	});
});

// ---------------------------------------------------------------------------
// listPackages
// ---------------------------------------------------------------------------

suite("PackageManager: listPackages", () => {
	test("returns enriched configured packages when any are configured", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-lp-cfg-"));
		const pkgDir = path.join(tmpDir, "cfg-pkg");
		fs.mkdirSync(pkgDir);
		fs.writeFileSync(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ name: "cfg-pkg", description: "configured desc", version: "5.0.0" }),
		);

		const configuredPkgs = [
			makeInstalledPackage({ source: "cfg-src", path: pkgDir }),
		];
		const { deps } = createDeps({ configuredPackages: configuredPkgs });
		const pm = await requirePackageManager(deps);

		const result = await pm.listPackages();
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "cfg-src");
		assert.strictEqual(result[0].description, "configured desc");
		assert.strictEqual(result[0].version, "5.0.0");

		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("falls back to listPackagesFromCli when no configured packages are present", async () => {
		const cliPkgs = [
			makeInstalledPackage({ source: "cli-src", path: "/cli/path" }),
		];
		const { deps } = createDeps({ configuredPackages: [] });
		const pm = await requirePackageManager(deps);
		(pm as any).listPackagesFromCli = async () => cliPkgs;

		const result = await pm.listPackages();
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "cli-src");
		assert.strictEqual(result[0].path, "/cli/path");
	});

	test("returns empty enriched array when configured packages absent and CLI returns empty", async () => {
		const { deps } = createDeps({ configuredPackages: [] });
		const pm = await requirePackageManager(deps);
		(pm as any).listPackagesFromCli = async () => [];

		const result = await pm.listPackages();
		assert.deepStrictEqual(result, []);
	});

	test("enriches configured packages from resource loader via listPackages path", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-cfg-enrich-"));
		const pkgDir = path.join(tmpDir, "cfg");
		fs.mkdirSync(pkgDir);
		fs.writeFileSync(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ name: "cfg", description: "env desc", version: "3" }),
		);

		const loader = makeResourceLoader({
			skills: [
				makeSkill({
					name: "cfg-skill",
					sourceInfo: { source: "cfg" },
				}),
			],
		});
		const configuredPkgs = [
			makeInstalledPackage({ source: "cfg", path: pkgDir }),
		];
		const { deps } = createDeps({ resourceLoader: loader, configuredPackages: configuredPkgs });
		const pm = await requirePackageManager(deps);

		const result = await pm.listPackages();
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].skills.length, 1);
		assert.strictEqual(result[0].description, "env desc");

		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// runPackageCommand
// ---------------------------------------------------------------------------

suite("PackageManager: runPackageCommand", () => {
	function createFakeProc() {
		const emitter = new (process.constructor as any)();
		return emitter;
	}

	test("resolves on exit code 0 and sends loading + packages-updated notifications", async () => {
		const { deps, notifyWebviewMessages } = createDeps({});
		const pm = await requirePackageManager(deps);

		const fakeProc = createFakeProc();
		fakeProc.stdout = process.stdin;
		fakeProc.stderr = process.stdin;
		let capturedCloseListener: (code: number) => void;
		fakeProc.on = (_event: string, listener: any) => {
			if (_event === "close") capturedCloseListener = listener;
			return fakeProc;
		};

		(pm as any).spawnPackageCommand = () => {
			process.nextTick(() => capturedCloseListener!(0));
			return fakeProc;
		};

		await assert.doesNotReject(() =>
			(pm as any).runPackageCommand(["install", "test-pkg"]),
		);

		const loadingMsgs = notifyWebviewMessages.filter(
			(m: any) => m.type === "loading",
		);
		assert.strictEqual(loadingMsgs.length, 2);
		assert.deepStrictEqual(loadingMsgs[0], { type: "loading", data: { loading: true } });
		assert.deepStrictEqual(loadingMsgs[1], { type: "loading", data: { loading: false } });
		assert.ok(
			notifyWebviewMessages.some((m: any) => m.type === "packages-updated"),
		);
	});

	test("rejects with 'Command failed' message when exit code is non-zero", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		const fakeProc = createFakeProc();
		fakeProc.stdout = process.stdin;
		fakeProc.stderr = process.stdin;
		let capturedCloseListener: (code: number) => void;
		fakeProc.on = (_event: string, listener: any) => {
			if (_event === "close") capturedCloseListener = listener;
			return fakeProc;
		};

		(pm as any).spawnPackageCommand = () => {
			process.nextTick(() => capturedCloseListener!(1));
			return fakeProc;
		};

		let error: Error | undefined;
		try {
			await (pm as any).runPackageCommand(["install", "bad-pkg"]);
		} catch (e) {
			if (e instanceof Error) error = e;
		}

		assert.ok(error, "expected runPackageCommand to throw on non-zero exit");
		assert.ok(error!.message.includes("Command failed with code 1"));
	});

	test("rejects with original error on process error event", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		const fakeProc = createFakeProc();
		fakeProc.stdout = process.stdin;
		fakeProc.stderr = process.stdin;
		let capturedErrorListener: (err: Error) => void;
		fakeProc.on = (_event: string, listener: any) => {
			if (_event === "error") capturedErrorListener = listener;
			return fakeProc;
		};

		(pm as any).spawnPackageCommand = () => {
			process.nextTick(() =>
				capturedErrorListener!(new Error("ENOENT: pi not found")),
			);
			return fakeProc;
		};

		let error: Error | undefined;
		try {
			await (pm as any).runPackageCommand(["remove", "pkg"]);
		} catch (e) {
			if (e instanceof Error) error = e;
		}

		assert.ok(error, "expected error on process error event");
		assert.strictEqual(error!.message, "ENOENT: pi not found");
	});

	test("relays stdout and stderr chunks to webview via notifyWebview", async () => {
		const { deps, notifyWebviewMessages } = createDeps({});
		const pm = await requirePackageManager(deps);

		const fakeProc = createFakeProc();
		const stdoutListeners: any[] = [];
		const stderrListeners: any[] = [];
		fakeProc.stdout = {
			on: (_event: string, cb: any) => {
				if (_event === "data") stdoutListeners.push(cb);
				return fakeProc;
			},
		};
		fakeProc.stderr = {
			on: (_event: string, cb: any) => {
				if (_event === "data") stderrListeners.push(cb);
				return fakeProc;
			},
		};

		let capturedCloseListener: (code: number) => void;
		fakeProc.on = (_event: string, listener: any) => {
			if (_event === "close") capturedCloseListener = listener;
			return fakeProc;
		};

		(pm as any).spawnPackageCommand = () => {
			process.nextTick(() => {
				for (const cb of stdoutListeners) cb("hello stdout\n");
				for (const cb of stderrListeners) cb("hello stderr\n");
				capturedCloseListener!(0);
			});
			return fakeProc;
		};

		await (pm as any).runPackageCommand(["install", "test-pkg"]);

		const outputMessages = notifyWebviewMessages.filter(
			(m: any) => m.type === "output",
		);
		assert.ok(outputMessages.length >= 2, "expected at least 2 output messages");
		const joinedText = outputMessages.map((m: any) => m.data?.text).join("");
		assert.ok(joinedText.includes("hello stdout"), "stdout should reach webview");
		assert.ok(joinedText.includes("hello stderr"), "stderr should reach webview");
	});
});

// ---------------------------------------------------------------------------
// installPackage / uninstallPackage / updatePackages
// ---------------------------------------------------------------------------

suite("PackageManager: installPackage / uninstallPackage / updatePackages", () => {
	test("installPackage forwards ['install', source] to runPackageCommand", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		let receivedArgs: string[] = [];
		(pm as any).runPackageCommand = (args: string[]) => {
			receivedArgs = args;
			return Promise.resolve();
		};

		await pm.installPackage("my-source");
		assert.deepStrictEqual(receivedArgs, ["install", "my-source"]);
	});

	test("uninstallPackage forwards ['remove', source] to runPackageCommand", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		let receivedArgs: string[] = [];
		(pm as any).runPackageCommand = (args: string[]) => {
			receivedArgs = args;
			return Promise.resolve();
		};

		await pm.uninstallPackage("my-source");
		assert.deepStrictEqual(receivedArgs, ["remove", "my-source"]);
	});

	test("updatePackages forwards ['update'] to runPackageCommand", async () => {
		const { deps } = createDeps({});
		const pm = await requirePackageManager(deps);

		let receivedArgs: string[] = [];
		(pm as any).runPackageCommand = (args: string[]) => {
			receivedArgs = args;
			return Promise.resolve();
		};

		await pm.updatePackages();
		assert.deepStrictEqual(receivedArgs, ["update"]);
	});
});

// ---------------------------------------------------------------------------
// readPackageManifest (direct exercise via pi-binary)
// ---------------------------------------------------------------------------

suite("PackageManager: readPackageManifest (direct pi-binary coverage)", () => {
	test("returns empty strings for a directory containing invalid JSON in package.json", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-pm-brk-"));
		fs.writeFileSync(path.join(tmpDir, "package.json"), "not-json {");
		try {
			const result = readPackageManifest(tmpDir);
			assert.deepStrictEqual(result, { description: "", version: "" });
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns empty version when version field is absent in manifest", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-pm-nover-"));
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "t", description: "d" }),
		);
		try {
			const result = readPackageManifest(tmpDir);
			assert.strictEqual(result.description, "d");
			assert.strictEqual(result.version, "");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns empty strings when description and version are non-string types", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-pm-badtype-"));
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "x", description: 123, version: true }),
		);
		try {
			const result = readPackageManifest(tmpDir);
			assert.strictEqual(result.description, "");
			assert.strictEqual(result.version, "");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
