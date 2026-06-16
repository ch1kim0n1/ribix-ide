/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CostTracker, DEFAULT_MISSION_CEILING_TOKENS, MISSION_BUDGET_EXCEEDED_MESSAGE } from '../../browser/costTracker.js';

// ---------------------------------------------------------------------------

suite('CostTracker — constants', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('DEFAULT_MISSION_CEILING_TOKENS is 100_000', () => {
		assert.strictEqual(DEFAULT_MISSION_CEILING_TOKENS, 100_000);
	});

	test('MISSION_BUDGET_EXCEEDED_MESSAGE is a non-empty string', () => {
		assert.strictEqual(typeof MISSION_BUDGET_EXCEEDED_MESSAGE, 'string');
		assert.ok(MISSION_BUDGET_EXCEEDED_MESSAGE.length > 0);
	});
});

suite('CostTracker — initial state', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('starts with 0 tokens and the default ceiling', () => {
		const tracker = new CostTracker();
		assert.strictEqual(tracker.getTokenCount(), 0);
		assert.strictEqual(tracker.getCeiling(), DEFAULT_MISSION_CEILING_TOKENS);
	});

	test('custom ceiling is set correctly', () => {
		const tracker = new CostTracker(50_000);
		assert.strictEqual(tracker.getCeiling(), 50_000);
	});

	test('isOverCeiling() is false before any tokens are added', () => {
		const tracker = new CostTracker();
		assert.strictEqual(tracker.isOverCeiling(), false);
	});
});

suite('CostTracker — addTokens() and isOverCeiling()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('addTokens(50000) on 100k ceiling → isOverCeiling() false', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(50_000);
		assert.strictEqual(tracker.isOverCeiling(), false);
	});

	test('addTokens(100000) on 100k ceiling → isOverCeiling() true (at threshold)', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(100_000);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});

	test('addTokens(100001) on 100k ceiling → isOverCeiling() true (above threshold)', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(100_001);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});

	test('multiple addTokens calls accumulate correctly', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(30_000);
		tracker.addTokens(30_000);
		tracker.addTokens(30_000);
		assert.strictEqual(tracker.getTokenCount(), 90_000);
		assert.strictEqual(tracker.isOverCeiling(), false);

		tracker.addTokens(10_000);
		assert.strictEqual(tracker.getTokenCount(), 100_000);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});

	test('adding 0 tokens does not change state', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(0);
		assert.strictEqual(tracker.getTokenCount(), 0);
		assert.strictEqual(tracker.isOverCeiling(), false);
	});

	test('crossing the ceiling across two addTokens calls', () => {
		const tracker = new CostTracker(10);
		tracker.addTokens(9);
		assert.strictEqual(tracker.isOverCeiling(), false);
		tracker.addTokens(1);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});
});

suite('CostTracker — getSummary()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getSummary() returns "50000 / 100000 tokens used"', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(50_000);
		assert.strictEqual(tracker.getSummary(), '50000 / 100000 tokens used');
	});

	test('getSummary() at zero tokens', () => {
		const tracker = new CostTracker(100_000);
		assert.strictEqual(tracker.getSummary(), '0 / 100000 tokens used');
	});

	test('getSummary() at exactly the ceiling', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(100_000);
		assert.strictEqual(tracker.getSummary(), '100000 / 100000 tokens used');
	});

	test('getSummary() with a custom ceiling', () => {
		const tracker = new CostTracker(5000);
		tracker.addTokens(1234);
		assert.strictEqual(tracker.getSummary(), '1234 / 5000 tokens used');
	});
});

suite('CostTracker — getTokenCount() and getCeiling()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getTokenCount() reflects cumulative addTokens calls', () => {
		const tracker = new CostTracker();
		tracker.addTokens(1000);
		tracker.addTokens(2000);
		tracker.addTokens(3000);
		assert.strictEqual(tracker.getTokenCount(), 6000);
	});

	test('getCeiling() returns the value passed to the constructor', () => {
		const tracker = new CostTracker(42_000);
		assert.strictEqual(tracker.getCeiling(), 42_000);
	});
});

suite('CostTracker — getFraction()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getFraction() is 0 at start', () => {
		const tracker = new CostTracker(100_000);
		assert.strictEqual(tracker.getFraction(), 0);
	});

	test('getFraction() is 0.5 at half the ceiling', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(50_000);
		assert.strictEqual(tracker.getFraction(), 0.5);
	});

	test('getFraction() is clamped to 1.0 when over the ceiling', () => {
		const tracker = new CostTracker(100_000);
		tracker.addTokens(200_000);
		assert.strictEqual(tracker.getFraction(), 1);
	});

	test('getFraction() is 0 when ceiling is 0 (avoids division by zero)', () => {
		const tracker = new CostTracker(0);
		assert.strictEqual(tracker.getFraction(), 0);
	});
});
