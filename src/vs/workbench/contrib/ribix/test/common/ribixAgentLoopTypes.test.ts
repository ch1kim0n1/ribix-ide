/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentTurnMessage, DEFAULT_AGENT_BUDGETS, estimateTokens } from '../../common/ribixAgentLoopTypes.js';
import { isMission, Mission, MISSION_SCHEMA_VERSION } from '../../common/ribixTypes.js';

suite('Ribix Agent Loop Types', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('estimateTokens approximates chars/4 across messages', () => {
		const messages: AgentTurnMessage[] = [
			{ role: 'system', content: 'a'.repeat(40) },
			{ role: 'user', content: 'b'.repeat(40) },
			{ role: 'tool', toolName: 'read_file', content: 'c'.repeat(40) },
		];
		// 120 chars / 4 = 30
		assert.strictEqual(estimateTokens(messages), 30);
	});

	test('estimateTokens of empty array is 0', () => {
		assert.strictEqual(estimateTokens([]), 0);
	});

	test('every agent type has a budget with positive guards', () => {
		const types = ['planner', 'coder', 'tester', 'debugger', 'reviewer', 'docs', 'release'] as const;
		for (const t of types) {
			const b = DEFAULT_AGENT_BUDGETS[t];
			assert.ok(b, `missing budget for ${t}`);
			assert.ok(b.maxTurns > 0 && b.maxTokens > 0 && b.deadlineMs > 0, `non-positive budget for ${t}`);
		}
	});

	test('coder/tester/debugger get more turns than read-only roles', () => {
		assert.ok(DEFAULT_AGENT_BUDGETS.coder.maxTurns >= DEFAULT_AGENT_BUDGETS.reviewer.maxTurns);
		assert.ok(DEFAULT_AGENT_BUDGETS.debugger.maxTurns >= DEFAULT_AGENT_BUDGETS.docs.maxTurns);
	});
});

suite('Ribix isMission type guard', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const validMission: Mission = {
		schemaVersion: MISSION_SCHEMA_VERSION,
		id: 'm1',
		outcome: 'do the thing',
		state: 'awaiting_outcome',
		tasks: [],
		agentIds: [],
		branchName: '',
		createdAt: 1,
		completedAt: null,
		result: null,
	};

	test('accepts a well-formed mission', () => {
		assert.strictEqual(isMission(validMission), true);
	});

	test('rejects agent-shaped summary objects (no state/tasks)', () => {
		const agentShaped = { agentId: 'a', agentType: 'coder', llmResponse: 'hi', timestamp: 1 };
		assert.strictEqual(isMission(agentShaped), false);
	});

	test('rejects null / primitives / arrays', () => {
		assert.strictEqual(isMission(null), false);
		assert.strictEqual(isMission(undefined), false);
		assert.strictEqual(isMission('x'), false);
		assert.strictEqual(isMission(42), false);
		assert.strictEqual(isMission([]), false);
	});

	test('rejects mission missing tasks array', () => {
		const { tasks, ...rest } = validMission;
		assert.strictEqual(isMission(rest), false);
	});
});
