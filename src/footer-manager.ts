export interface FooterData {
	cwd: string;
	gitBranch: string | null;
	sessionName: string | null;
}

export interface SessionCwd {
	getCwd(): string;
	sessionName: string | null | undefined;
}

export class FooterManager {
	private footerCwd = "";
	private footerGitBranch: string | null = null;
	private footerSessionName: string | null = null;
	private gitBranchPoller: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly binaryService: {
			resolveGitBranch(cwd: string): string | null;
		},
		private readonly notifyWebview: (
			message: { type: string; data: FooterData },
		) => void,
	) {}

	start(session: SessionCwd | null | undefined): void {
		this.stop();
		this.sendFooterData(session);
		this.gitBranchPoller = setInterval(() => {
			this.sendFooterData(session);
		}, 5000);
	}

	stop(): void {
		if (this.gitBranchPoller !== undefined) {
			clearInterval(this.gitBranchPoller);
			this.gitBranchPoller = undefined;
		}
	}

	sendFooterData(session: SessionCwd | null | undefined): void {
		if (!session) return;
		const rawCwd = session.getCwd();
		const sessionName = session.sessionName ?? null;
		const gitBranch = this.binaryService.resolveGitBranch(rawCwd);

		const home = process.env.HOME || process.env.USERPROFILE || "";
		let cwd = rawCwd;
		if (home && rawCwd.startsWith(home)) {
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
