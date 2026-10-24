import { hasTrustRequiringProjectResources } from "@earendil-works/pi-coding-agent";

/**
 * PI 1.4 gates project-local `.pi` resources, MCP servers, packages and
 * extensions behind project trust. The CLI defaults to asking; the SDK's
 * `SettingsManager` defaults to trusted, so PiLot must resolve the decision
 * itself and pass it to the resource loader.
 *
 * The decision is stored in PI's own `trust.json` (via `ProjectTrustStore`), so
 * a workspace trusted in the CLI is trusted here and vice versa.
 */
export type DefaultProjectTrust = "ask" | "always" | "never";

export interface ProjectTrustStoreLike {
	get(cwd: string): boolean | null;
	set(cwd: string, decision: boolean): void;
}

export const TRUST_PROMPT_OPTIONS = {
	trust: "Trust",
	trustSession: "Trust (this session only)",
	deny: "Do not trust",
	denySession: "Do not trust (this session only)",
} as const;

export interface ProjectTrustDeps {
	store: ProjectTrustStoreLike;
	/** Ask the user; resolves to one of `TRUST_PROMPT_OPTIONS` or undefined on cancel. */
	prompt: (cwd: string, options: readonly string[]) => Promise<string | undefined>;
	/** Default when no decision is stored. Mirrors PI's `defaultProjectTrust`. */
	getDefaultProjectTrust?: () => DefaultProjectTrust;
	/** Injectable for tests; defaults to PI's filesystem probe. */
	hasTrustRequiringResources?: (cwd: string) => boolean;
	logError?: (message: string, error?: unknown) => void;
}

export class ProjectTrustManager {
	/** Decisions chosen "this session only" in this VS Code window. */
	private readonly sessionDecisions = new Map<string, boolean>();

	constructor(private readonly deps: ProjectTrustDeps) {}

	/**
	 * Resolve whether `cwd` may load project-local resources.
	 *
	 * The SDK only consults trust when the project actually contains gated
	 * resources; a plain repository loads without a prompt. Anything uncertain
	 * (unreadable trust store, cancelled prompt) resolves to untrusted.
	 */
	async resolve(cwd: string): Promise<boolean> {
		const requiresTrust = this.requiresTrust(cwd);
		if (requiresTrust === undefined) return false;
		if (!requiresTrust) return true;

		const sessionDecision = this.sessionDecisions.get(cwd);
		if (sessionDecision !== undefined) return sessionDecision;

		const stored = this.storedDecision(cwd);
		if (stored !== null) return stored;

		const fallback = this.defaultTrust();
		if (fallback === "always") return true;
		if (fallback === "never") return false;
		return this.ask(cwd);
	}

	/** False/true when the probe succeeds; undefined fails closed on error. */
	private requiresTrust(cwd: string): boolean | undefined {
		try {
			const probe = this.deps.hasTrustRequiringResources ?? hasTrustRequiringProjectResources;
			return probe(cwd);
		} catch (error) {
			// Fail closed: if we cannot tell what the project contains, do not let
			// project code run.
			this.deps.logError?.("[PI] Failed to inspect project trust resources", error);
			return undefined;
		}
	}

	private storedDecision(cwd: string): boolean | null {
		try {
			return this.deps.store.get(cwd);
		} catch (error) {
			this.deps.logError?.("[PI] Failed to read project trust store", error);
			return null;
		}
	}

	private defaultTrust(): DefaultProjectTrust {
		try {
			return this.deps.getDefaultProjectTrust?.() ?? "ask";
		} catch (error) {
			this.deps.logError?.("[PI] Failed to read defaultProjectTrust", error);
			return "ask";
		}
	}

	private async ask(cwd: string): Promise<boolean> {
		const choice = await this.deps.prompt(cwd, Object.values(TRUST_PROMPT_OPTIONS));
		switch (choice) {
			case TRUST_PROMPT_OPTIONS.trust:
				this.persist(cwd, true);
				return true;
			case TRUST_PROMPT_OPTIONS.deny:
				this.persist(cwd, false);
				return false;
			case TRUST_PROMPT_OPTIONS.trustSession:
				this.sessionDecisions.set(cwd, true);
				return true;
			case TRUST_PROMPT_OPTIONS.denySession:
				this.sessionDecisions.set(cwd, false);
				return false;
			default:
				return false;
		}
	}

	private persist(cwd: string, decision: boolean): void {
		try {
			this.deps.store.set(cwd, decision);
		} catch (error) {
			// A failed write must not change this session's decision; the user is
			// asked again next time.
			this.deps.logError?.("[PI] Failed to save project trust decision", error);
		}
	}
}
