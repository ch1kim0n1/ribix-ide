/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// #41 — Agent pause and resume controls
//
// Wire-up notes:
//   1. Import agentController (the module-level singleton) in ribixAgentService.ts.
//      In executeAgent()'s turn loop, add a cooperative pause check at the start of
//      each turn (before callLLM) and after each tool call:
//
//        for (let turn = 0; turn < budget.maxTurns; turn++) {
//          await agentController.checkPausePoint(agent.id);   // <-- add this
//          if (tokenSource.token.isCancellationRequested) { break; }
//          ...
//          for (const call of toolCalls) {
//            await agentController.checkPausePoint(agent.id); // <-- add this
//            const resultText = await this.runOneTool(agent, call);
//            ...
//          }
//        }
//
//   2. Register pause/resume VS Code commands in ribixFileActionContribution.ts or a
//      new ribixAgentControlActions.ts:
//
//        registerAction2(class extends Action2 {
//          constructor() { super({ id: 'ribix.pauseAgent', title: ..., f1: true }); }
//          async run(accessor, agentId: string) { agentController.pause(agentId); }
//        });
//
//   3. Expose pause/resume buttons in ribixAgentCard.tsx (React UI). The button
//      should call the command with the agent's ID. Show "Paused" status on the
//      agent card when agentController.isPaused(agentId) returns true.
//      TODO(#41-ui): add pause/resume button to ribixAgentCard.tsx — read isPaused
//      via a context key or by subscribing to onDidChangeAgents and polling
//      agentController.isPaused(agent.id).

/**
 * Cooperative pause/resume controller for individual agents.
 *
 * Agents periodically call checkPausePoint() at safe yield points in their
 * execution loop. The call blocks (polls every 500 ms) while the agent is paused
 * and returns immediately when the agent is resumed or not paused.
 *
 * This is a soft pause — it does not interrupt an in-flight LLM call or I/O
 * operation mid-stream. The agent completes its current atomic operation before
 * yielding. For a hard stop, use abortAgent() (CancellationToken / AbortController).
 */
export class AgentController {
	private readonly paused = new Map<string, boolean>(); // agentId → isPaused

	/**
	 * Pause the agent with the given ID. The agent will suspend at its next
	 * cooperative checkPausePoint() call.
	 */
	pause(agentId: string): void {
		this.paused.set(agentId, true);
	}

	/**
	 * Resume a previously paused agent. Any checkPausePoint() call that is
	 * currently sleeping will unblock within 500 ms.
	 */
	resume(agentId: string): void {
		this.paused.set(agentId, false);
	}

	/**
	 * Returns true when the agent is currently in a paused state.
	 * UI components can read this to decide which button (pause/resume) to show.
	 */
	isPaused(agentId: string): boolean {
		return this.paused.get(agentId) === true;
	}

	/**
	 * Cleans up tracking state for a completed or aborted agent.
	 * Call this in ribixAgentService.ts when an agent reaches a terminal state
	 * (complete / failed / aborted) to prevent memory growth.
	 */
	cleanup(agentId: string): void {
		this.paused.delete(agentId);
	}

	/**
	 * Cooperative pause check — agents call this at safe yield points in their loop.
	 * Blocks (polls) while the agent is paused; returns immediately otherwise.
	 *
	 * @param agentId  The agent whose pause state to check.
	 */
	async checkPausePoint(agentId: string): Promise<void> {
		while (this.paused.get(agentId) === true) {
			await new Promise<void>(r => setTimeout(r, 500));
		}
	}

	/**
	 * Returns the IDs of all currently paused agents. Useful for UI state and
	 * diagnostics.
	 */
	getPausedAgentIds(): string[] {
		const ids: string[] = [];
		for (const [id, paused] of this.paused) {
			if (paused) { ids.push(id); }
		}
		return ids;
	}
}

/**
 * Module-level singleton AgentController. Import this wherever pause/resume
 * operations need to be initiated (UI commands, keyboard shortcuts, tests).
 *
 * Using a singleton rather than DI keeps the pause-point call in the agent loop
 * zero-dependency and avoids circular service graphs. If the pattern grows, migrate
 * to a proper IAgentControllerService with DI.
 */
export const agentController = new AgentController();
