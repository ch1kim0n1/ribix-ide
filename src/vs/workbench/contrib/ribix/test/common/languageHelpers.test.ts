/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { convertToVscodeLang, detectLanguage } from '../../common/helpers/languageHelpers.js';

// ---------------------------------------------------------------------------
// Mock ILanguageService — only the methods used by the functions under test
// ---------------------------------------------------------------------------

/**
 * Minimal mock that satisfies the shape expected by convertToVscodeLang and
 * detectLanguage.  createById returns an object with a languageId, and
 * createByFilepathOrFirstLine does the same.
 */
function createMockLanguageService(overrides: {
	byId?: (id: string) => string;
	byFilepath?: (uri: unknown, firstLine: string | undefined) => string;
} = {}) {
	return {
		createById: (id: string) => ({
			languageId: overrides.byId ? overrides.byId(id) : id,
		}),
		createByFilepathOrFirstLine: (uri: unknown, firstLine: string | undefined) => ({
			languageId: overrides.byFilepath ? overrides.byFilepath(uri, firstLine) : 'plaintext',
		}),
	} as any;
}

// ---------------------------------------------------------------------------
// convertToVscodeLang — mapping table coverage
// ---------------------------------------------------------------------------

suite('convertToVscodeLang — known mappings (no languageService call)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// A mock that throws if createById is called, proving the mapping was used.
	const strictMock = {
		createById: (_id: string) => { throw new Error('createById should not be called for mapped language'); },
		createByFilepathOrFirstLine: () => { throw new Error('unexpected call'); },
	} as any;

	test('javascript → typescript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'javascript'), 'typescript');
	});

	test('js → typescript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'js'), 'typescript');
	});

	test('ts → typescript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'ts'), 'typescript');
	});

	test('tsx → typescriptreact', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'tsx'), 'typescriptreact');
	});

	test('jsx → typescriptreact', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'jsx'), 'typescriptreact');
	});

	test('python → python', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'python'), 'python');
	});

	test('py → python', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'py'), 'python');
	});

	test('bash → shellscript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'bash'), 'shellscript');
	});

	test('sh → shellscript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'sh'), 'shellscript');
	});

	test('zsh → shellscript', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'zsh'), 'shellscript');
	});

	test('c++ → cpp', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'c++'), 'cpp');
	});

	test('c# → csharp', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'c#'), 'csharp');
	});

	test('cs → csharp', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'cs'), 'csharp');
	});

	test('golang → go', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'golang'), 'go');
	});

	test('rs → rust', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'rs'), 'rust');
	});

	test('rb → ruby', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'rb'), 'ruby');
	});

	test('yml → yaml', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'yml'), 'yaml');
	});

	test('md → markdown', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'md'), 'markdown');
	});

	test('svg → xml', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'svg'), 'xml');
	});

	test('toml → ini', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'toml'), 'ini');
	});

	test('docker → dockerfile', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'docker'), 'dockerfile');
	});

	test('text → plaintext', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'text'), 'plaintext');
	});

	test('mysql → sql', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'mysql'), 'sql');
	});

	test('gql → graphql', () => {
		assert.strictEqual(convertToVscodeLang(strictMock, 'gql'), 'graphql');
	});
});

suite('convertToVscodeLang — fallback to languageService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('unmapped language falls back to languageService.createById', () => {
		const mock = createMockLanguageService({ byId: (id) => `resolved-${id}` });
		assert.strictEqual(convertToVscodeLang(mock, 'kotlin'), 'resolved-kotlin');
	});

	test('unmapped language with identity mock returns the input', () => {
		const mock = createMockLanguageService();
		assert.strictEqual(convertToVscodeLang(mock, 'some-lang'), 'some-lang');
	});
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

suite('detectLanguage', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns languageId from createByFilepathOrFirstLine', () => {
		const mock = createMockLanguageService({
			byFilepath: () => 'typescript',
		});
		assert.strictEqual(detectLanguage(mock, { uri: null, fileContents: 'some code' }), 'typescript');
	});

	test('returns plaintext when languageId is empty', () => {
		const mock = createMockLanguageService({
			byFilepath: () => '',
		});
		assert.strictEqual(detectLanguage(mock, { uri: null, fileContents: 'some code' }), 'plaintext');
	});

	test('passes the first line of fileContents to the language service', () => {
		let capturedFirstLine: string | undefined;
		const mock = createMockLanguageService({
			byFilepath: (_uri, firstLine) => {
				capturedFirstLine = firstLine;
				return 'python';
			},
		});
		detectLanguage(mock, { uri: null, fileContents: '#!/usr/bin/env python\nprint("hi")' });
		assert.strictEqual(capturedFirstLine, '#!/usr/bin/env python');
	});

	test('passes undefined firstLine when fileContents is undefined', () => {
		let capturedFirstLine: string | undefined = 'sentinel';
		const mock = createMockLanguageService({
			byFilepath: (_uri, firstLine) => {
				capturedFirstLine = firstLine;
				return 'plaintext';
			},
		});
		detectLanguage(mock, { uri: null, fileContents: undefined });
		assert.strictEqual(capturedFirstLine, undefined);
	});

	test('handles single-line fileContents (no newline)', () => {
		let capturedFirstLine: string | undefined;
		const mock = createMockLanguageService({
			byFilepath: (_uri, firstLine) => {
				capturedFirstLine = firstLine;
				return 'plaintext';
			},
		});
		detectLanguage(mock, { uri: null, fileContents: 'single line' });
		assert.strictEqual(capturedFirstLine, 'single line');
	});
});
