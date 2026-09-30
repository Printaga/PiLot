import * as path from "node:path";

export interface FooterData {
	cwd: string;
	gitBranch: string | null;
	sessionName: string | null;
}

export interface SessionCwd {
	getCwd(): string;
	sessionName: string | null | undefined;
}

/** Poll cadence for git branch resolution (kept small so the footer stays fresh). */
const POLL_INTERVAL_MS = 5000;

export class FooterManager {
	private footerCwd = "";
	private footerGitBranch: string | null = null;
	private footerSessionName: string | null = null;
	private gitBranchPoller: ReturnType<typeof setInterval> | undefined;
	// Held as an instance field (not captured in the interval closure) so the
	// poller always reports the CURRENT session instead of a stale capture.
	private session: SessionCwd | null | undefined;

	constructor(
		private readonly binaryService: {
			resolveGitBranch(cwd: string): string | null;
		},
		private readonly notifyWebview: (message: { type: string; data: FooterData }) => void,
		private readonly logError?: (msg: string, ...details: unknown[]) => void,
	) {}

	start(session: SessionCwd | null | undefined): void {
		this.stop();
		this.session = session;
		this.sendFooterData();
		this.gitBranchPoller = setInterval(() => {
			this.sendFooterData();
		}, POLL_INTERVAL_MS);
	}

	stop(): void {
		if (this.gitBranchPoller !== undefined) {
			clearInterval(this.gitBranchPoller);
			this.gitBranchPoller = undefined;
		}
		// Drop the (possibly torn-down) session and the dedupe snapshot: without
		// this, sends after stop() still emit using a disposed session, and a
		// restart with an identical cwd/branch/name suppressed its first update.
		this.session = undefined;
		this.resetCache();
	}

	/** Forget the last pushed snapshot so the next send always re-emits it. */
	resetCache(): void {
		this.footerCwd = "";
		this.footerGitBranch = null;
		this.footerSessionName = null;
	}

	sendFooterData(session?: SessionCwd | null | undefined): void {
		// Adopt the argument, not just read it: the provider passes a fresh
		// object on session-name changes, and without adopting it the next poll
		// tick re-read the stale snapshot and flickered the old name back.
		if (session !== undefined) {
			this.session = session;
		}
		const current = this.session;
		if (!current) return;

		// Guard the WHOLE tick body: getCwd() is a closure over session-manager
		// state the provider disposes during teardown, and notifyWebview() can
		// throw too — a throw here previously escaped the interval callback.
		let rawCwd: string;
		let sessionName: string | null;
		try {
			rawCwd = current.getCwd();
			sessionName = current.sessionName ?? null;
		} catch {
			return;
		}

		// resolveGitBranch does sync fs I/O; a throw must not escape the interval
		// callback and kill the whole footer update tick.
		let gitBranch: string | null;
		try {
			gitBranch = this.binaryService.resolveGitBranch(rawCwd);
		} catch (err) {
			this.logError?.("[PI] resolveGitBranch failed for", rawCwd, err);
			gitBranch = null;
		}

		const cwd = this.shortenHome(rawCwd);

		if (
			cwd === this.footerCwd &&
			gitBranch === this.footerGitBranch &&
			sessionName === this.footerSessionName
		) {
			return;
		}

		this.footerCwd = cwd;
		this.footerGitBranch = gitBranch;
		this.footerSessionName = sessionName;

		this.notifyWebview({
			type: "footer-data",
			data: { cwd, gitBranch, sessionName },
		});
	}

	/** Shorten an absolute cwd under the user's home directory to `~/…`.
	 *  Uses path semantics so Windows paths (`C:\\Users\\me\\…`) and trailing
	 *  separators in HOME are handled correctly — the old string slicing with
	 *  a hardcoded "/" silently failed on Windows. */
	private shortenHome(rawCwd: string): string {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		if (!home) return rawCwd;
		const relative = path.relative(home, rawCwd);
		if (relative === "") {
			// cwd IS the home directory: shorten to the bare `~`.
			return "~";
		}
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			return rawCwd;
		}
		const sep = relative.includes(path.sep) ? path.sep : "";
		return `~${sep}${relative.split(path.sep).join("/")}`;
	}

	dispose(): void {
		this.stop();
	}
}
