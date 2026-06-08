// ── Unit tests for session resources utilities ──────────────────────────────

import * as assert from 'assert';
import { isBinaryExtension, areImagesValid } from '../../../session-resources.js';

suite('Session Resources', () => {

	suite('isBinaryExtension', () => {
		test('identifies png as binary', () => {
			assert.strictEqual(isBinaryExtension('photo.png'), true);
		});

		test('identifies jpg as binary', () => {
			assert.strictEqual(isBinaryExtension('image.jpg'), true);
			assert.strictEqual(isBinaryExtension('image.jpeg'), true);
		});

		test('identifies mp3 as binary', () => {
			assert.strictEqual(isBinaryExtension('song.mp3'), true);
		});

		test('identifies pdf as binary', () => {
			assert.strictEqual(isBinaryExtension('doc.pdf'), true);
		});

		test('identifies zip as binary', () => {
			assert.strictEqual(isBinaryExtension('archive.zip'), true);
		});

		test('identifies .ts as NOT binary', () => {
			assert.strictEqual(isBinaryExtension('file.ts'), false);
		});

		test('identifies .js as NOT binary', () => {
			assert.strictEqual(isBinaryExtension('script.js'), false);
		});

		test('identifies .json as NOT binary', () => {
			assert.strictEqual(isBinaryExtension('data.json'), false);
		});

		test('identifies .md as NOT binary', () => {
			assert.strictEqual(isBinaryExtension('README.md'), false);
		});

		test('identifies .txt as NOT binary', () => {
			assert.strictEqual(isBinaryExtension('notes.txt'), false);
		});

		test('is case-insensitive', () => {
			assert.strictEqual(isBinaryExtension('PHOTO.PNG'), true);
			assert.strictEqual(isBinaryExtension('Script.TS'), false);
		});

		test('handles no extension', () => {
			assert.strictEqual(isBinaryExtension('Makefile'), false);
		});
	});

	suite('areImagesValid', () => {
		test('returns false for empty array', () => {
			assert.strictEqual(areImagesValid([]), false);
		});

		test('returns false for non-array', () => {
			assert.strictEqual(areImagesValid(null as any), false);
			assert.strictEqual(areImagesValid(undefined as any), false);
		});

		test('returns true for valid image array', () => {
			const images = [
				{ type: 'image', data: 'base64data', mimeType: 'image/png' },
			];
			assert.strictEqual(areImagesValid(images), true);
		});

		test('returns false if any image is missing data', () => {
			const images = [
				{ type: 'image', data: '', mimeType: 'image/png' },
			];
			assert.strictEqual(areImagesValid(images), false);
		});

		test('returns false if any item is not image type', () => {
			const images = [
				{ type: 'text', data: 'base64data', mimeType: 'image/png' },
			];
			assert.strictEqual(areImagesValid(images), false);
		});

		test('returns false if mimeType is missing', () => {
			const images = [
				{ type: 'image', data: 'base64data' },
			];
			assert.strictEqual(areImagesValid(images as any), false);
		});
	});
});
