// Host-independent VS Code API facade for running the suite under plain Node
// (no Electron/VSCode host). See scripts/run-node-tests.mjs.
//
// The real `vscode` module only exists inside the VS Code extension host. The
// suite is written against a mutable facade (src/test/mocks/vscode-shim.ts)
// that reads `globalThis.__vscodeFacade`. Under the extension host that facade
// is seeded from the real API (src/test/suite/index.ts); under plain Node there
// is no real API, so this module builds a self-contained skeleton with working
// `Uri`/`EventEmitter` (the two APIs the SDK and production code rely on at
// import time) plus minimal stubs for the rest. Test setup (`resetVscodeMocks`)
// then fills in behaviour.
import { EventEmitter as NodeEventEmitter } from 'node:events';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

class FacadeUri {
	scheme: string;
	authority: string;
	path: string;
	query: string;
	fragment: string;

	constructor(
		scheme: string,
		authority: string,
		p: string,
		query: string,
		fragment: string,
	) {
		this.scheme = scheme;
		this.authority = authority;
		this.path = p;
		this.query = query;
		this.fragment = fragment;
	}

	get fsPath(): string {
		if (this.scheme !== 'file') return this.path;
		return fileURLToPath(this.toString());
	}

	toString(): string {
		let result = `${this.scheme}://${this.authority}${this.path}`;
		if (this.query) result += `?${this.query}`;
		if (this.fragment) result += `#${this.fragment}`;
		return result;
	}

	with(change: {
		scheme?: string;
		authority?: string;
		path?: string;
		query?: string;
		fragment?: string;
	}): FacadeUri {
		return new FacadeUri(
			change.scheme ?? this.scheme,
			change.authority ?? this.authority,
			change.path ?? this.path,
			change.query ?? this.query,
			change.fragment ?? this.fragment,
		);
	}

	static file(p: string): FacadeUri {
		return new FacadeUri('file', '', path.resolve(p), '', '');
	}

	static joinPath(base: FacadeUri, ...parts: string[]): FacadeUri {
		return new FacadeUri(
			base.scheme,
			base.authority,
			path.posix.join(base.path, ...parts),
			base.query,
			base.fragment,
		);
	}

	static parse(value: string): FacadeUri {
		try {
			const u = new URL(value);
			return new FacadeUri(
				u.protocol.replace(/:$/, ''),
				u.host,
				decodeURIComponent(u.pathname),
				u.search.replace(/^\?/, ''),
				u.hash.replace(/^#/, ''),
			);
		} catch {
			return new FacadeUri('file', '', value, '', '');
		}
	}
}

class FacadeEventEmitter<T> {
	private readonly emitter = new NodeEventEmitter();
	private readonly listeners = new Set<(e: T) => any>();
	readonly event = (listener: (e: T) => any): { dispose(): void } => {
		this.listeners.add(listener);
		this.emitter.on('e', listener as any);
		return { dispose: () => this.listeners.delete(listener) };
	};
	fire(data?: T): void {
		this.emitter.emit('e', data);
		for (const l of [...this.listeners]) {
			try {
				l(data as T);
			} catch {
				/* ignore */
			}
		}
	}
	dispose(): void {
		this.emitter.removeAllListeners();
		this.listeners.clear();
	}
}

class FacadeDisposable {
	private readonly callOnDispose: (() => any) | undefined;
	constructor(callOnDispose?: () => any) {
		this.callOnDispose = callOnDispose;
	}
	dispose(): void {
		this.callOnDispose?.();
	}
}

// VS Code `Event<T>` is a callable: `const d = onDidX(listener)`. It also
// exposes `.event` and (for tests) `.fire(data)`. Model that here.
function event<T = any>(): ((listener: (e: T) => any) => { dispose(): void }) & {
	event: (listener: (e: T) => any) => { dispose(): void };
	fire: (data?: T) => void;
} {
	const listeners = new Set<(e: T) => any>();
	const fn = ((listener: (e: T) => any) => {
		listeners.add(listener);
		return { dispose: () => listeners.delete(listener) };
	}) as any;
	fn.event = fn;
	fn.fire = (data?: T) => {
		for (const l of [...listeners]) {
			try {
				l(data as T);
			} catch {
				/* ignore */
			}
		}
	};
	return fn;
}

export function installVscodeFacade(): void {
	if ((globalThis as any).__vscodeFacade) return;
	const facade: Record<string, unknown> = {};
	facade.Uri = FacadeUri;
	facade.EventEmitter = FacadeEventEmitter;
	facade.Disposable = FacadeDisposable;
	facade.RelativePattern = class {
		constructor(
			public base: unknown,
			public pattern: string,
		) {}
	};
	facade.MarkdownString = class {
		value: string;
		constructor(value?: string) {
			this.value = value ?? '';
		}
		appendText(t: string): this {
			this.value += t;
			return this;
		}
		appendMarkdown(t: string): this {
			this.value += t;
			return this;
		}
	};
	facade.ThemeIcon = { File: { id: 'file' }, Folder: { id: 'folder' } };
	facade.ThemeColor = class {
		constructor(public id: string) {}
	};
	facade.StatusBarAlignment = { Left: 1, Right: 2 };
	facade.ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
	facade.ViewColumn = { Active: -1, One: 1, Two: 2, Three: 3, Beside: -2 };
	facade.ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
	facade.DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
	facade.Range = class {
		constructor(
			public start: unknown,
			public end: unknown,
		) {}
	};
	facade.Position = class {
		constructor(
			public line: number,
			public character: number,
		) {}
	};
	facade.Selection = class {
		constructor(
			public anchor: unknown,
			public active: unknown,
		) {}
	};
	facade.TreeItem = class {
		constructor(
			public label: unknown,
			public collapsibleState?: number,
		) {}
	};
	facade.CodeAction = class {
		constructor(
			public title: string,
			public kind?: unknown,
		) {}
	};
	facade.CodeActionKind = { QuickFix: { value: 'quickfix' } };
	facade.Location = class {
		constructor(
			public uri: unknown,
			public range: unknown,
		) {}
	};
	facade.SymbolInformation = class {
		constructor(
			public name: string,
			public kind: number,
			public containerName: string,
			public location: unknown,
		) {}
	};
	facade.SnippetString = class {
		value: string;
		constructor(value?: string) {
			this.value = value ?? '';
		}
	};
	facade.ExtensionMode = { Development: 1, Test: 2, Production: 3 };

	const window: Record<string, unknown> = {
		showInformationMessage: async () => undefined,
		showWarningMessage: async () => undefined,
		showErrorMessage: async () => undefined,
		showQuickPick: async () => undefined,
		showInputBox: async () => undefined,
		createOutputChannel: () => ({
			append: () => {},
			appendLine: () => {},
			show: () => {},
			dispose: () => {},
			clear: () => {},
		}),
		createStatusBarItem: () => ({
			text: '',
			show: () => {},
			hide: () => {},
			dispose: () => {},
		}),
		createTerminal: () => ({
			sendText: () => {},
			show: () => {},
			dispose: () => {},
		}),
		createTextEditorDecorationType: () => ({ dispose: () => {} }),
		createWebviewPanel: () => ({
			webview: { html: '', postMessage: async () => true, onDidReceiveMessage: event() },
			onDidDispose: event(),
			dispose: () => {},
			reveal: () => {},
		}),
		registerTreeDataProvider: () => new FacadeDisposable(),
		registerWebviewViewProvider: () => new FacadeDisposable(),
		registerUriHandler: () => new FacadeDisposable(),
		onDidChangeActiveTextEditor: event(),
		activeTextEditor: undefined,
		visibleTextEditors: [],
	};
	const workspace: Record<string, unknown> = {
		workspaceFolders: undefined,
		name: undefined,
		getConfiguration: () => ({
			get: () => undefined,
			update: async () => {},
			inspect: () => undefined,
		}),
		getWorkspaceFolder: () => undefined,
		onDidChangeConfiguration: event(),
		onDidChangeWorkspaceFolders: event(),
		onDidChangeTextDocument: event(),
		onDidSaveTextDocument: event(),
		onDidOpenTextDocument: event(),
		createFileSystemWatcher: () => ({
			onDidCreate: event(),
			onDidChange: event(),
			onDidDelete: event(),
			dispose: () => {},
		}),
		fs: {
			readFile: async (u: any) => new Uint8Array(),
			writeFile: async () => {},
			stat: async () => ({ type: 1, size: 0, ctime: 0, mtime: 0 }),
			readDirectory: async () => [],
			delete: async () => {},
			createDirectory: async () => {},
			isWritableFileSystem: true,
		},
		openTextDocument: async () => ({ getText: () => '' }),
		openExternal: async () => true,
		asRelativePath: (p: string) => p,
		findFiles: async () => [],
		applyEdit: async () => true,
	};
	const commands: Record<string, unknown> = {
		registerCommand: () => new FacadeDisposable(),
		executeCommand: async () => undefined,
		getCommands: async () => [],
	};
	const env: Record<string, unknown> = {
		language: 'en',
		appName: 'PilotStudioTests',
		appHost: 'cli',
		machineId: 'test',
		sessionId: 'test',
		uiKind: 1,
		openExternal: async () => true,
		clipboard: { writeText: async () => {} },
	};
	const extensions: Record<string, unknown> = {
		getExtension: () => undefined,
		all: [],
		onDidChange: event(),
	};
	const languages: Record<string, unknown> = {
		createDiagnosticCollection: () => ({
			set: () => {},
			delete: () => {},
			clear: () => {},
			dispose: () => {},
		}),
		registerCodeActionsProvider: () => new FacadeDisposable(),
		registerHoverProvider: () => new FacadeDisposable(),
		getLanguages: async () => [],
	};
	facade.window = window;
	facade.workspace = workspace;
	facade.commands = commands;
	facade.env = env;
	facade.extensions = extensions;
	facade.languages = languages;

	(globalThis as any).__vscodeFacade = facade;
	(globalThis as any).vscode = facade;
}
