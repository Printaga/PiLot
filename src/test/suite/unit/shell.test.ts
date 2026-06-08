// ── Unit tests for shell utilities ──────────────────────────────────────────

import * as assert from 'assert';
import { stripAnsi, shellQuote, getShellCommand } from '../../../utils/shell.js';

suite('Shell Utilities', () => {

	suite('stripAnsi', () => {
		test('returns plain text unchanged', () => {
			assert.strictEqual(stripAnsi('hello world'), 'hello world');
		});

		test('removes ANSI color codes', () => {
			assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
		});

		test('removes ANSI cursor movement codes', () => {
			assert.strictEqual(stripAnsi('\x1b[2Jcleared'), 'cleared');
		});

		test('handles empty string', () => {
			assert.strictEqual(stripAnsi(''), '');
		});

		test('handles text with no ANSI codes', () => {
			const longText = 'The quick brown fox jumps over the lazy dog.';
			assert.strictEqual(stripAnsi(longText), longText);
		});
	});

	suite('shellQuote', () => {
		test('wraps simple string in single quotes', () => {
			assert.strictEqual(shellQuote('hello'), "'hello'");
		});

		test('escapes single quotes within the string', () => {
			const result = shellQuote("it's");
			assert.ok(result.includes("'\\''"), 'should escape single quote');
		});

		test('handles empty string', () => {
			assert.strictEqual(shellQuote(''), "''");
		});

		test('handles strings with spaces', () => {
			const result = shellQuote('hello world');
			assert.strictEqual(result, "'hello world'");
		});
	});

	suite('getShellCommand', () => {
		test('returns null on Windows (simulated)', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });
			try {
				const result = getShellCommand('/usr/bin/pi', ['list']);
				assert.strictEqual(result, null);
			} finally {
				Object.defineProperty(process, 'platform', { value: originalPlatform });
			}
		});

		test('returns shell command object on non-Windows', () => {
			if (process.platform === 'win32') {
				// Skip on actual Windows
				return;
			}
			const result = getShellCommand('/usr/bin/pi', ['list']);
			assert.ok(result !== null, 'should return a command object');
			assert.ok(result!.command.includes('bash') || result!.command.includes('sh'),
				'should use a shell');
			assert.ok(result!.args.includes('-lc'), 'should use login shell');
		});
	});
});
