import * as assert from "node:assert";
import {
	ProjectTrustManager,
	TRUST_PROMPT_OPTIONS,
	type ProjectTrustStoreLike,
} from "../../../project-trust.js";

function createStore(initial: Map<string, boolean> = new Map()) {
	const calls: Array<{ cwd: string; decision: boolean }> = [];
	const store: ProjectTrustStoreLike = {
		get: (cwd) => initial.get(cwd) ?? null,
		set: (cwd, decision) => {
			calls.push({ cwd, decision });
			initial.set(cwd, decision);
		},
	};
	return { store, calls };
}

function createManager(options: {
	requiresTrust?: boolean;
	stored?: boolean;
	defaultTrust?: "ask" | "always" | "never";
	choice?: string;
	store?: ProjectTrustStoreLike;
	promptCalls?: Array<{ cwd: string; options: readonly string[] }>;
}) {
	const promptCalls = options.promptCalls ?? [];
	const manager = new ProjectTrustManager({
		store: options.store ?? createStore().store,
		hasTrustRequiringResources: () => options.requiresTrust ?? true,
		getDefaultProjectTrust: () => options.defaultTrust ?? "ask",
		prompt: async (cwd, labels) => {
			promptCalls.push({ cwd, options: labels });
			return options.choice;
		},
	});
	return { manager, promptCalls };
}

suite("ProjectTrustManager", () => {
	test("trusts a project with no trust-requiring resources without prompting", async () => {
		const { manager, promptCalls } = createManager({ requiresTrust: false });
		assert.strictEqual(await manager.resolve("/work/plain"), true);
		assert.strictEqual(promptCalls.length, 0);
	});

	test("uses a stored decision without prompting", async () => {
		for (const stored of [true, false]) {
			const { store } = createStore(new Map([["/work/repo", stored]]));
			const { manager, promptCalls } = createManager({ store });
			assert.strictEqual(await manager.resolve("/work/repo"), stored);
			assert.strictEqual(promptCalls.length, 0);
		}
	});

	test("honours defaultProjectTrust always/never", async () => {
		for (const [defaultTrust, expected] of [
			["always", true],
			["never", false],
		] as const) {
			const { manager, promptCalls } = createManager({ defaultTrust });
			assert.strictEqual(await manager.resolve("/work/repo"), expected);
			assert.strictEqual(promptCalls.length, 0);
		}
	});

	test("persists Trust and Do not trust, in that order", async () => {
		for (const [choice, expected] of [
			[TRUST_PROMPT_OPTIONS.trust, true],
			[TRUST_PROMPT_OPTIONS.deny, false],
		] as const) {
			const { store, calls } = createStore();
			const { manager } = createManager({ store, choice });
			assert.strictEqual(await manager.resolve("/work/repo"), expected);
			assert.deepStrictEqual(calls, [{ cwd: "/work/repo", decision: expected }]);
		}
	});

	test("session-only choices are not persisted", async () => {
		for (const [choice, expected] of [
			[TRUST_PROMPT_OPTIONS.trustSession, true],
			[TRUST_PROMPT_OPTIONS.denySession, false],
		] as const) {
			const { store, calls } = createStore();
			const { manager } = createManager({ store, choice });
			assert.strictEqual(await manager.resolve("/work/repo"), expected);
			assert.deepStrictEqual(calls, []);
		}
	});

	test("session-only decisions are remembered without prompting again", async () => {
		for (const [choice, expected] of [
			[TRUST_PROMPT_OPTIONS.trustSession, true],
			[TRUST_PROMPT_OPTIONS.denySession, false],
		] as const) {
			const { manager, promptCalls } = createManager({ choice });
			assert.strictEqual(await manager.resolve("/work/repo"), expected);
			assert.strictEqual(await manager.resolve("/work/repo"), expected);
			assert.strictEqual(promptCalls.length, 1);
		}
	});

	test("a cancelled prompt resolves untrusted", async () => {
		const { store, calls } = createStore();
		const { manager } = createManager({ store, choice: undefined });
		assert.strictEqual(await manager.resolve("/work/repo"), false);
		assert.deepStrictEqual(calls, []);
	});

	test("prompt receives all four choices", async () => {
		const { manager, promptCalls } = createManager({ choice: TRUST_PROMPT_OPTIONS.deny });
		await manager.resolve("/work/repo");
		assert.deepStrictEqual(promptCalls[0]?.options, Object.values(TRUST_PROMPT_OPTIONS));
	});

	test("a failing trust probe fails closed", async () => {
		const manager = new ProjectTrustManager({
			store: createStore().store,
			hasTrustRequiringResources: () => {
				throw new Error("EACCES");
			},
			prompt: async () => TRUST_PROMPT_OPTIONS.trust,
		});
		assert.strictEqual(await manager.resolve("/work/repo"), false);
	});

	test("an unreadable store still asks and honours the answer", async () => {
		const store: ProjectTrustStoreLike = {
			get: () => {
				throw new Error("bad trust.json");
			},
			set: () => {},
		};
		const { manager } = createManager({ store, choice: TRUST_PROMPT_OPTIONS.trust });
		assert.strictEqual(await manager.resolve("/work/repo"), true);
	});

	test("a failing store write does not change the session decision", async () => {
		const store: ProjectTrustStoreLike = {
			get: () => null,
			set: () => {
				throw new Error("EACCES");
			},
		};
		const { manager } = createManager({ store, choice: TRUST_PROMPT_OPTIONS.trust });
		assert.strictEqual(await manager.resolve("/work/repo"), true);
	});
});
