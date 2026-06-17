/*---------------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CostTracker, DEFAULT_MISSION_CEILING_TOKENS, MISSION_BUDGET_EXCEEDED_MESSAGE } from '../../../browser/costTracker.js';

suite('CostTracker', () => {
	test('initializes with default ceiling', () => {
		const tracker = new CostTracker();
		assert.strictEqual(tracker.getCeiling(), DEFAULT_MISSION_CEILING_TOKENS);
		assert.strictEqual(tracker.getTokenCount(), 0);
		assert.strictEqual(tracker.isOverCeiling(), false);
	});

	test('initializes with custom ceiling', () => {
		const tracker = new CostTracker(5000);
		assert.strictEqual(tracker.getCeiling(), 5000);
		assert.strictEqual(tracker.getTokenCount(), 0);
	});

	test('tracks token accumulation', () => {
		const tracker = new CostTracker(1000);
		tracker.addTokens(100);
		assert.strictEqual(tracker.getTokenCount(), 100);
		tracker.addTokens(200);
		assert.strictEqual(tracker.getTokenCount(), 300);
	});

	test('detects ceiling breach exactly at limit', () => {
		const tracker = new CostTracker(100);
		tracker.addTokens(100);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});

	test('detects ceiling breach above limit', () => {
		const tracker = new CostTracker(100);
		tracker.addTokens(150);
		assert.strictEqual(tracker.isOverCeiling(), true);
	});

	test('does not detect breach below limit', () => {
		const tracker = new CostTracker(100);
		tracker.addTokens(99);
		assert.strictEqual(tracker.isOverCeiling(), false);
	});

	test('getSummary returns correct format', () => {
		const tracker = new CostTracker(1000);
		tracker.addTokens(250);
		assert.strictEqual(tracker.getSummary(), '250 / 1000 tokens used');
	});

	test('getFraction returns 0 when no tokens used', () => {
		const tracker = new CostTracker(1000);
		assert.strictEqual(tracker.getFraction(), 0);
	});

	test('getFraction returns correct fraction at 50%', () => {
		const tracker = new CostTracker(1000);
		tracker.addTokens(500);
		assert.strictEqual(tracker.getFraction(), 0.5);
	});

	test('getFraction caps at 1 when over ceiling', () => {
		const tracker = new CostTracker(1000);
		tracker.addTokens(2000);
		assert.strictEqual(tracker.getFraction(), 1);
	});

	test('getFraction returns 0 when ceiling is 0', () => {
		const tracker = new CostTracker(0);
		tracker.addTokens(100);
		assert.strictEqual(tracker.getFraction(), 0);
	});

	test('MISSION_BUDGET_EXCEEDED_MESSAGE is defined', () => {
		assert.ok(MISSION_BUDGET_EXCEEDED_MESSAGE.length > 0);
		assert.ok(MISSION_BUDGET_EXCEEDED_MESSAGE.includes('token budget'));
	});
});
