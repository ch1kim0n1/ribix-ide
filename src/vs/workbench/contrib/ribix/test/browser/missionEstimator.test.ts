/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { estimateMissionDuration, quickEstimateFromDescription } from '../../browser/missionEstimator.js';

// ---------------------------------------------------------------------------
// Reference formula:
//   base            = 5 min
//   + 2 min per 100 chars of description (Math.round)
//   + 1 min per 1000 repo files (Math.round)
//   + 3 min per planned agent
//   minMinutes = Math.max(1, computed)
//   maxMinutes = Math.max(minMinutes + 1, Math.ceil(minMinutes * 1.5))
//   label = `${minMinutes}–${maxMinutes} minutes`
// ---------------------------------------------------------------------------

suite('estimateMissionDuration() — base case', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('0 chars, 0 files, 1 agent → min=8, max=12', () => {
		// base=5, desc=0, files=0, agents=3 → wait, 1 agent = 1*3=3 → 5+0+0+3=8
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 1 });
		assert.strictEqual(result.minMinutes, 8);
		assert.strictEqual(result.maxMinutes, 12);
	});

	test('label format is "N–M minutes"', () => {
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 1 });
		assert.strictEqual(result.label, '8–12 minutes');
	});
});

suite('estimateMissionDuration() — description length scaling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('100 chars → +2 min (min=8+2=10, agents=1)', () => {
		// base=5, desc=round(100/100*2)=2, files=0, agents=3 → 10
		const result = estimateMissionDuration({ descriptionLength: 100, repoFileCount: 0, agentCount: 1 });
		assert.strictEqual(result.minMinutes, 10);
	});

	test('500 chars → +10 min (min=8+10=18, agents=1)', () => {
		// base=5, desc=round(500/100*2)=10, files=0, agents=3 → 18
		const result = estimateMissionDuration({ descriptionLength: 500, repoFileCount: 0, agentCount: 1 });
		assert.strictEqual(result.minMinutes, 18);
	});

	test('200 chars → +4 min (base case 3 agents: 5+4+0+9=18)', () => {
		// Matches the docstring example partially.
		const result = estimateMissionDuration({ descriptionLength: 200, repoFileCount: 3000, agentCount: 3 });
		// base=5, desc=round(200/100*2)=4, files=round(3000/1000*1)=3, agents=3*3=9 → 21
		// Actually 5+4+3+9=21, max=ceil(21*1.5)=32 — just verify formula consistency
		assert.strictEqual(result.minMinutes, 21);
		assert.strictEqual(result.maxMinutes, Math.max(22, Math.ceil(21 * 1.5)));
	});
});

suite('estimateMissionDuration() — file count scaling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('1000 files → +1 min (0 chars, 1 agent: 5+0+1+3=9)', () => {
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 1000, agentCount: 1 });
		assert.strictEqual(result.minMinutes, 9);
	});

	test('500 files → rounds to 1 (Math.round(0.5)=1 or 0 depending on JS — validate actual)', () => {
		// Math.round(500/1000 * 1) = Math.round(0.5) = 1 in JS (rounds to even? No, JS rounds 0.5 up to 1)
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 500, agentCount: 1 });
		// 5 + 0 + 1 + 3 = 9
		const filesMinutes = Math.round((500 / 1000) * 1);
		assert.strictEqual(result.minMinutes, 5 + 0 + filesMinutes + 3);
	});

	test('0 files (omitted) defaults to 0 file minutes', () => {
		// repoFileCount is optional and defaults to 0
		const result = estimateMissionDuration({ descriptionLength: 0, agentCount: 1 });
		assert.strictEqual(result.minMinutes, 8);
	});
});

suite('estimateMissionDuration() — agent count scaling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('3 agents → +9 min (0 chars, 0 files: 5+0+0+9=14)', () => {
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 3 });
		assert.strictEqual(result.minMinutes, 14);
	});

	test('0 agents → +0 min (0 chars, 0 files: 5+0+0+0=5)', () => {
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 0 });
		assert.strictEqual(result.minMinutes, 5);
	});

	test('5 agents → +15 min (0 chars, 0 files: 5+0+0+15=20)', () => {
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 5 });
		assert.strictEqual(result.minMinutes, 20);
	});
});

suite('estimateMissionDuration() — max scaling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('maxMinutes is Math.ceil(minMinutes * 1.5) when that exceeds minMinutes+1', () => {
		// 0 chars, 0 files, 1 agent → min=8, 8*1.5=12, ceil(12)=12 ≥ 8+1=9 → max=12
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 1 });
		assert.strictEqual(result.maxMinutes, Math.ceil(result.minMinutes * 1.5));
	});

	test('maxMinutes is at least minMinutes+1 (never equal to min)', () => {
		// Use agentCount=0 so minMinutes=5 (base only), max=ceil(5*1.5)=8 ≥ 6 → 8
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 0 });
		assert.ok(result.maxMinutes > result.minMinutes);
	});

	test('minMinutes is clamped to at least 1', () => {
		// Even with 0 everything, base=5 so min ≥ 1 always.
		// But to test clamping: the formula can't go below 1 naturally since base=5.
		// Verify the contract holds.
		const result = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 0 });
		assert.ok(result.minMinutes >= 1);
	});

	test('label matches computed min and max', () => {
		const result = estimateMissionDuration({ descriptionLength: 200, repoFileCount: 3000, agentCount: 3 });
		assert.strictEqual(result.label, `${result.minMinutes}–${result.maxMinutes} minutes`);
	});
});

suite('estimateMissionDuration() — docstring example', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('descriptionLength=200, repoFileCount=3000, agentCount=3 → min=21, max=32', () => {
		// base=5, desc=round(200/100*2)=4, files=round(3000/1000*1)=3, agents=3*3=9 → 21
		// max=ceil(21*1.5)=ceil(31.5)=32
		const result = estimateMissionDuration({ descriptionLength: 200, repoFileCount: 3000, agentCount: 3 });
		assert.strictEqual(result.minMinutes, 21);
		assert.strictEqual(result.maxMinutes, 32);
		assert.strictEqual(result.label, '21–32 minutes');
	});
});

suite('quickEstimateFromDescription()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses description.length, 0 file count, and 3 agents', () => {
		const description = 'a'.repeat(100);
		const quick = quickEstimateFromDescription(description);
		const full = estimateMissionDuration({ descriptionLength: 100, repoFileCount: 0, agentCount: 3 });
		assert.strictEqual(quick.minMinutes, full.minMinutes);
		assert.strictEqual(quick.maxMinutes, full.maxMinutes);
		assert.strictEqual(quick.label, full.label);
	});

	test('empty string → same as 0 chars, 0 files, 3 agents', () => {
		const quick = quickEstimateFromDescription('');
		const full = estimateMissionDuration({ descriptionLength: 0, repoFileCount: 0, agentCount: 3 });
		assert.strictEqual(quick.minMinutes, full.minMinutes);
	});
});
