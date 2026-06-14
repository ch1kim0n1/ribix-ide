/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AgentType } from './ribixTypes.js';

/**
 * A single turn in an agent's running conversation. The agent loop maintains an
 * ordered array of these and feeds them back to the model every turn so the model
 * can observe tool output (e.g. a test failure) and decide what to do next.
 *
 * Tool results are represented as their own role so the loop and tests can reason
 * about them explicitly; when sent to the LLM they are flattened into provider
 * messages (see RibixAgentService.callLLM).
 */
export type AgentTurnMessage =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string }
	| { role: 'tool'; toolName: string; content: string };

/**
 * Guardrails that terminate the loop cleanly so an agent can never hang.
 * - maxTurns:   hard cap on LLM round-trips.
 * - maxTokens:  approximate ceiling on accumulated message characters / 4.
 * - deadlineMs: wall-clock budget from loop start.
 */
export type AgentLoopBudget = {
	maxTurns: number;
	maxTokens: number;
	deadlineMs: number;
};

/** A single tool call parsed out of an assistant turn. */
export type ParsedToolCall = {
	tool: string;
	params: Record<string, string | undefined>;
};

/** Default per-agent-type budgets. Coder/debugger get the most room; read-only roles less. */
export const DEFAULT_AGENT_BUDGETS: Record<AgentType, AgentLoopBudget> = {
	planner: { maxTurns: 6, maxTokens: 80_000, deadlineMs: 3 * 60_000 },
	coder: { maxTurns: 12, maxTokens: 120_000, deadlineMs: 5 * 60_000 },
	tester: { maxTurns: 12, maxTokens: 120_000, deadlineMs: 5 * 60_000 },
	debugger: { maxTurns: 12, maxTokens: 120_000, deadlineMs: 5 * 60_000 },
	reviewer: { maxTurns: 6, maxTokens: 80_000, deadlineMs: 3 * 60_000 },
	docs: { maxTurns: 6, maxTokens: 80_000, deadlineMs: 3 * 60_000 },
	release: { maxTurns: 6, maxTokens: 80_000, deadlineMs: 3 * 60_000 },
	'onboarding-persona': { maxTurns: 10, maxTokens: 50_000, deadlineMs: 10 * 60 * 1000 },
};

/** Rough token estimate (chars / 4) used only for the soft maxTokens budget guard. */
export function estimateTokens(messages: AgentTurnMessage[]): number {
	let chars = 0;
	for (const m of messages) {
		chars += m.content.length;
	}
	return Math.ceil(chars / 4);
}
