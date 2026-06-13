/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseUnifiedDiffRanges,
	parseSampledDiffsToChunk,
	diffLineRanges,
	rangesAreEmpty,
	IGNORED_PATH_SEGMENTS,
	isIgnoredPath,
} from '../../common/ribixChangedChunk.js';

suite('Ribix changed-chunk — parseUnifiedDiffRanges', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('single hunk yields one range from the new-file line span', () => {
		const diff = [
			'diff --git a/foo.ts b/foo.ts',
			'@@ -10,0 +10,5 @@',
			'+a', '+b', '+c', '+d', '+e',
		].join('\n');
		assert.deepStrictEqual(parseUnifiedDiffRanges(diff), [[10, 14]]);
	});

	test('two hunks yield two ranges', () => {
		const diff = [
			'@@ -1,2 +1,2 @@',
			'-old', '+new',
			'@@ -20,0 +25,3 @@',
			'+x', '+y', '+z',
		].join('\n');
		assert.deepStrictEqual(parseUnifiedDiffRanges(diff), [[1, 2], [25, 27]]);
	});

	test('hunk header without count defaults to a single line', () => {
		const diff = ['@@ -5 +7 @@', '-a', '+b'].join('\n');
		assert.deepStrictEqual(parseUnifiedDiffRanges(diff), [[7, 7]]);
	});

	test('pure deletion (new count 0) produces no range', () => {
		const diff = ['@@ -3,2 +2,0 @@', '-gone1', '-gone2'].join('\n');
		assert.deepStrictEqual(parseUnifiedDiffRanges(diff), []);
	});

	test('no hunks yields no ranges', () => {
		assert.deepStrictEqual(parseUnifiedDiffRanges(''), []);
		assert.deepStrictEqual(parseUnifiedDiffRanges('not a diff at all'), []);
	});
});

suite('Ribix changed-chunk — parseSampledDiffsToChunk', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses the gitSampledDiffs ==== file ==== blocks into per-file ranges', () => {
		const sampled = [
			'==== src/a.ts ====',
			'@@ -1,0 +1,2 @@',
			'+one', '+two',
			'',
			'==== src/b.ts ====',
			'@@ -10,1 +10,1 @@',
			'-x', '+y',
		].join('\n');
		const files = parseSampledDiffsToChunk(sampled);
		assert.strictEqual(files.length, 2);
		assert.strictEqual(files[0].uri, 'src/a.ts');
		assert.deepStrictEqual(files[0].ranges, [[1, 2]]);
		assert.strictEqual(files[1].uri, 'src/b.ts');
		assert.deepStrictEqual(files[1].ranges, [[10, 10]]);
	});

	test('drops files that produce no ranges (whitespace/deletion-only)', () => {
		const sampled = [
			'==== src/deleted.ts ====',
			'@@ -3,2 +2,0 @@',
			'-gone1', '-gone2',
		].join('\n');
		assert.deepStrictEqual(parseSampledDiffsToChunk(sampled), []);
	});

	test('empty input yields no files', () => {
		assert.deepStrictEqual(parseSampledDiffsToChunk(''), []);
	});
});

suite('Ribix changed-chunk — diffLineRanges (save-scoped)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('changed lines 10-14 in a buffer produce [[10,14]]', () => {
		const before = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
		const afterLines = before.split('\n');
		for (let i = 9; i <= 13; i++) { afterLines[i] = `CHANGED${i + 1}`; }
		const after = afterLines.join('\n');
		assert.deepStrictEqual(diffLineRanges(before, after), [[10, 14]]);
	});

	test('identical buffers produce no ranges', () => {
		const s = 'a\nb\nc';
		assert.deepStrictEqual(diffLineRanges(s, s), []);
	});

	test('whitespace-only change produces no ranges', () => {
		const before = 'a\nb\nc';
		const after = 'a  \nb\t\nc';
		assert.deepStrictEqual(diffLineRanges(before, after), []);
	});

	test('appended lines extend the range', () => {
		const before = 'a\nb';
		const after = 'a\nb\nc\nd';
		assert.deepStrictEqual(diffLineRanges(before, after), [[3, 4]]);
	});

	test('a brand-new buffer (empty before) marks every line', () => {
		assert.deepStrictEqual(diffLineRanges('', 'x\ny'), [[1, 2]]);
	});
});

suite('Ribix changed-chunk — helpers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('rangesAreEmpty is true for [] and false otherwise', () => {
		assert.strictEqual(rangesAreEmpty([]), true);
		assert.strictEqual(rangesAreEmpty([[1, 1]]), false);
	});

	test('isIgnoredPath flags node_modules / out / .git / dist', () => {
		for (const seg of IGNORED_PATH_SEGMENTS) {
			assert.strictEqual(isIgnoredPath(`/repo/${seg}/x.ts`), true, seg);
		}
		assert.strictEqual(isIgnoredPath('/repo/src/index.ts'), false);
	});

	test('isIgnoredPath flags lockfiles and minified/map artifacts', () => {
		assert.strictEqual(isIgnoredPath('/repo/package-lock.json'), true);
		assert.strictEqual(isIgnoredPath('/repo/src/app.min.js'), true);
		assert.strictEqual(isIgnoredPath('/repo/src/app.js.map'), true);
	});
});
