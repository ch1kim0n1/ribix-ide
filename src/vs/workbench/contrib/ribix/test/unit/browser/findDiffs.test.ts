/*---------------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { findDiffs } from '../../../browser/helpers/findDiffs.js';
import { ComputedDiff } from '../../../common/editCodeServiceTypes.js';

suite('findDiffs', () => {
	const originalCode = `\
A
B
C
D
E`;

	const insertedCode = `\
A
B
C
F
D
E`;

	const modifiedCode = `\
A
B
C
F
E`;

	test('detects insertion', () => {
		const diffs = findDiffs(originalCode, insertedCode);
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'insertion');
		assert.strictEqual(diff.originalCode, '');
		assert.strictEqual(diff.code, 'F');
		assert.strictEqual(diff.originalStartLine, 4);
		assert.strictEqual(diff.originalEndLine, 4);
		assert.strictEqual(diff.startLine, 4);
		assert.strictEqual(diff.endLine, 4);
	});

	test('detects deletion', () => {
		const diffs = findDiffs(insertedCode, originalCode);
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'deletion');
		assert.strictEqual(diff.originalCode, 'F');
		assert.strictEqual(diff.code, '');
		assert.strictEqual(diff.originalStartLine, 4);
		assert.strictEqual(diff.originalEndLine, 4);
		assert.strictEqual(diff.startLine, 4);
		assert.strictEqual(diff.endLine, 4);
	});

	test('detects modification (edit)', () => {
		const diffs = findDiffs(originalCode, modifiedCode);
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'edit');
		assert.strictEqual(diff.originalCode, 'D');
		assert.strictEqual(diff.code, 'F');
		assert.strictEqual(diff.originalStartLine, 4);
		assert.strictEqual(diff.originalEndLine, 4);
		assert.strictEqual(diff.startLine, 4);
		assert.strictEqual(diff.endLine, 4);
	});

	test('detects insertion at end of file', () => {
		const modifiedCode2 = originalCode + '\n';
		const diffs = findDiffs(originalCode, modifiedCode2);
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'insertion');
		assert.strictEqual(diff.originalCode, '');
		assert.strictEqual(diff.originalStartLine, 6);
		assert.strictEqual(diff.originalEndLine, 6);
		assert.strictEqual(diff.startLine, 6);
		assert.strictEqual(diff.endLine, 6);
	});

	test('returns empty array for identical strings', () => {
		const diffs = findDiffs(originalCode, originalCode);
		assert.strictEqual(diffs.length, 0);
	});

	test('handles empty old string', () => {
		const diffs = findDiffs('', 'A\nB');
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'insertion');
		assert.strictEqual(diff.originalCode, '');
		assert.strictEqual(diff.code, 'A\nB');
	});

	test('handles empty new string', () => {
		const diffs = findDiffs('A\nB', '');
		assert.strictEqual(diffs.length, 1);
		const diff = diffs[0];
		assert.strictEqual(diff.type, 'deletion');
		assert.strictEqual(diff.originalCode, 'A\nB');
		assert.strictEqual(diff.code, '');
	});
});
