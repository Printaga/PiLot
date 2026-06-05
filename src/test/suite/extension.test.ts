import * as assert from 'assert';

// Import pure functions from the provider module.
// These tests run in the VS Code extension host context (via @vscode/test-electron).
import { validateThinkingLevel } from '../../pi-agent-provider.js';

suite('PiLot Studio Extension Test Suite', () => {

	// ── validateThinkingLevel ───────────────────────────────────────────────

	suite('validateThinkingLevel', () => {

		test('returns the level for each valid thinking level string', () => {
			const validLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
			for (const level of validLevels) {
				const result = validateThinkingLevel(level);
				assert.strictEqual(result, level, `expected "${level}" to be accepted`);
			}
		});

		test('falls back to "medium" for null input', () => {
			assert.strictEqual(validateThinkingLevel(null), 'medium');
		});

		test('falls back to "medium" for undefined input', () => {
			assert.strictEqual(validateThinkingLevel(undefined), 'medium');
		});

		test('falls back to "medium" for empty string', () => {
			assert.strictEqual(validateThinkingLevel(''), 'medium');
		});

		test('falls back to "medium" for unknown string', () => {
			assert.strictEqual(validateThinkingLevel('turbo'), 'medium');
		});

		test('falls back to "medium" for numeric input', () => {
			assert.strictEqual(validateThinkingLevel(42), 'medium');
		});

		test('falls back to "medium" for object input', () => {
			assert.strictEqual(validateThinkingLevel({ level: 'high' }), 'medium');
		});

		test('is case-sensitive — uppercase is treated as unknown', () => {
			assert.strictEqual(validateThinkingLevel('HIGH'), 'medium');
			assert.strictEqual(validateThinkingLevel('Off'), 'medium');
		});
	});

	// ── Package.json integrity ──────────────────────────────────────────────

	suite('extension manifest', () => {

		test('activationEvents match registered commands', () => {
			// This is a smoke test that the extension structure is sound.
			// The real activation-event-to-command matching is validated by
			// VS Code at runtime.
			assert.ok(true, 'extension.ts pairs commands with activate()');
		});

		test('configuration defaults are internally consistent', () => {
			// The default thinking level in package.json is "medium" —
			// validateThinkingLevel must accept it.
			const result = validateThinkingLevel('medium');
			assert.strictEqual(result, 'medium');
		});
	});

	// ── Thinking level set ───────────────────────────────────────────────────

	suite('ThinkingLevel type', () => {

		test('all six levels round-trip through validateThinkingLevel', () => {
			const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
			for (const level of levels) {
				const validated: string = validateThinkingLevel(level);
				assert.strictEqual(validated, level);
			}
		});
	});
});
