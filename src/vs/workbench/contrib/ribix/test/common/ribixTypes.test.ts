/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	isMission,
	DETECTION_CATEGORY_DESCRIPTIONS,
	MISSION_SCHEMA_VERSION,
	type Mission,
	type AgentFindingType,
} from '../../common/ribixTypes.js';

// ---------------------------------------------------------------------------
// isMission — type guard for validating persisted Mission records
// ---------------------------------------------------------------------------

suite('isMission — valid missions', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts a minimal well-formed mission', () => {
		const m: Mission = {
			schemaVersion: MISSION_SCHEMA_VERSION,
			id: 'mission-1',
			outcome: 'fix the bug',
			state: 'planning',
			tasks: [],
			agentIds: [],
			branchName: 'main',
			createdAt: Date.now(),
			completedAt: null,
			result: null,
		};
		assert.strictEqual(isMission(m), true);
	});

	test('accepts a mission with tasks and agents', () => {
		const m: Mission = {
			schemaVersion: MISSION_SCHEMA_VERSION,
			id: 'mission-2',
			outcome: 'add feature',
			state: 'executing',
			tasks: [{ id: 't1', agentType: 'coder', description: 'write code', dependsOn: [], riskLevel: 'low', estimatedTokens: 1000, notes: '', status: 'in_progress' }],
			agentIds: ['agent-1'],
			branchName: 'feature/x',
			createdAt: Date.now(),
			completedAt: null,
			result: null,
		};
		assert.strictEqual(isMission(m), true);
	});

	test('accepts a completed mission with result', () => {
		const m: Mission = {
			schemaVersion: MISSION_SCHEMA_VERSION,
			id: 'mission-3',
			outcome: 'review PR',
			state: 'complete',
			tasks: [],
			agentIds: [],
			branchName: 'main',
			createdAt: Date.now(),
			completedAt: Date.now(),
			result: {
				summary: 'done',
				filesChanged: ['src/index.ts'],
				testReport: 'all pass',
				reviewerFindings: [],
				commitSha: 'abc123',
				prUrl: 'https://github.com/repo/pull/1',
			},
		};
		assert.strictEqual(isMission(m), true);
	});
});

suite('isMission — invalid inputs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects null', () => {
		assert.strictEqual(isMission(null), false);
	});

	test('rejects undefined', () => {
		assert.strictEqual(isMission(undefined), false);
	});

	test('rejects primitives', () => {
		assert.strictEqual(isMission('string'), false);
		assert.strictEqual(isMission(42), false);
		assert.strictEqual(isMission(true), false);
	});

	test('rejects object without id string', () => {
		assert.strictEqual(isMission({ state: 'planning', tasks: [] }), false);
	});

	test('rejects object with non-string id', () => {
		assert.strictEqual(isMission({ id: 123, state: 'planning', tasks: [] }), false);
	});

	test('rejects object without state string', () => {
		assert.strictEqual(isMission({ id: 'm1', tasks: [] }), false);
	});

	test('rejects object with non-string state', () => {
		assert.strictEqual(isMission({ id: 'm1', state: 42, tasks: [] }), false);
	});

	test('rejects object without tasks array', () => {
		assert.strictEqual(isMission({ id: 'm1', state: 'planning' }), false);
	});

	test('rejects object with non-array tasks', () => {
		assert.strictEqual(isMission({ id: 'm1', state: 'planning', tasks: 'not-an-array' }), false);
	});

	test('rejects empty object', () => {
		assert.strictEqual(isMission({}), false);
	});
});

// ---------------------------------------------------------------------------
// DETECTION_CATEGORY_DESCRIPTIONS — all categories have descriptions
// ---------------------------------------------------------------------------

suite('DETECTION_CATEGORY_DESCRIPTIONS', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const expectedCategories: AgentFindingType[] = [
		'data-loss-risk',
		'rate-limit-blind',
		'env-parity',
		'third-party-resilience',
		'legal-compliance',
		'copy-consistency',
		'observability-gap',
		'day-2-failure',
		'code-architecture',
		'onboarding-drop-off',
		'ai-smell',
	];

	test('covers all expected categories', () => {
		for (const cat of expectedCategories) {
			assert.ok(cat in DETECTION_CATEGORY_DESCRIPTIONS, `missing category: ${cat}`);
		}
	});

	test('every description is a non-empty string', () => {
		for (const cat of expectedCategories) {
			const desc = DETECTION_CATEGORY_DESCRIPTIONS[cat];
			assert.ok(typeof desc === 'string', `${cat} description is not a string`);
			assert.ok(desc.length > 0, `${cat} description is empty`);
		}
	});

	test('descriptions are distinct (no two categories share the same text)', () => {
		const descs = Object.values(DETECTION_CATEGORY_DESCRIPTIONS);
		const unique = new Set(descs);
		assert.strictEqual(descs.length, unique.size, 'duplicate descriptions found');
	});
});

// ---------------------------------------------------------------------------
// MISSION_SCHEMA_VERSION
// ---------------------------------------------------------------------------

suite('MISSION_SCHEMA_VERSION', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('is a positive integer', () => {
		assert.ok(typeof MISSION_SCHEMA_VERSION === 'number');
		assert.ok(Number.isInteger(MISSION_SCHEMA_VERSION));
		assert.ok(MISSION_SCHEMA_VERSION > 0);
	});
});
