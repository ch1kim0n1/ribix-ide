/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Event } from '../../../../../base/common/event.js';
import { RibixAgentService } from '../../browser/ribixAgentService.js';

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
