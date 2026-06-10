/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface PlanningPromptContext {
	memoryEntries: string[];
	directoryTree: string;
	fileOwnership: string;
	outcome: string;
	attachedContext: string;
}

export interface PlanningPromptParams {
	context: PlanningPromptContext;
}

/**
 * Generates the planning prompt for the LLM to create a task execution plan.
 */
export function generatePlanningPrompt(params: PlanningPromptParams): string {
	const { context } = params;

	return `You are an expert software architect and project planner. Your task is to break down a mission into a sequence of executable tasks that specialized AI agents can perform.

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

## Task Graph Rules

1. **Maximum Tasks**: Create at most 12 tasks. If the mission is complex, focus on the most critical path.

2. **First Task**: The first task MUST be a 'planner' task that analyzes the requirements and sets up the overall approach.

3. **Task Dependencies**:
   - All 'coder' tasks MUST depend on the initial 'planner' task.
   - 'tester' tasks MUST depend on the 'coder' tasks they are testing.
   - 'reviewer' tasks MUST depend on the tasks they are reviewing.
   - 'debugger' tasks can depend on 'tester' tasks that reported failures.
   - 'docs' tasks should depend on relevant 'coder' tasks.

4. **Agent Types**:
   - 'planner': Analyzes requirements, creates technical approach, identifies risks
   - 'coder': Writes/modifies code, implements features
   - 'tester': Writes and runs tests, validates functionality
   - 'debugger': Investigates and fixes bugs
   - 'reviewer': Reviews code changes, provides feedback
   - 'docs': Writes or updates documentation

5. **Risk Levels**:
   - 'low': Routine changes with minimal impact
   - 'medium': Moderate complexity or impact on multiple files
   - 'high': Complex changes, high risk of breaking existing functionality

6. **Token Estimates**: Provide realistic token estimates for each task (typical range: 1000-50000 tokens).

7. **Notes**: Include important warnings, assumptions, or reasoning for each task.

## Output Schema

You must respond with a JSON array of tasks in the following format:

\`\`\`json
{
  "tasks": [
    {
      "id": "task-1",
      "agentType": "planner",
      "description": "Brief but clear description of what this task does",
      "dependsOn": [],
      "riskLevel": "low",
      "estimatedTokens": 5000,
      "notes": "Important context or warnings for this task"
    },
    {
      "id": "task-2",
      "agentType": "coder",
      "description": "Implement the core feature",
      "dependsOn": ["task-1"],
      "riskLevel": "medium",
      "estimatedTokens": 15000,
      "notes": "Ensure backward compatibility"
    }
  ]
}
\`\`\`

## Important Notes

- If you cannot generate a valid plan (e.g., requirements are unclear, mission is impossible), respond with a refusal message starting with "REFUSAL:" followed by the reason.
- Ensure task IDs are unique and follow a simple pattern (e.g., "task-1", "task-2").
- The dependency graph must be acyclic (no circular dependencies).
- Prioritize tasks that unblock other tasks.
- Be concise but thorough in descriptions.

Generate the task plan now. Respond with ONLY the JSON object above, no additional text.`;
}