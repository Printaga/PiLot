// ── Built-in git extension bridge ───────────────────────────────────────────
//
// The `vscode.git` API is not part of `@types/vscode`, so the surface this
// feature needs is declared locally and kept deliberately minimal: the module
// exports, `getAPI(1)`, `repositories`, and `inputBox.value`.

import * as vscode from "vscode";
import * as fs from "node:fs";

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

	let api: GitApi | undefined;
	try {
		api = exports?.getAPI?.(1);
	} catch (error) {
		// The real getAPI throws for unsupported/uninitialized API versions; the
		// contract here is "explain, never throw".
		return {
			status: "unavailable",
			message: `The built-in Git extension API is unavailable: ${String(error)}`,
		};
	}
	if (!api) {
		return {
			status: "unavailable",
			message: "The built-in Git extension did not expose its API.",
		};
	}
	if (!api.repositories || api.repositories.length === 0) {
		return {
			status: "unavailable",
			message: "No Git repository is open in this window.",
		};
	}

	// Strip trailing separators (keeping filesystem roots intact: `/` would
	// collapse to "" and `C:\` to `C:`, a drive-relative path), case-fold as a
	// FALLBACK for case-insensitive volumes, and realpath so symlinked roots
	// still match.
	const normalize = (target: string) => {
		let t = target;
		if (!/^([A-Za-z]:)?[\\/]+$/.test(t)) t = t.replace(/[\\/]+$/, "");
		try {
			t = fs.realpathSync.native(t).replace(/[\\/]+$/, "");
		} catch {
			/* unresolvable path (e.g. deleted): keep the lexical form */
		}
		return t;
	};
	const normalizedRepoRoot = normalize(repoRoot);
	const candidates = api.repositories.map((repository) => ({
		repository,
		normalized: normalize(repository.rootUri.fsPath),
	}));
	// Exact match always wins: a case-sensitive volume can be mounted on darwin
	// and a case-insensitive one on linux, so folding is a fallback, never the
	// first choice (folding could merge two distinct repos).
	const match =
		candidates.find((c) => c.normalized === normalizedRepoRoot) ??
		candidates.find((c) => c.normalized.toLowerCase() === normalizedRepoRoot.toLowerCase());
	if (!match) {
		return {
			status: "unavailable",
			message: `No open Git repository matches ${repoRoot}.`,
		};
	}

	return { status: "found", repository: match.repository };
}

/**
 * Place `message` in the repository's commit-message input box. This only fills
 * the edit box; it never stages, commits, amends, or pushes.
 *
 * Returns false when the repository is stale/closed (its inputBox is gone) so
 * the caller can surface the failure instead of silently dropping the message.
 */
export function writeCommitMessage(repository: GitRepository, message: string): boolean {
	const inputBox = repository?.inputBox;
	if (!inputBox) return false;
	inputBox.value = message;
	return true;
}
