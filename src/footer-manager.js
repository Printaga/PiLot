"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FooterManager = void 0;
class FooterManager {
    binaryService;
    notifyWebview;
    footerCwd = "";
    footerGitBranch = null;
    footerSessionName = null;
    gitBranchPoller;
    constructor(binaryService, notifyWebview) {
        this.binaryService = binaryService;
        this.notifyWebview = notifyWebview;
    }
    start(session) {
        this.stop();
        this.sendFooterData(session);
        this.gitBranchPoller = setInterval(() => {
            this.sendFooterData(session);
        }, 5000);
    }
    stop() {
        if (this.gitBranchPoller !== undefined) {
            clearInterval(this.gitBranchPoller);
            this.gitBranchPoller = undefined;
        }
    }
    sendFooterData(session) {
        if (!session)
            return;
        const rawCwd = session.getCwd();
        const sessionName = session.sessionName ?? null;
        const gitBranch = this.binaryService.resolveGitBranch(rawCwd);
        const home = process.env.HOME || process.env.USERPROFILE || "";
        let cwd = rawCwd;
        if (home && rawCwd.startsWith(home)) {
            const rest = rawCwd.slice(home.length);
            cwd = rest === "" ? "~" : `~${rest.startsWith("/") ? "" : "/"}${rest}`;
        }
        if (cwd === this.footerCwd &&
            gitBranch === this.footerGitBranch &&
            sessionName === this.footerSessionName) {
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
    dispose() {
        this.stop();
    }
}
exports.FooterManager = FooterManager;
//# sourceMappingURL=footer-manager.js.map