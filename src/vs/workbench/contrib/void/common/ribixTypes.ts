/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Memory entry types
export type MemoryEntryType =
	| 'codebase_file'        // file path + responsibility description
	| 'codebase_ownership'   // subsystem → owner mapping
	| 'codebase_pattern'     // naming/style/structure convention
	| 'mission_summary'      // (legacy) past mission outcome + result — superseded by the mission store
	| 'agent_run'            // a single agent run summary written by ribixAgentService
	| 'approval_decision'    // what the engineer approved/rejected
	| 'vocabulary_entry'     // internal name → resolved file paths

export type MemoryEntry = {
	id: string
	type: MemoryEntryType
	workspaceId: string       // git remote URL hash — scopes to repo
	content: string           // main knowledge content (text)
	metadata: Record<string, unknown>
	confidence: number        // 0–1, agents with high confidence entries are prioritized
	createdAt: number
	updatedAt: number
	source: 'agent' | 'engineer'  // engineer entries override agent entries
}

// Mission types
export type MissionState =
	| 'awaiting_outcome'
	| 'planning'
	| 'plan_ready'
	| 'executing'
	| 'reviewing'
	| 'complete'
	| 'aborted'
	| 'failed'

export type AgentType = 'planner' | 'coder' | 'tester' | 'debugger' | 'reviewer' | 'docs' | 'release' | 'onboarding-persona'

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'blocked' | 'complete' | 'failed'

export type RiskLevel = 'low' | 'medium' | 'high'

export type PlanTask = {
	id: string
	agentType: AgentType
	description: string
	dependsOn: string[]     // task IDs this task must wait for
	riskLevel: RiskLevel
	estimatedTokens: number
	notes: string           // planner's reasoning / warnings
	status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped'
}

/** Current persisted Mission schema version. Bump when the Mission shape changes. */
export const MISSION_SCHEMA_VERSION = 1

export type Mission = {
	schemaVersion: number     // persisted record version for migration (MISSION_SCHEMA_VERSION)
	id: string
	outcome: string           // raw engineer input
	state: MissionState
	tasks: PlanTask[]
	agentIds: string[]
	branchName: string        // git branch for this mission
	context?: MissionContext  // attached files/selections/notes — scopes the planner (G-CONTEXT)
	autoTriggered?: boolean   // true when created by the auto-on-change watcher
	createdAt: number
	completedAt: number | null
	result: {
		summary: string
		filesChanged: string[]
		testReport: string | null
		reviewerFindings: string[]
		commitSha: string | null
		prUrl: string | null
	} | null
}

/** Type guard used by the mission store to reject malformed / legacy-shaped records. */
export function isMission(value: unknown): value is Mission {
	if (typeof value !== 'object' || value === null) { return false }
	const v = value as Record<string, unknown>
	return typeof v.id === 'string'
		&& typeof v.state === 'string'
		&& Array.isArray(v.tasks)
}

/**
 * Structured output an agent produces, consumed by orchestration for inter-agent
 * handoff. Replaces the old "last activity-log detail string" handoff.
 */
export type AgentOutput = {
	summary: string                         // 1–3 sentence what-was-done
	filesChanged: string[]
	testReport: string | null               // tester/debugger fill this
	findings: AgentFinding[]                 // reviewer findings
	blocked: { reason: string } | null
	rawFinalMessage: string                  // model's last assistant turn, for debugging
}

/** Finding category used by reviewer and tester agents to classify issues. */
export type AgentFindingType =
	| 'data-loss-risk'
	| 'rate-limit-blind'
	| 'env-parity'
	| 'third-party-resilience'
	| 'legal-compliance'
	| 'copy-consistency'
	| 'observability-gap'
	| 'day-2-failure'
	| 'code-architecture'
	| 'onboarding-drop-off'

/** Human-readable description for each AgentFindingType category. */
export type DetectionCategory = Record<AgentFindingType, string>

export const DETECTION_CATEGORY_DESCRIPTIONS: DetectionCategory = {
	'data-loss-risk': 'Destructive actions without confirmation, silent mutation failures, or missing rollback on optimistic UI',
	'rate-limit-blind': 'No handling of 429 responses, missing quota proximity warnings, or ignored retry-after headers',
	'env-parity': 'OS-specific paths, missing .env.example entries, absent Node version constraints, or dev stubs leaking to production',
	'third-party-resilience': 'External service failures that are unhandled, missing timeout logic, or non-critical failures breaking core flows',
	'legal-compliance': 'Missing privacy or terms routes, cookie consent gaps, or unsubstantiated compliance claims in copy',
	'copy-consistency': 'Inconsistent terminology for the same concept, labels that contradict their action, or error messages in a different voice',
	'observability-gap': 'Empty catch blocks, swallowed errors without logging, missing request ID propagation, or console.log in production paths',
	'day-2-failure': 'Unbounded in-memory accumulators, event listener leaks, missing interval cleanup, unbounded DB queries, or log rotation gaps',
	'code-architecture': 'God files, circular imports, all-mock test suites, mixed error contracts within a module, or magic literals',
	'onboarding-drop-off': 'Flows that confuse non-technical users, missing next-step guidance, or unactionable error messages during setup',
}

export type AgentFinding = {
	severity: RiskLevel
	file: string
	line: number | null
	message: string
	findingType?: AgentFindingType
}

export type AgentInstance = {
	id: string
	type: AgentType
	missionId: string
	taskId: string
	status: AgentStatus
	currentAction: string
	activityLog: AgentActivityEntry[]
	filesRead: string[]
	filesWritten: string[]
	startedAt: number
	completedAt: number | null
	output: AgentOutput | null   // structured output populated by the agent loop on terminal status
}

export type AgentActivityEntry = {
	timestamp: number
	agentId: string
	action: string            // human-readable description
	detail: string | null     // optional additional detail
	tool: string | null       // tool name if this was a tool call
	filePath: string | null   // file affected if relevant
	/** Origin of this activity entry: 'ide' for locally-generated, 'cloud' for backend SSE */
	origin?: 'ide' | 'cloud'
}

export type MissionContext = {
	attachedFiles: string[]
	attachedSelections: { filePath: string; range: [number, number]; content: string }[]
	issueUrls: string[]
	notes: string
}