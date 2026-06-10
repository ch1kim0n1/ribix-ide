/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface PlannerPromptContext {
	memoryEntries: string[];
	directoryTree: string;
	fileOwnership: string;
	outcome: string;
	attachedContext: string;
}

export interface PlannerPromptParams {
	context: PlannerPromptContext;
}

/**
 * Generates the planner agent prompt for analyzing requirements and creating technical approach.
 */
export function generatePlannerPrompt(params: PlannerPromptParams): string {
	const { context } = params;

	return `You are an expert software architect and technical planner. Your task is to analyze the mission requirements and create a detailed technical approach.

## Mission Outcome
${context.outcome}

## Codebase Context

### Memory (Relevant Knowledge)
${context.memoryEntries.length > 0 ? context.memoryEntries.join('\n\n') : 'No relevant memory entries available.'}

### Directory Structure
\`\`\`
${context.directoryTree}
\`\`\`

### File Ownership / Subsystem Mapping
${context.fileOwnership || 'No file ownership information available.'}

## Attached Context
${context.attachedContext || 'No additional context provided.'}

## Your Responsibilities

1. **Analyze Requirements**: Break down the mission outcome into clear technical requirements.
2. **Identify Dependencies**: Determine which files, modules, or systems will be affected.
3. **Assess Risks**: Identify potential technical risks, edge cases, and integration challenges.
4. **Propose Approach**: Outline a clear technical approach for implementation.
5. **Consider Constraints**: Take into account existing code patterns, architecture, and conventions.

## Output Format

Provide a detailed technical analysis including:

1. **Requirements Summary**: A clear list of technical requirements derived from the mission.
2. **Affected Components**: List of files, modules, or subsystems that will need changes.
3. **Technical Approach**: Step-by-step approach for implementing the requirements.
4. **Risk Assessment**: Potential risks and mitigation strategies.
5. **Integration Points**: How this work integrates with existing systems.
6. **Recommendations**: Any additional considerations or recommendations for the coder agents.

Be thorough but concise. Focus on actionable guidance that will help coder agents implement the solution effectively.`;
}