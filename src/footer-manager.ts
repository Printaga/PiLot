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
	}

	sendFooterData(session?: SessionCwd | null | undefined): void {
		const current = session !== undefined ? session : this.session;
		if (!current) return;
		const rawCwd = current.getCwd();
		const sessionName = current.sessionName ?? null;
		// resolveGitBranch does sync fs I/O; a throw must not escape the interval
		// callback and kill the whole footer update tick.
		let gitBranch: string | null;
		try {
			gitBranch = this.binaryService.resolveGitBranch(rawCwd);
		} catch {
			gitBranch = null;
		}

		const home = process.env.HOME || process.env.USERPROFILE || "";
		let cwd = rawCwd;
		if (home && (rawCwd === home || rawCwd.startsWith(home + "/"))) {
			const rest = rawCwd.slice(home.length);
			cwd = rest === "" ? "~" : `~${rest.startsWith("/") ? "" : "/"}${rest}`;
		}

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

	dispose(): void {
		this.stop();
	}
}
