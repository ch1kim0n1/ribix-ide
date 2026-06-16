/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// #39 — Per-mission API cost ceiling
//
// Wire-up notes:
//   1. Instantiate one CostTracker per mission execution inside RibixAgentService or
//      RibixOrchestrationService. Pass missionCeilingTokens from settings (default
//      DEFAULT_MISSION_CEILING_TOKENS). Store the tracker in executionStates or
//      orchestrationStates keyed by missionId.
//
//   2. In RibixAgentService.callLLM(), call costTracker.addTokens(estimateTokens(messages))
//      before the LLM call. After onFinalMessage resolves, call
//      costTracker.addTokens(estimateTokens([{role:'assistant', content: fullText}])).
//
//   3. At the top of the executeAgent() turn loop (or in runOneTool before callLLM),
//      guard:
//        if (costTracker.isOverCeiling()) {
//          throw new Error(MISSION_BUDGET_EXCEEDED_MESSAGE);
//        }
//      The thrown error propagates to markAgentFailed() and surfaces to the user.
//      A paused state would require explicit UI approval — implement that via
//      agentController.pause() + a UI prompt if desired.
//
//   4. Add missionCeilingTokens to the Ribix settings (voidSettingsTypes.ts / Settings.tsx)
//      so engineers can tune it per workspace.

/** Default token ceiling per mission (≈ $0.50 at typical rates for 100k tokens). */
export const DEFAULT_MISSION_CEILING_TOKENS = 100_000;

/**
 * Message shown to the user when the per-mission token budget is exhausted.
 * The agent loop should catch this message and surface it as an abort reason.
 */
export const MISSION_BUDGET_EXCEEDED_MESSAGE =
	'Mission paused: token budget reached. Approve to continue or reject to stop.';

/**
 * Tracks cumulative token usage for a single mission and enforces a configurable
 * ceiling. Agents cooperatively check isOverCeiling() before each LLM call.
 *
 * Token counts are estimated (chars / 4) via estimateTokens() from ribixAgentLoopTypes.ts
 * and do not represent exact billing units, but are accurate enough for budget
 * enforcement at the 100k-token granularity.
 */
export class CostTracker {
	private tokenCount = 0;
	private readonly ceiling: number;

	constructor(ceilingTokens: number = DEFAULT_MISSION_CEILING_TOKENS) {
		this.ceiling = ceilingTokens;
	}

	/**
	 * Records additional token usage. Call once before sending a request (input
	 * tokens) and once more after receiving the response (output tokens).
	 */
	addTokens(n: number): void {
		this.tokenCount += n;
	}

	/**
	 * Returns true when accumulated token usage has reached or exceeded the ceiling.
	 * Agents must check this before initiating any LLM call.
	 */
	isOverCeiling(): boolean {
		return this.tokenCount >= this.ceiling;
	}

	/** Human-readable usage summary for logging and UI display. */
	getSummary(): string {
		return `${this.tokenCount} / ${this.ceiling} tokens used`;
	}

	/** Current accumulated token count. */
	getTokenCount(): number {
		return this.tokenCount;
	}

	/** Configured ceiling. */
	getCeiling(): number {
		return this.ceiling;
	}

	/** Fraction of the budget consumed (0–1). Useful for progress indicators. */
	getFraction(): number {
		return this.ceiling > 0 ? Math.min(this.tokenCount / this.ceiling, 1) : 0;
	}
}
