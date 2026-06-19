/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	validateProviderSettings,
	formatValidationResults,
	type ConfigValidationResult,
} from '../../browser/ribixConfigValidation.js';

// ---------------------------------------------------------------------------
// validateProviderSettings — no providers configured
// ---------------------------------------------------------------------------

suite('validateProviderSettings — empty configuration', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns error when no providers are configured', () => {
		const result = validateProviderSettings({});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.length >= 1);
		assert.ok(result.errors.some(e => e.provider === '*'));
	});

	test('returns error when all provider configs are empty', () => {
		const result = validateProviderSettings({
			anthropic: { apiKey: '' },
			openAI: { apiKey: '' },
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.provider === '*'));
	});
});

// ---------------------------------------------------------------------------
// validateProviderSettings — valid configurations
// ---------------------------------------------------------------------------

suite('validateProviderSettings — valid configurations', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('passes with a single API key provider', () => {
		const result = validateProviderSettings({
			anthropic: { apiKey: 'sk-ant-abc123' },
		});
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});

	test('passes with a single endpoint provider', () => {
		const result = validateProviderSettings({
			ollama: { endpoint: 'http://127.0.0.1:11434' },
		});
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});

	test('passes with multiple providers configured', () => {
		const result = validateProviderSettings({
			anthropic: { apiKey: 'sk-ant-abc123' },
			openAI: { apiKey: 'sk-abc123' },
			ollama: { endpoint: 'http://localhost:11434' },
		});
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});

	test('passes with openAICompatible (both endpoint and apiKey)', () => {
		const result = validateProviderSettings({
			openAICompatible: { endpoint: 'http://my-proxy:8080/v1', apiKey: 'key123' },
		});
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});
});

// ---------------------------------------------------------------------------
// validateProviderSettings — endpoint validation
// ---------------------------------------------------------------------------

suite('validateProviderSettings — endpoint validation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects malformed endpoint URL', () => {
		const result = validateProviderSettings({
			ollama: { endpoint: 'not-a-url' },
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.setting === 'endpoint'));
	});

	test('rejects endpoint with invalid protocol (ftp)', () => {
		const result = validateProviderSettings({
			ollama: { endpoint: 'ftp://example.com' },
		});
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.setting === 'endpoint'));
	});

	test('accepts http endpoint', () => {
		const result = validateProviderSettings({
			ollama: { endpoint: 'http://localhost:11434' },
		});
		assert.strictEqual(result.valid, true);
	});

	test('accepts https endpoint', () => {
		const result = validateProviderSettings({
			openAICompatible: { endpoint: 'https://api.example.com/v1', apiKey: 'key' },
		});
		assert.strictEqual(result.valid, true);
	});

	test('warns when local provider endpoint is empty', () => {
		const result = validateProviderSettings({
			ollama: { endpoint: '' },
			anthropic: { apiKey: 'sk-abc' },
		});
		// Should be valid (anthropic is configured) but warn about empty ollama endpoint
		assert.strictEqual(result.valid, true);
		assert.ok(result.warnings.some(w => w.provider === 'ollama'));
	});
});

// ---------------------------------------------------------------------------
// validateProviderSettings — API key warnings
// ---------------------------------------------------------------------------

suite('validateProviderSettings — API key warnings', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('warns when API key looks like a placeholder', () => {
		const result = validateProviderSettings({
			anthropic: { apiKey: 'your-api-key' },
		});
		// Valid (non-empty key) but should warn
		assert.strictEqual(result.valid, true);
		assert.ok(result.warnings.some(w => w.provider === 'anthropic'));
	});

	test('warns when API key is "xxx"', () => {
		const result = validateProviderSettings({
			openAI: { apiKey: 'xxx' },
		});
		assert.strictEqual(result.valid, true);
		assert.ok(result.warnings.some(w => w.provider === 'openAI'));
	});

	test('does not warn for real-looking API keys', () => {
		const result = validateProviderSettings({
			anthropic: { apiKey: 'sk-ant-api03-abc123def456' },
		});
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.warnings.length, 0);
	});
});

// ---------------------------------------------------------------------------
// formatValidationResults
// ---------------------------------------------------------------------------

suite('formatValidationResults', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns success message when valid with no warnings', () => {
		const result: ConfigValidationResult = { valid: true, errors: [], warnings: [] };
		const text = formatValidationResults(result);
		assert.ok(text.length > 0);
		// Should not contain "error" or "warning" headers
		assert.ok(!text.includes('errors'));
	});

	test('includes error messages when invalid', () => {
		const result: ConfigValidationResult = {
			valid: false,
			errors: [{ provider: 'ollama', setting: 'endpoint', message: 'Bad URL' }],
			warnings: [],
		};
		const text = formatValidationResults(result);
		assert.ok(text.includes('ollama'));
		assert.ok(text.includes('Bad URL'));
	});

	test('includes warning messages when valid but has warnings', () => {
		const result: ConfigValidationResult = {
			valid: true,
			errors: [],
			warnings: [{ provider: 'anthropic', message: 'Placeholder key' }],
		};
		const text = formatValidationResults(result);
		assert.ok(text.includes('anthropic'));
		assert.ok(text.includes('Placeholder key'));
	});

	test('includes both errors and warnings when both present', () => {
		const result: ConfigValidationResult = {
			valid: false,
			errors: [{ provider: 'ollama', setting: 'endpoint', message: 'Bad URL' }],
			warnings: [{ provider: 'anthropic', message: 'Placeholder key' }],
		};
		const text = formatValidationResults(result);
		assert.ok(text.includes('ollama'));
		assert.ok(text.includes('anthropic'));
	});
});
