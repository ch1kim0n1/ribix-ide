/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// #42 — Mission time estimate before starting
//
// Wire-up notes:
//   1. Call estimateMissionDuration() in the mission creation flow after the user
//      submits the outcome and before they click "Start". Display the returned
//      estimate.label in the mission creation form.
//
//   2. In ribixCommandCenter.tsx (or the mission creation dialog), resolve
//      repoFileCount via IRibixSCMService.gitFileCount() (add that method if needed) or
//      approximate via the workspace directory listing. agentCount can be derived
//      from the PlanTask[] once the plan is ready, or estimated from the description
//      length before planning.
//
//      TODO(#42-ui): Display estimate.label in the mission creation UI, e.g.:
//        <span className="text-muted-foreground text-xs">
//          Estimated time: {estimate.label}
//        </span>
//      Place this beneath the outcome input field in ribixCommandCenter.tsx (or
//      wherever submitForPlanning() is called), before the "Start Mission" button.
//
//   3. Refresh the estimate reactively as the user types in the description (debounce
//      ~300 ms) so they see a live update without needing to submit first.

/** Parameters used to compute a time estimate for a mission. */
export interface MissionEstimateParams {
	/** Number of characters in the mission description (mission outcome text). */
	descriptionLength: number;
	/** Approximate number of files in the repository (from git ls-files or directory scan). */
	repoFileCount?: number;
	/** How many specialized agents are planned (derived from PlanTask[] or a pre-planning guess). */
	agentCount: number;
}

/** Time estimate produced for a mission before it starts. */
export interface MissionDurationEstimate {
	minMinutes: number;
	maxMinutes: number;
	/** Human-readable label for display, e.g. "8–20 minutes". */
	label: string;
}

/**
 * Estimates mission wall-clock duration using a simple additive heuristic.
 *
 * Heuristic formula:
 *   base            = 5 min
 *   + 2 min per 100 chars of description
 *   + 1 min per 1000 repo files
 *   + 3 min per planned agent
 *
 * The maximum is 1.5× the minimum (rounded up) to account for LLM latency
 * variability. Both bounds are clamped to a minimum of 1 minute.
 *
 * @example
 *   estimateMissionDuration({ descriptionLength: 200, repoFileCount: 3000, agentCount: 3 })
 *   // → { minMinutes: 18, maxMinutes: 27, label: "18–27 minutes" }
 */
export function estimateMissionDuration(params: MissionEstimateParams): MissionDurationEstimate {
	const { descriptionLength, repoFileCount = 0, agentCount } = params;

	const base = 5;
	const descriptionMinutes = Math.round((descriptionLength / 100) * 2);
	const filesMinutes = Math.round((repoFileCount / 1000) * 1);
	const agentMinutes = agentCount * 3;

	const minMinutes = Math.max(1, base + descriptionMinutes + filesMinutes + agentMinutes);
	const maxMinutes = Math.max(minMinutes + 1, Math.ceil(minMinutes * 1.5));

	return {
		minMinutes,
		maxMinutes,
		label: `${minMinutes}–${maxMinutes} minutes`,
	};
}

/**
 * Convenience helper: returns a rough estimate directly from a mission description
 * string and a default agent count (3), without needing repo file count.
 * Useful for live preview while the user is still typing the description.
 */
export function quickEstimateFromDescription(description: string): MissionDurationEstimate {
	return estimateMissionDuration({
		descriptionLength: description.length,
		repoFileCount: 0,
		agentCount: 3,
	});
}
