/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseRibixIgnore,
	compileGlob,
	isSuppressed,
	isPathSuppressed,
	filterSuppressed,
} from '../../common/ribixSuppression.js';
import { AgentFinding } from '../../common/ribixTypes.js';

function finding(over: Partial<AgentFinding> = {}): AgentFinding {
	return { severity: 'medium', file: 'src/app.ts', line: 1, message: 'msg', ...over };
}

suite('ribixSuppression', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('compileGlob: basename-only pattern matches anywhere in the tree', () => {
		const re = compileGlob('*.generated.ts');
		assert.ok(re.test('src/deep/foo.generated.ts'));
		assert.ok(re.test('foo.generated.ts'));
		assert.ok(!re.test('src/foo.ts'));
	});

	test('compileGlob: ** matches across directory boundaries', () => {
		const re = compileGlob('src/legacy/**');
		assert.ok(re.test('src/legacy/a.ts'));
		assert.ok(re.test('src/legacy/deep/nested/b.ts'));
		assert.ok(!re.test('src/modern/a.ts'));
	});

	test('compileGlob: anchored (leading slash) only matches from root', () => {
		const re = compileGlob('/build');
		assert.ok(re.test('build'));
		assert.ok(!re.test('src/build'));
	});

	test('compileGlob: trailing slash matches the dir and everything under it', () => {
		const re = compileGlob('dist/');
		assert.ok(re.test('dist'));
		assert.ok(re.test('dist/bundle.js'));
		assert.ok(!re.test('src/dist-config.ts'));
	});

	test('parseRibixIgnore: separates path globs from type rules, ignores comments/blanks', () => {
		const rules = parseRibixIgnore([
			'# ignore generated code',
			'src/generated/**',
			'',
			'  type: ai-smell  ',
			'!src/generated/keep.ts',
			'type:copy-consistency',
		].join('\n'));

		assert.strictEqual(rules.typeRules.length, 2);
		assert.deepStrictEqual(rules.typeRules.map(r => r.findingType).sort(), ['ai-smell', 'copy-consistency']);
		assert.strictEqual(rules.pathRules.length, 2);
		assert.strictEqual(rules.pathRules.find(r => r.negated)?.glob, 'src/generated/keep.ts');
		assert.ok(rules.raw.length > 0, 'raw is preserved for backend forwarding');
	});

	test('isSuppressed: type rule silences an entire finding category', () => {
		const rules = parseRibixIgnore('type:ai-smell');
		assert.ok(isSuppressed(finding({ findingType: 'ai-smell' }), rules));
		assert.ok(!isSuppressed(finding({ findingType: 'data-loss-risk' }), rules));
		assert.ok(!isSuppressed(finding({ findingType: undefined }), rules), 'no findingType -> not type-suppressed');
	});

	test('isSuppressed: path glob silences findings in matching files', () => {
		const rules = parseRibixIgnore('src/legacy/**');
		assert.ok(isSuppressed(finding({ file: 'src/legacy/old.ts' }), rules));
		assert.ok(!isSuppressed(finding({ file: 'src/app.ts' }), rules));
	});

	test('isPathSuppressed: negation re-includes a previously matched path (gitignore semantics)', () => {
		const rules = parseRibixIgnore(['src/legacy/**', '!src/legacy/keep.ts'].join('\n'));
		assert.ok(isPathSuppressed('src/legacy/old.ts', rules.pathRules), 'matched by the broad glob');
		assert.ok(!isPathSuppressed('src/legacy/keep.ts', rules.pathRules), 're-included by negation');
	});

	test('isPathSuppressed: normalizes backslashes so Windows paths match forward-slash globs', () => {
		const rules = parseRibixIgnore('src/legacy/**');
		assert.ok(isPathSuppressed('src\\legacy\\old.ts', rules.pathRules));
	});

	test('filterSuppressed: drops only suppressed findings, keeps the rest', () => {
		const rules = parseRibixIgnore(['type:ai-smell', 'src/legacy/**'].join('\n'));
		const findings = [
			finding({ file: 'src/app.ts', findingType: 'bug' as any, message: 'keep me' }),
			finding({ file: 'src/legacy/x.ts', message: 'drop: path' }),
			finding({ file: 'src/app.ts', findingType: 'ai-smell', message: 'drop: type' }),
		];
		const kept = filterSuppressed(findings, rules);
		assert.strictEqual(kept.length, 1);
		assert.strictEqual(kept[0].message, 'keep me');
	});
});
