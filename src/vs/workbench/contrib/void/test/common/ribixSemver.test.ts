/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { semverBumpFromConventionalCommits, semverBumpFromDiff, maxBump } from '../../common/ribixSemver.js';

suite('Ribix semver — conventional commits', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('feat: yields minor', () => {
		const log = 'abc123|feat: add the thing|2026-06-12';
		assert.strictEqual(semverBumpFromConventionalCommits(log), 'minor');
	});

	test('fix: and chore: yield patch', () => {
		assert.strictEqual(semverBumpFromConventionalCommits('a|fix: bug|d'), 'patch');
		assert.strictEqual(semverBumpFromConventionalCommits('a|chore: deps|d'), 'patch');
	});

	test('bang (feat!) yields major', () => {
		assert.strictEqual(semverBumpFromConventionalCommits('a|feat!: drop old api|d'), 'major');
	});

	test('BREAKING CHANGE footer yields major', () => {
		const log = 'a|fix: x|d\nBREAKING CHANGE: removed foo';
		assert.strictEqual(semverBumpFromConventionalCommits(log), 'major');
	});

	test('parsing is case-insensitive on the type prefix', () => {
		assert.strictEqual(semverBumpFromConventionalCommits('a|FEAT: thing|d'), 'minor');
	});

	test('takes the max bump across multiple commits', () => {
		const log = [
			'a|fix: small|d',
			'b|feat: feature|d',
			'c|chore: noise|d',
		].join('\n');
		assert.strictEqual(semverBumpFromConventionalCommits(log), 'minor');
	});

	test('no conventional prefixes yields patch (safe default)', () => {
		assert.strictEqual(semverBumpFromConventionalCommits('a|just some words|d'), 'patch');
		assert.strictEqual(semverBumpFromConventionalCommits(''), 'patch');
	});
});

suite('Ribix semver — diff heuristics', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('removed exported symbol implies major', () => {
		const diff = '==== a.ts ====\n@@ -1 +0 @@\n-export function foo() {}';
		assert.strictEqual(semverBumpFromDiff(diff), 'major');
	});

	test('added exported symbol implies minor', () => {
		const diff = '==== a.ts ====\n@@ -0 +1 @@\n+export function bar() {}';
		assert.strictEqual(semverBumpFromDiff(diff), 'minor');
	});

	test('internal-only change implies patch', () => {
		const diff = '==== a.ts ====\n@@ -1 +1 @@\n-  const x = 1\n+  const x = 2';
		assert.strictEqual(semverBumpFromDiff(diff), 'patch');
	});

	test('empty diff implies patch', () => {
		assert.strictEqual(semverBumpFromDiff(''), 'patch');
	});
});

suite('Ribix semver — maxBump', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('major beats minor beats patch', () => {
		assert.strictEqual(maxBump('patch', 'minor'), 'minor');
		assert.strictEqual(maxBump('minor', 'major'), 'major');
		assert.strictEqual(maxBump('major', 'patch'), 'major');
		assert.strictEqual(maxBump('patch', 'patch'), 'patch');
	});
});
