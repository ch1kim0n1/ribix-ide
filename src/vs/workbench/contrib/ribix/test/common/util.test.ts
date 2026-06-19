/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { separateOutFirstLine } from '../../common/helpers/util.js';

suite('separateOutFirstLine — CRLF (\\r\\n)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('splits on \\r\\n', () => {
		const [first, rest] = separateOutFirstLine('line1\r\nline2\r\nline3');
		assert.strictEqual(first, 'line1');
		assert.strictEqual(rest, 'line2\r\nline3');
	});

	test('single CRLF yields empty rest', () => {
		const [first, rest] = separateOutFirstLine('line1\r\n');
		assert.strictEqual(first, 'line1');
		assert.strictEqual(rest, '');
	});

	test('CRLF at start yields empty first line', () => {
		const [first, rest] = separateOutFirstLine('\r\nline2');
		assert.strictEqual(first, '');
		assert.strictEqual(rest, 'line2');
	});
});

suite('separateOutFirstLine — LF (\\n)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('splits on \\n when no \\r\\n present', () => {
		const [first, rest] = separateOutFirstLine('line1\nline2\nline3');
		assert.strictEqual(first, 'line1');
		assert.strictEqual(rest, 'line2\nline3');
	});

	test('single LF yields empty rest', () => {
		const [first, rest] = separateOutFirstLine('line1\n');
		assert.strictEqual(first, 'line1');
		assert.strictEqual(rest, '');
	});

	test('LF at start yields empty first line', () => {
		const [first, rest] = separateOutFirstLine('\nline2');
		assert.strictEqual(first, '');
		assert.strictEqual(rest, 'line2');
	});
});

suite('separateOutFirstLine — no newline', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('single line with no newline returns [content, undefined]', () => {
		const [first, rest] = separateOutFirstLine('just one line');
		assert.strictEqual(first, 'just one line');
		assert.strictEqual(rest, undefined);
	});

	test('empty string returns ["", undefined]', () => {
		const [first, rest] = separateOutFirstLine('');
		assert.strictEqual(first, '');
		assert.strictEqual(rest, undefined);
	});
});

suite('separateOutFirstLine — CRLF takes priority over LF', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('string with both \\r\\n and \\n splits on \\r\\n first', () => {
		// 'a\r\nb\nc' — CRLF at index 1, LF at index 4
		const [first, rest] = separateOutFirstLine('a\r\nb\nc');
		assert.strictEqual(first, 'a');
		assert.strictEqual(rest, 'b\nc');
	});
});
