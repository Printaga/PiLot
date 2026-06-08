// ── Unit tests for message serializer ───────────────────────────────────────

import * as assert from 'assert';
import { serializeMessages } from '../../../message-serializer.js';

suite('Message Serializer', () => {

	suite('serializeMessages', () => {
		test('serializes simple text user message', () => {
			const messages = [
				{ role: 'user', content: 'hello', timestamp: 1000 },
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'user');
			assert.strictEqual(result[0]!.content, 'hello');
			assert.strictEqual(result[0]!.timestamp, 1000);
		});

		test('serializes user message with images', () => {
			const messages = [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'look at this' },
						{ type: 'image', data: 'base64data', mimeType: 'image/png' },
					],
					timestamp: 2000,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'user');
			assert.strictEqual(result[0]!.content, 'look at this');
			assert.ok(result[0]!.images, 'should have images');
			assert.strictEqual(result[0]!.images!.length, 1);
			assert.strictEqual(result[0]!.images![0]!.data, 'base64data');
		});

		test('serializes assistant message with text and thinking', () => {
			const messages = [
				{
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'let me think...' },
						{ type: 'text', text: 'here is the answer' },
					],
					timestamp: 3000,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'assistant');
			assert.strictEqual(result[0]!.content, 'here is the answer');
			assert.strictEqual(result[0]!.thinking, 'let me think...');
		});

		test('serializes tool result message', () => {
			const messages = [
				{
					role: 'toolResult',
					toolName: 'read',
					content: [{ type: 'text', text: 'file contents here' }],
					timestamp: 4000,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'system');
			assert.ok(result[0]!.content.includes('[Tool: read]'),
				'should include tool name');
		});

		test('handles empty messages array', () => {
			const result = serializeMessages([]);
			assert.strictEqual(result.length, 0);
		});

		test('handles string content for assistant', () => {
			const messages = [
				{ role: 'assistant', content: 'plain string response', timestamp: 5000 },
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.content, 'plain string response');
		});
	});
});
