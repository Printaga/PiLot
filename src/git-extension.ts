// ── Built-in git extension bridge ───────────────────────────────────────────
//
// The `vscode.git` API is not part of `@types/vscode`, so the surface this
// feature needs is declared locally and kept deliberately minimal: the module
// exports, `getAPI(1)`, `repositories`, and `inputBox.value`.

import * as vscode from "vscode";

/** The SCM commit-message input box. */
export interface GitInputBox {
	value: string;
}

/** The subset of a git repository this feature uses. */
export interface GitRepository {
	readonly rootUri: { fsPath: string };
	readonly inputBox: GitInputBox;
}

/** The subset of the git extension API (version 1) this feature uses. */
interface GitApi {
	readonly repositories: readonly GitRepository[];
}

/** The subset of the git extension module exports this feature uses. */
interface GitExtensionExports {
	getAPI(version: 1): GitApi;
}

const GIT_EXTENSION_ID = "vscode.git";

export type GitRepositoryLookup =
	{ status: "found"; repository: GitRepository } | { status: "unavailable"; message: string };

/**
 * Locate the repository whose root is `repoRoot`.
 *
 * Matched by resolved root rather than taking `repositories[0]`, so the message
 * can never land in a different repository's input box than the one the diff was
 * gathered from.
 */
export async function findGitRepository(repoRoot: string): Promise<GitRepositoryLookup> {
	const extension = vscode.extensions.getExtension<GitExtensionExports>(GIT_EXTENSION_ID);
	if (!extension) {
		return {
			status: "unavailable",
			message: "The built-in Git extension is not available in this window.",
		};
	}

	let exports: GitExtensionExports | undefined;
	try {
		exports = extension.isActive ? extension.exports : await extension.activate();
	} catch (error) {
		return {
			status: "unavailable",
			message: `The built-in Git extension could not be activated: ${String(error)}`,
		};
	}

	const api = exports?.getAPI?.(1);
	if (!api || !api.repositories || api.repositories.length === 0) {
		return {
			status: "unavailable",
			message: "No Git repository is open in this window.",
		};
	}

	const normalize = (target: string) =>
		process.platform === "win32" ? target.toLowerCase() : target;
	const match = api.repositories.find(
		(repository) => normalize(repository.rootUri.fsPath) === normalize(repoRoot),
	);
	if (!match) {
		return {
			status: "unavailable",
			message: `No open Git repository matches ${repoRoot}.`,
		};
	}

	return { status: "found", repository: match };
}

/**
 * Place `message` in the repository's commit-message input box. This only fills
 * the edit box; it never stages, commits, amends, or pushes.
 */
export function writeCommitMessage(repository: GitRepository, message: string): void {
	repository.inputBox.value = message;
}
