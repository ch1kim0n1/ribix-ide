/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Event } from '../../../../../base/common/event.js';
import { RibixAgentService } from '../../browser/ribixAgentService.js';
import { DEFAULT_AGENT_BUDGETS } from '../../common/ribixAgentLoopTypes.js';

// --- Stub helpers ------------------------------------------------------------

/** Scripted LLM: returns the next queued reply on each sendLLMMessage call. */
function makeLLMStub(replies: string[]) {
	let i = 0;
	let aborted = false;
	const calls: Array<{ messages: any[]; separateSystemMessage: string | undefined }> = [];
	return {
		aborted: () => aborted,
		callCount: () => i,
		callsLog: calls,
		service: {
			sendLLMMessage(params: any) {
				calls.push({ messages: params.messages, separateSystemMessage: params.separateSystemMessage });
				const reply = replies[i] ?? '';
				i++;
				// resolve asynchronously like the real service
				setTimeout(() => params.onFinalMessage({ fullText: reply, fullReasoning: '', anthropicReasoning: null }), 0);
				return 'req-' + i;
			},
			abort(_id: string) { aborted = true; },
		} as any,
	};
}

/** Records tool invocations; stringOfResult returns a canned string per tool. */
function makeToolsStub(stringResults: Record<string, string>) {
	const callTool: Record<string, any> = {};
	const validateParams: Record<string, any> = {};
	const stringOfResult: Record<string, any> = {};
	const invoked: Array<{ tool: string; params: any }> = [];
	for (const tool of ['read_file', 'rewrite_file', 'run_command', 'ls_dir']) {
		validateParams[tool] = (p: any) => ({ ...p, uri: p.uri ? { fsPath: p.uri } : undefined });
		callTool[tool] = async (p: any) => { invoked.push({ tool, params: p }); return { result: { ok: true } }; };
		stringOfResult[tool] = (_p: any, _r: any) => stringResults[tool] ?? `(${tool} result)`;
	}
	return { invoked, service: { validateParams, callTool, stringOfResult } as any };
}

const memoryStub = {
	written: [] as any[],
	getWorkspaceId: async () => 'ws',
	getEntries: async () => [],
	writeEntry: async (e: any) => { memoryStub.written.push(e); return e; },
} as any;

const lockStub = {
	acquire: async (_path: string, _id: string) => () => { /* release */ },
} as any;

const checkpointStub = {
	checkpoint: async () => { /* noop */ },
} as any;

const settingsStub = {
	state: { modelSelectionOfFeature: { Chat: { providerName: 'anthropic', modelName: 'x' } } },
} as any;

const mcpStub = {
	getMCPTools: () => [],
} as any;

function makeAgentService(llm: any, tools: any) {
	return new RibixAgentService(
		tools,
		llm,
		lockStub,
		{ ...memoryStub, written: [] },
		checkpointStub,
		settingsStub,
		mcpStub,
	);
}

function waitForCompletion(service: RibixAgentService): Promise<{ agentId: string; status: string }> {
	return Event.toPromise(service.onDidCompleteAgent);
}

// --- Tests -------------------------------------------------------------------

suite('RibixAgentService — agentic loop', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('feeds tool results back and runs multiple turns', async () => {
		// Turn 1: emit a read_file tool call. Turn 2: no tool calls -> done.
		const llm = makeLLMStub([
			'I will read the file.\n```json\n{"tool":"read_file","params":{"uri":"/repo/a.ts"}}\n```',
			'Summary: the file defines a helper.',
		]);
		const tools = makeToolsStub({ read_file: 'export function helper() {}' });
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'coder', 'Read /repo/a.ts then summarize it');
		const result = await completion;

		assert.strictEqual(result.status, 'complete');
		assert.strictEqual(llm.callCount(), 2, 'should perform 2 LLM turns');
		assert.strictEqual(tools.invoked.length, 1, 'should execute read_file once');
		assert.strictEqual(tools.invoked[0].tool, 'read_file');

		// The tool result must have been fed back into the second LLM call's messages.
		const secondCallMessages = llm.callsLog[1].messages;
		const fedBack = secondCallMessages.some((m: any) =>
			typeof m.content === 'string' && m.content.includes('export function helper()'));
		assert.ok(fedBack, 'tool result should be fed back to the model on turn 2');

		const agent = service.getAgent(agentId)!;
		assert.strictEqual(agent.status, 'complete');
		assert.ok(agent.output, 'agent should have structured output');
		assert.ok(agent.output!.summary.includes('helper'), 'summary should reference real content');
		assert.deepStrictEqual(agent.filesRead, ['/repo/a.ts']);

		service.dispose();
	});

	test('tool result from an early turn stays visible on later turns (true multi-turn, not one-shot)', async () => {
		// Turn 1: read a file. Turn 2: read a second file (reacting to turn 1). Turn 3: done.
		// We assert the FIRST tool result is still present in the messages sent on turn 3,
		// which is the invariant that distinguishes an autonomous loop from a one-shot call.
		const llm = makeLLMStub([
			'Reading first.\n```json\n{"tool":"read_file","params":{"uri":"/repo/first.ts"}}\n```',
			'Now the second.\n```json\n{"tool":"read_file","params":{"uri":"/repo/second.ts"}}\n```',
			'Summary: combined both files.',
		]);
		// Distinct canned results per call so we can trace which result flows where.
		let readCount = 0;
		const tools = (() => {
			const callTool: Record<string, any> = {};
			const validateParams: Record<string, any> = {};
			const stringOfResult: Record<string, any> = {};
			const invoked: Array<{ tool: string; params: any }> = [];
			validateParams['read_file'] = (p: any) => ({ ...p, uri: { fsPath: p.uri } });
			callTool['read_file'] = async (p: any) => { invoked.push({ tool: 'read_file', params: p }); return { result: {} }; };
			stringOfResult['read_file'] = () => (readCount++ === 0 ? 'CONTENT_FIRST_FILE' : 'CONTENT_SECOND_FILE');
			return { invoked, service: { validateParams, callTool, stringOfResult } as any };
		})();

		const service = makeAgentService(llm.service, tools.service);
		const completion = waitForCompletion(service);
		await service.spawnAgent('m1', 't1', 'coder', 'Read two files then summarize');
		const result = await completion;

		assert.strictEqual(result.status, 'complete');
		assert.strictEqual(llm.callCount(), 3, 'should perform 3 LLM turns');
		assert.strictEqual(tools.invoked.length, 2, 'should read two files');

		// Turn 2 must contain the first tool result.
		const turn2 = llm.callsLog[1].messages;
		assert.ok(
			turn2.some((m: any) => typeof m.content === 'string' && m.content.includes('CONTENT_FIRST_FILE')),
			'first tool result must be visible on turn 2',
		);

		// Turn 3 must STILL contain the first tool result AND the second — the message array grows.
		const turn3 = llm.callsLog[2].messages;
		assert.ok(
			turn3.some((m: any) => typeof m.content === 'string' && m.content.includes('CONTENT_FIRST_FILE')),
			'first tool result must remain visible on turn 3 (loop is not one-shot)',
		);
		assert.ok(
			turn3.some((m: any) => typeof m.content === 'string' && m.content.includes('CONTENT_SECOND_FILE')),
			'second tool result must be visible on turn 3',
		);

		service.dispose();
	});

	test('stops when the model emits no tool calls on the first turn', async () => {
		const llm = makeLLMStub(['Nothing to do. Summary: trivial.']);
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		await service.spawnAgent('m1', 't1', 'reviewer', 'review');
		await completion;

		assert.strictEqual(llm.callCount(), 1);
		assert.strictEqual(tools.invoked.length, 0);
		service.dispose();
	});

	test('budget cap terminates complete-with-warning, not hung', async () => {
		// Always emit a tool call so only the turn budget can stop it.
		const everyTurnToolCall = 'go\n```json\n{"tool":"ls_dir","params":{"uri":"/repo"}}\n```';
		const llm = makeLLMStub(new Array(50).fill(everyTurnToolCall));
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'planner', 'loop forever'); // planner maxTurns=6
		const result = await completion;

		assert.strictEqual(result.status, 'complete', 'budget exhaustion completes, does not hang');
		assert.strictEqual(llm.callCount(), 6, 'planner budget caps at 6 turns');
		const agent = service.getAgent(agentId)!;
		assert.ok(agent.output!.blocked, 'budget-exhausted run should be marked blocked');
		service.dispose();
	});

	test('write tool acquires lock + checkpoint and records filesWritten', async () => {
		let lockAcquired = false;
		let lockReleased = false;
		let checkpointed = false;
		const lock = { acquire: async () => { lockAcquired = true; return () => { lockReleased = true; }; } } as any;
		const checkpoint = { checkpoint: async () => { checkpointed = true; } } as any;

		const llm = makeLLMStub([
			'writing\n```json\n{"tool":"rewrite_file","params":{"uri":"/repo/b.ts"}}\n```',
			'Summary: wrote the file.',
		]);
		const tools = makeToolsStub({ rewrite_file: 'wrote 1 file' });
		const service = new RibixAgentService(
			tools.service, llm.service, lock, { ...memoryStub, written: [] }, checkpoint, settingsStub, mcpStub,
		);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'coder', 'write b.ts');
		await completion;

		assert.ok(lockAcquired, 'lock acquired before write');
		assert.ok(checkpointed, 'checkpoint created before write');
		assert.ok(lockReleased, 'lock released in finally');
		assert.deepStrictEqual(service.getAgent(agentId)!.filesWritten, ['/repo/b.ts']);
		service.dispose();
	});

	test('persists the run under the agent_run memory type (not mission_summary)', async () => {
		const written: any[] = [];
		const mem = { getWorkspaceId: async () => 'ws', getEntries: async () => [], writeEntry: async (e: any) => { written.push(e); return e; } } as any;
		const llm = makeLLMStub(['Summary: done.']);
		const tools = makeToolsStub({});
		const service = new RibixAgentService(tools.service, llm.service, lockStub, mem, checkpointStub, settingsStub, mcpStub);

		const completion = waitForCompletion(service);
		await service.spawnAgent('m1', 't1', 'coder', 'noop');
		await completion;

		assert.strictEqual(written.length, 1);
		assert.strictEqual(written[0].type, 'agent_run', 'must not collide with mission_summary');
		service.dispose();
	});

	test('reviewer findings are parsed into structured output', async () => {
		const findingsJson = 'Review done.\n```json\n[{"severity":"high","file":"/repo/a.ts","line":12,"message":"null deref"}]\n```';
		const llm = makeLLMStub([findingsJson]);
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'reviewer', 'review');
		await completion;

		const findings = service.getAgent(agentId)!.output!.findings;
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'high');
		assert.strictEqual(findings[0].line, 12);
		service.dispose();
	});
});

// --- Budget enforcement tests ------------------------------------------------

suite('RibixAgentService — loop budget enforcement', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('agent stops when maxTurns reached (planner caps at 6)', async () => {
		// Planner budget: maxTurns=6. Always emit a tool call so only the turn cap stops it.
		const everyTurnToolCall = 'go\n```json\n{"tool":"ls_dir","params":{"uri":"/repo"}}\n```';
		const llm = makeLLMStub(new Array(50).fill(everyTurnToolCall));
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'planner', 'loop forever');
		const result = await completion;

		// Loop must terminate cleanly (not hang) and be marked as complete.
		assert.strictEqual(result.status, 'complete', 'budget exhaustion completes, does not hang');
		assert.strictEqual(llm.callCount(), DEFAULT_AGENT_BUDGETS.planner.maxTurns,
			`planner should perform exactly ${DEFAULT_AGENT_BUDGETS.planner.maxTurns} LLM turns`);

		const agent = service.getAgent(agentId)!;
		assert.strictEqual(agent.status, 'complete');
		assert.ok(agent.output!.blocked, 'budget-exhausted run must be marked blocked');
		assert.ok(agent.output!.blocked!.reason.includes('maxTurns'), 'blocked reason must reference maxTurns');

		service.dispose();
	});

	test('agent stops when maxTokens exceeded', async () => {
		// Craft a taskDescription large enough that the initial message array
		// (system prompt + user message) exceeds the planner's maxTokens budget of 80,000.
		// estimateTokens = ceil(totalChars / 4), so we need totalChars > 320,000.
		// Passing 321,000 'x' chars guarantees we exceed the limit on turn 0.
		const hugeTask = 'x'.repeat(321_000);
		const llm = makeLLMStub(['this should never be called']);
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		const completion = waitForCompletion(service);
		const agentId = await service.spawnAgent('m1', 't1', 'planner', hugeTask);
		const result = await completion;

		// The token check fires before the first LLM call, so callCount must be 0.
		assert.strictEqual(result.status, 'complete', 'token budget exhaustion completes cleanly');
		assert.strictEqual(llm.callCount(), 0, 'LLM must not be called when token budget is exceeded before turn 0');

		const agent = service.getAgent(agentId)!;
		assert.ok(agent.output!.blocked, 'token-over-budget run must be marked blocked');
		assert.ok(agent.output!.blocked!.reason.includes('tokens'), 'blocked reason must reference tokens');

		service.dispose();
	});

	test('abortAgent cancels a running agent and fires completion with failed status', async () => {
		// Use a slow-resolving LLM stub so the agent stays in-flight when we abort.
		// We replace the stub's sendLLMMessage to never resolve, then abort immediately.
		const neverResolving = {
			sendLLMMessage(_params: any) {
				// Intentionally never calls onFinalMessage — simulates an in-progress request.
				return 'req-stuck';
			},
			abort(_id: string) { /* no-op */ },
		} as any;
		const tools = makeToolsStub({});
		const service = makeAgentService(neverResolving, tools.service);

		// Listen for completion BEFORE spawning to avoid a race.
		const completionPromise = Event.toPromise(service.onDidCompleteAgent);

		const agentId = await service.spawnAgent('m1', 't1', 'coder', 'long running task');

		// Abort immediately (the LLM call will never resolve on its own).
		await service.abortAgent(agentId);

		// onDidCompleteAgent must fire as a result of abort.
		const result = await completionPromise;

		assert.strictEqual(result.agentId, agentId);
		assert.strictEqual(result.status, 'failed', 'aborted agent fires failed completion event');

		const agent = service.getAgent(agentId)!;
		assert.strictEqual(agent.status, 'failed', 'aborted agent must have status "failed"');
		assert.ok(agent.output!.blocked, 'aborted agent must have a blocked reason');
		assert.ok(agent.output!.blocked!.reason.includes('aborted'), 'blocked reason must reference abort');

		service.dispose();
	});

	test('getAgentsForMission returns only agents belonging to the given missionId', async () => {
		const llm = makeLLMStub([
			'Summary: mission-A done.',
			'Summary: mission-B done.',
		]);
		const tools = makeToolsStub({});
		const service = makeAgentService(llm.service, tools.service);

		// Collect both completions before asserting.
		// Event.toPromise captures the first event; we collect both manually.
		const completed = new Set<string>();
		const allDone = new Promise<void>(resolve => {
			const disposable = service.onDidCompleteAgent(e => {
				completed.add(e.agentId);
				if (completed.size >= 2) {
					disposable.dispose();
					resolve();
				}
			});
		});

		const agentA = await service.spawnAgent('mission-A', 't1', 'coder', 'task for A');
		const agentB = await service.spawnAgent('mission-B', 't2', 'coder', 'task for B');

		await allDone;

		const forA = service.getAgentsForMission('mission-A');
		const forB = service.getAgentsForMission('mission-B');
		const forC = service.getAgentsForMission('mission-C');

		assert.strictEqual(forA.length, 1, 'mission-A should have exactly 1 agent');
		assert.strictEqual(forA[0].id, agentA, 'mission-A agent id must match spawned agent');
		assert.strictEqual(forB.length, 1, 'mission-B should have exactly 1 agent');
		assert.strictEqual(forB[0].id, agentB, 'mission-B agent id must match spawned agent');
		assert.strictEqual(forC.length, 0, 'unknown missionId must return empty array');

		service.dispose();
	});
});

// --- DEFAULT_AGENT_BUDGETS validation ----------------------------------------

suite('AgentLoopBudget — DEFAULT_AGENT_BUDGETS', () => {

	test('coder budget has maxTurns >= 10 (generous room for multi-step tasks)', () => {
		assert.ok(
			DEFAULT_AGENT_BUDGETS.coder.maxTurns >= 10,
			`coder.maxTurns should be >= 10, got ${DEFAULT_AGENT_BUDGETS.coder.maxTurns}`,
		);
	});

	test('coder budget has maxTokens > 0', () => {
		assert.ok(
			DEFAULT_AGENT_BUDGETS.coder.maxTokens > 0,
			`coder.maxTokens should be > 0, got ${DEFAULT_AGENT_BUDGETS.coder.maxTokens}`,
		);
	});

	test('planner budget has maxTurns > 0', () => {
		assert.ok(
			DEFAULT_AGENT_BUDGETS.planner.maxTurns > 0,
			`planner.maxTurns should be > 0, got ${DEFAULT_AGENT_BUDGETS.planner.maxTurns}`,
		);
	});

	test('all agent types have a defined budget entry', () => {
		const expectedTypes = ['planner', 'coder', 'tester', 'debugger', 'reviewer', 'docs', 'release', 'browser'];
		for (const type of expectedTypes) {
			const budget = DEFAULT_AGENT_BUDGETS[type as keyof typeof DEFAULT_AGENT_BUDGETS];
			assert.ok(budget, `missing budget entry for agent type "${type}"`);
			assert.ok(budget.maxTurns > 0, `${type}.maxTurns must be > 0`);
			assert.ok(budget.maxTokens > 0, `${type}.maxTokens must be > 0`);
			assert.ok(budget.deadlineMs > 0, `${type}.deadlineMs must be > 0`);
		}
	});

	test('write-heavy agents (coder, debugger, tester) get more turns than read-only agents', () => {
		const coderTurns = DEFAULT_AGENT_BUDGETS.coder.maxTurns;
		const plannerTurns = DEFAULT_AGENT_BUDGETS.planner.maxTurns;
		const reviewerTurns = DEFAULT_AGENT_BUDGETS.reviewer.maxTurns;
		assert.ok(
			coderTurns > plannerTurns,
			`coder (${coderTurns}) should have more turns than planner (${plannerTurns})`,
		);
		assert.ok(
			coderTurns > reviewerTurns,
			`coder (${coderTurns}) should have more turns than reviewer (${reviewerTurns})`,
		);
	});
});
