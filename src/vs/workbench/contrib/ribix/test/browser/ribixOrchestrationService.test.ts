/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import { RibixOrchestrationService } from '../../browser/ribixOrchestrationService.js';
import { AgentInstance, AgentOutput, Mission, PlanTask } from '../../common/ribixTypes.js';

// --- Stubs -------------------------------------------------------------------

function task(id: string, agentType: any, dependsOn: string[] = []): PlanTask {
	return { id, agentType, description: `task ${id}`, dependsOn, riskLevel: 'low', estimatedTokens: 0, notes: '', status: 'pending' };
}

class FakeAgentService {
	private _onChange = new Emitter<void>();
	onDidChangeAgents = this._onChange.event;
	private _onComplete = new Emitter<{ agentId: string; status: 'complete' | 'failed' }>();
	onDidCompleteAgent = this._onComplete.event;

	agents = new Map<string, AgentInstance>();
	spawnCalls: Array<{ taskId: string; agentType: string; context: any }> = [];
	private counter = 0;

	async spawnAgent(missionId: string, taskId: string, agentType: any, _desc: string, context?: any): Promise<string> {
		const id = 'agent-' + (++this.counter);
		this.spawnCalls.push({ taskId, agentType, context });
		this.agents.set(id, {
			id, type: agentType, missionId, taskId, status: 'executing', currentAction: '', activityLog: [],
			filesRead: [], filesWritten: [], startedAt: 0, completedAt: null, output: null,
		});
		return id;
	}
	getAgent(id: string) { return this.agents.get(id) ?? null; }
	getAgentsForMission() { return []; }
	getAllActiveAgents() { return []; }
	getAllKnownAgents() { return []; }
	async abortAgent() { /* noop */ }

	/** Test helper: set an agent's output then fire a terminal completion event. */
	complete(agentId: string, output: AgentOutput) {
		const a = this.agents.get(agentId)!;
		a.status = 'complete';
		a.output = output;
		this._onComplete.fire({ agentId, status: 'complete' });
	}
	dispose() { this._onChange.dispose(); this._onComplete.dispose(); }
}

class FakeTaskQueue {
	async enqueue<T>(fn: (token: any) => Promise<T>, _priority: number): Promise<T> {
		return fn({ isCancellationRequested: false });
	}
}

class FakeMissionService {
	constructor(public mission: Mission) { }
	getMission(id: string) { return id === this.mission.id ? this.mission : null; }
	reviewingCalled = false;
	async setReviewing() { this.reviewingCalled = true; this.mission.state = 'reviewing'; }
}

function makeMission(tasks: PlanTask[]): Mission {
	return {
		schemaVersion: 1, id: 'm1', outcome: 'o', state: 'executing', tasks, agentIds: [],
		branchName: '', createdAt: 0, completedAt: null, result: null,
	};
}

function output(over: Partial<AgentOutput> = {}): AgentOutput {
	return { summary: 's', filesChanged: [], testReport: null, findings: [], blocked: null, rawFinalMessage: '', ...over };
}

suite('RibixOrchestrationService — event-driven handoff', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('completion event (not polling) advances a planner->coder chain', async () => {
		const tasks = [task('p', 'planner'), task('c', 'coder', ['p'])];
		const agentSvc = new FakeAgentService();
		const missionSvc = new FakeMissionService(makeMission(tasks));
		const orch = new RibixOrchestrationService(agentSvc as any, new FakeTaskQueue() as any, missionSvc as any);

		await orch.executeMission('m1');
		// Only the planner is ready initially.
		assert.strictEqual(agentSvc.spawnCalls.length, 1);
		assert.strictEqual(agentSvc.spawnCalls[0].agentType, 'planner');

		// Fire planner completion with structured output; coder should now spawn synchronously.
		agentSvc.complete('agent-1', output({ summary: 'PLAN: do X then Y', filesChanged: [] }));
		// allow the async handleTaskCompletion chain to settle
		await new Promise(r => setTimeout(r, 0));

		assert.strictEqual(agentSvc.spawnCalls.length, 2, 'coder spawned after planner completed via event');
		const coderCall = agentSvc.spawnCalls[1];
		assert.strictEqual(coderCall.agentType, 'coder');
		assert.ok(String(coderCall.context.plannerOutput).includes('PLAN: do X then Y'),
			'coder receives the planner structured summary, not a last-log string');

		orch.dispose();
		agentSvc.dispose();
	});

	test('coder filesChanged surfaces in the tester prompt context', async () => {
		const tasks = [task('c', 'coder'), task('t', 'tester', ['c'])];
		const agentSvc = new FakeAgentService();
		const missionSvc = new FakeMissionService(makeMission(tasks));
		const orch = new RibixOrchestrationService(agentSvc as any, new FakeTaskQueue() as any, missionSvc as any);

		await orch.executeMission('m1');
		agentSvc.complete('agent-1', output({ summary: 'wrote code', filesChanged: ['/repo/x.ts', '/repo/y.ts'] }));
		await new Promise(r => setTimeout(r, 0));

		const testerCall = agentSvc.spawnCalls.find(c => c.agentType === 'tester')!;
		assert.ok(testerCall, 'tester spawned');
		assert.ok(String(testerCall.context.coderOutput).includes('/repo/x.ts'), 'tester sees coder files changed');

		orch.dispose();
		agentSvc.dispose();
	});

	test('reviewer receives a non-empty testReport from upstream tester', async () => {
		const tasks = [task('t', 'tester'), task('r', 'reviewer', ['t'])];
		const agentSvc = new FakeAgentService();
		const missionSvc = new FakeMissionService(makeMission(tasks));
		const orch = new RibixOrchestrationService(agentSvc as any, new FakeTaskQueue() as any, missionSvc as any);

		await orch.executeMission('m1');
		agentSvc.complete('agent-1', output({ summary: 'ran tests', testReport: '3 passing / 1 failing' }));
		await new Promise(r => setTimeout(r, 0));

		const reviewerCall = agentSvc.spawnCalls.find(c => c.agentType === 'reviewer')!;
		assert.ok(reviewerCall);
		assert.strictEqual(reviewerCall.context.testReport, '3 passing / 1 failing');

		orch.dispose();
		agentSvc.dispose();
	});

	test('all tasks complete transitions the mission to reviewing', async () => {
		const tasks = [task('only', 'coder')];
		const agentSvc = new FakeAgentService();
		const missionSvc = new FakeMissionService(makeMission(tasks));
		const orch = new RibixOrchestrationService(agentSvc as any, new FakeTaskQueue() as any, missionSvc as any);

		await orch.executeMission('m1');
		agentSvc.complete('agent-1', output());
		await new Promise(r => setTimeout(r, 0));

		assert.strictEqual(missionSvc.reviewingCalled, true);
		orch.dispose();
		agentSvc.dispose();
	});
});
