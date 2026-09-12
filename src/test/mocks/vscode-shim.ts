// Mutable VS Code API facade for unit tests.
//
// Production and test modules import the `"vscode"` specifier normally. The
// test suite (src/test/suite/index.ts) installs an overlay facade on
// `globalThis` and redirects `"vscode"` imports to this shim via
// `node:module`'s `registerHooks`, so every loaded module observes the same
// mutable objects that `resetVscodeMocks()` patches.

const facade = (globalThis as any).__vscodeFacade;
if (!facade) {
	throw new Error(
		"vscode facade not installed; the test suite entrypoint (src/test/suite/index.ts) must run first",
	);
}

export const window = facade.window;
export const workspace = facade.workspace;
export const commands = facade.commands;
export const env = facade.env;
export const extensions = facade.extensions;
export const languages = facade.languages;

export const Uri = facade.Uri;
export const EventEmitter = facade.EventEmitter;
export const Disposable = facade.Disposable;
export const RelativePattern = facade.RelativePattern;
export const MarkdownString = facade.MarkdownString;
export const ThemeIcon = facade.ThemeIcon;
export const ThemeColor = facade.ThemeColor;
export const StatusBarAlignment = facade.StatusBarAlignment;
export const ConfigurationTarget = facade.ConfigurationTarget;
export const ViewColumn = facade.ViewColumn;
export const ProgressLocation = facade.ProgressLocation;
export const DiagnosticSeverity = facade.DiagnosticSeverity;
export const Range = facade.Range;
export const Position = facade.Position;
export const Selection = facade.Selection;
