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

		test('preserves entry ids when serializing session entries', () => {
			const messages = [
				{
					type: 'message',
					id: 'entry-1',
					parentId: null,
					timestamp: '2024-12-03T14:00:01.000Z',
					message: { role: 'user', content: 'hello from history' },
				},
			];
			const result = serializeMessages(messages as any);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.entryId, 'entry-1');
			assert.strictEqual(result[0]!.parentId, null);
			assert.strictEqual(result[0]!.content, 'hello from history');
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

		test('serializes displayed custom (provider) message with string content', () => {
			const messages = [
				{
					role: 'custom',
					customType: 'my-extension',
					content: 'debug: cache warmed',
					display: true,
					timestamp: 4500,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'provider');
			assert.strictEqual(result[0]!.content, 'debug: cache warmed');
			assert.strictEqual(result[0]!.label, 'my-extension');
		});

		test('serializes custom message with text + image content blocks', () => {
			const messages = [
				{
					role: 'custom',
					customType: 'diagram-tool',
					content: [
						{ type: 'text', text: 'rendered diagram' },
						{ type: 'image', data: 'imgdata', mimeType: 'image/png' },
					],
					display: true,
					timestamp: 4600,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'provider');
			assert.strictEqual(result[0]!.content, 'rendered diagram');
			assert.ok(result[0]!.images, 'should carry images');
			assert.strictEqual(result[0]!.images!.length, 1);
			assert.strictEqual(result[0]!.images![0]!.data, 'imgdata');
		});

		test('skips hidden custom messages (display: false)', () => {
			const messages = [
				{
					role: 'custom',
					customType: 'context-only',
					content: 'injected context, not for display',
					display: false,
					timestamp: 4700,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 0);
		});

		test('skips empty custom messages', () => {
			const messages = [
				{
					role: 'custom',
					customType: 'noop',
					content: '   ',
					display: true,
					timestamp: 4800,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 0);
		});

		test('skips tool-call only assistant messages (no empty bubble)', () => {
			const messages = [
				{
					role: 'assistant',
					content: [
						{ type: 'toolCall', id: 't1', name: 'read', arguments: {} },
					],
					timestamp: 4900,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 0);
		});

		test('skips assistant messages with only redacted/empty thinking', () => {
			const messages = [
				{
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: '', redacted: true },
					],
					timestamp: 4950,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 0);
		});

		test('keeps assistant messages that only have thinking content', () => {
			const messages = [
				{
					role: 'assistant',
					content: [{ type: 'thinking', thinking: 'reasoning only' }],
					timestamp: 4975,
				},
			];
			const result = serializeMessages(messages);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.role, 'assistant');
			assert.strictEqual(result[0]!.content, '');
			assert.strictEqual(result[0]!.thinking, 'reasoning only');
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
