# Ribix IDE — Engineering Plan

**Date:** 2026-06-09
**Version:** 1.0
**Status:** Draft — Phase 0 complete, Phase 1 complete, Phase 2 pending

**Base:** Void editor fork (Code-OSS 1.99.3) — `ribix-ide/`
**Goal:** Transform Void from AI-assisted code editor into agent-first software engineering OS.

---

## Codebase Audit Summary (Phase 0 findings)

### Existing Void services (all preserved)

| Service | File | Purpose |
|---|---|---|
| `chatThreadService` | `browser/chatThreadService.ts` | Thread/message state machine, tool call lifecycle |
| `editCodeService` | `browser/editCodeService.ts` | DiffZone, Fast/Slow Apply, file write orchestration |
| `toolsService` | `browser/toolsService.ts` | Built-in tool execution (read, write, terminal, search) |
| `voidSettingsService` | `common/voidSettingsService.ts` | Provider/model config, FeatureName routing |
| `sendLLMMessageService` | `common/sendLLMMessageService.ts` | LLM API routing (browser → electron-main channel) |
| `voidModelService` | `common/voidModelService.ts` | File read/write via URI, no load/save ceremony |
| `contextGatheringService` | `browser/contextGatheringService.ts` | Codebase context assembly for LLM prompts |
| `directoryStrService` | `common/directoryStrService.ts` | Directory tree strings for context |
| `mcpService` | `common/mcpService.ts` | MCP tool integration, server registry |
| `autocompleteService` | `browser/autocompleteService.ts` | Inline completions |
| `sidebarPane` | `browser/sidebarPane.ts` | Existing Void sidebar (Chat, Autocomplete settings) |
| `voidCommandBarService` | `browser/voidCommandBarService.ts` | Command bar widget |
| `voidSettingsPane` | `browser/voidSettingsPane.ts` | Settings UI pane |
| `voidSCMService` | `browser/voidSCMService.ts` | Source control integration |
| `voidOnboardingService` | `browser/voidOnboardingService.ts` | First-run onboarding flow |
| `convertToLLMMessageService` | `browser/convertToLLMMessageService.ts` | Chat message → LLM format |
| `aiRegexService` | `browser/aiRegexService.ts` | Regex pattern extraction from LLM output |
| `terminalToolService` | `browser/terminalToolService.ts` | Terminal command execution for agents |
| `fileService` | `browser/fileService.ts` | Void file utilities |
| `tooltipService` | `browser/tooltipService.ts` | Tooltip overlay |

### Existing Void types (extended, not replaced)

| File | Key types |
|---|---|
| `common/chatThreadServiceTypes.ts` | `ChatMessage`, `ToolMessage`, `CheckpointEntry`, `StagingSelectionItem` |
| `common/toolsServiceTypes.ts` | `ToolName`, `ToolCallParams`, `ToolResult`, `approvalTypeOfBuiltinToolName` |
| `common/editCodeServiceTypes.ts` | `VoidFileSnapshot`, `DiffZone`, `DiffArea` |
| `common/voidSettingsTypes.ts` | `FeatureName`, `ModelSelection`, `ProviderName`, `ChatMode` |
| `common/sendLLMMessageTypes.ts` | `RawToolCallObj`, `AnthropicReasoning`, `getErrorMessage` |
| `common/mcpServiceTypes.ts` | `RawMCPToolCall`, MCP server types |

### Key architectural patterns (follow in all new code)

- **Service registration:** `registerSingleton(IMyService, MyService, InstantiationType.Delayed)`
- **Service consumption:** inject via constructor `@IMyService private readonly myService: IMyService`
- **Browser ↔ main channel:** for Node.js operations, implement in `electron-main/`, expose via channel (see `sendLLMMessageChannel.ts` pattern)
- **React layer:** lives in `browser/react/`. Bundled separately via `node build.js`. Mount via `ReactDOM.createRoot`.
- **Event emission:** use `Emitter<T>` from `base/common/event.js` — same pattern as `chatThreadService`'s `onDidChangeCurrentThread`
- **Storage:** use `IStorageService` with `StorageScope.WORKSPACE` (per-repo) or `StorageScope.PROFILE` (global)

### Gaps identified (all addressed in phases below)

- No mission/outcome abstraction — only single-turn chat threads exist
- No multi-agent coordination — single LLM call per user message
- No persistent memory beyond thread storage — `THREAD_STORAGE_KEY` in IStorageService only
- No agent type system — agents are undifferentiated
- No file lock mechanism — concurrent agent writes would collide
- No checkpoint grouping at mission scope — `CheckpointEntry` exists per edit, not per mission
- No Ribix backend API client — no org connection, no OAuth
- No Command Center panel — primary UX is the existing Void sidebar chat
- No plan/task graph system — no decomposition of outcomes

---

## New File Structure (target — all under `src/vs/workbench/contrib/void/`)

```
browser/
  ribixAgentService.ts              # Agent instance management
  ribixOrchestrationService.ts      # Multi-agent task coordination
  ribixPlanningService.ts           # Outcome → task graph (LLM call)
  ribixMissionService.ts            # Mission lifecycle state machine
  ribixCheckpointService.ts         # Mission-scoped rollback groups
  ribixAuthService.ts               # OAuth flow (browser side)
  ribixCommandCenterPane.ts         # Command Center panel registration + mount
  ribixDiffAnnotationWidget.ts      # Per-block agent annotation in editor

  react/
    ribixCommandCenter.tsx          # Root Command Center React component
    ribixMissionsPanel.tsx          # Missions tab
    ribixAgentsPanel.tsx            # Agents tab
    ribixMemoryPanel.tsx            # Memory tab
    ribixAgentActivityFeed.tsx      # Live event stream component
    ribixPlanReviewDialog.tsx       # Plan approval dialog
    ribixMissionCard.tsx            # Mission card component
    ribixAgentCard.tsx              # Agent status card
    ribixTaskTree.tsx               # Plan task tree with approve/modify controls
    ribixDiffSummary.tsx            # Post-mission diff summary

common/
  ribixMemoryService.ts             # Persistent codebase/org memory
  ribixTaskQueueService.ts          # Async job queue
  ribixFileLockService.ts           # File lock registry (agent concurrency)
  ribixApiClient.ts                 # Ribix backend HTTP client
  ribixTypes.ts                     # All new shared types

electron-main/
  ribixAuthChannel.ts               # OAuth token exchange (needs Node.js)
  ribixMemoryChannel.ts             # SQLite memory persistence (needs Node.js)
```

---

## Phase 0 — Audit & Preparation

**Goal:** Complete understanding of base codebase. Zero code changes.

### Action items

- [ ] Read `browser/chatThreadService.ts` — document state machine, tool call lifecycle, `onDidChangeCurrentThread` emitter
- [ ] Read `browser/editCodeService.ts` — document DiffZone lifecycle, Fast/Slow Apply, `voidFileSnapshot` creation
- [ ] Read `browser/toolsService.ts` — document all built-in tool names, approval type mapping, tool execution flow
- [ ] Read `common/voidSettingsService.ts` — document `ChatMode` union, `ModelSelection` type, `FeatureName` enum
- [ ] Read `common/sendLLMMessageService.ts` — document browser→main channel, streaming callback, tool call handling
- [ ] Read `common/voidModelService.ts` — document URI-based write pattern, no load/save ceremony
- [ ] Read `common/chatThreadServiceTypes.ts` — document all type variants, `CheckpointEntry` structure
- [ ] Read `common/toolsServiceTypes.ts` — document `ToolName`, approval type system
- [ ] Read `browser/sidebarPane.ts` — document panel registration, React mount point
- [ ] Read `browser/voidSettingsPane.ts` — document settings pane structure for extension
- [ ] Read `browser/voidOnboardingService.ts` — document onboarding flow for replacement
- [ ] Read `browser/void.contribution.ts` — document all service registrations and contribution points
- [ ] Read `electron-main/sendLLMMessageChannel.ts` — document browser↔main channel pattern
- [ ] Read `electron-main/mcpChannel.ts` — document second example of browser↔main channel
- [ ] Document: which services are `common/` (both browser+main) vs `browser/` (browser-only) vs `electron-main/` only
- [ ] Document: how React components are mounted (sidebarPane.ts pattern) — to replicate for Command Center
- [ ] Document: `IStorageService` usage pattern from `chatThreadService.ts` — to replicate for memory
- [ ] Read `product.json` — document all branding strings to replace
- [ ] Create `absolute-docs/FileIndex.md` — one-line description per source file for team onboarding
- [ ] Run build: `npm run buildreact` — confirm React layer builds cleanly
- [ ] Confirm TypeScript strict mode in `tsconfig.json`

### Acceptance criteria

- All audit notes captured in `absolute-docs/FileIndex.md`
- Build (`npm run buildreact`) exits 0
- No code changes committed in Phase 0

---

## Phase 1 — Identity & Branding

**Goal:** Rename product from Void to Ribix IDE. Apply Ribix design tokens. No functional changes.

### Action items

**product.json**
- [ ] `nameShort`: "Void" → "Ribix IDE"
- [ ] `nameLong`: "Void Editor" → "Ribix IDE"
- [ ] `applicationName`: "void" → "ribix-ide"
- [ ] `dataFolderName`: ".void" → ".ribix-ide"
- [ ] `win32MutexName`: "void" → "ribix-ide"
- [ ] `darwinBundleIdentifier`: update to `dev.ribix.ide`
- [ ] `urlProtocol`: "void" → "ribix-ide"
- [ ] Update all URL references (home, docs, bug report) to `ribix.dev` domain
- [ ] Update `extensionAllowedProposedApi` and related if needed

**package.json**
- [ ] `name`: "code-oss-dev" → "ribix-ide"
- [ ] `description`: update to Ribix IDE description
- [ ] `homepage`, `repository`, `bugs`: update to ribix-ide repo URLs

**Design tokens — CSS variables**
- [ ] Locate VS Code theme override files (search for `--vscode-button-background` overrides in Void)
- [ ] Add Ribix token overrides:
  - `--ribix-bg-primary: #01311F`
  - `--ribix-gold: #C6AA58`
  - `--ribix-gold-dark: #A8893A`
  - `--ribix-text-primary: #F5F0E8`
  - `--ribix-text-secondary: #8A9E8A`
  - `--ribix-success: #2D7A4F`
  - `--ribix-warning: #D4820A`
  - `--ribix-error: #C23B22`
  - `--ribix-border: #1E4A32`
- [ ] Apply `--ribix-bg-primary` to Activity Bar background
- [ ] Apply `--ribix-gold` to Activity Bar active item indicator

**Icons**
- [ ] Replace Void icons in `void_icons/` with Ribix branding (logo, activity bar icon)
- [ ] Update `resources/` app icons (macOS .icns, Windows .ico, Linux .png)

**Onboarding**
- [ ] Update `voidOnboardingService.ts` — replace all "Void" string literals with "Ribix IDE"
- [ ] Update welcome screen copy to reflect agent-first product identity

**String sweep**
- [ ] `grep -r "Void" src/vs/workbench/contrib/void/ --include="*.ts" --include="*.tsx"` — update user-facing strings (not class names / service IDs)
- [ ] `grep -r "Glass Devtools" src/vs/workbench/contrib/void/` — replace copyright headers with Ribix Inc.

### Acceptance criteria

- Application title bar shows "Ribix IDE"
- Activity bar background: `#01311F`
- Welcome/onboarding copy references "Ribix IDE"
- No user-visible "Void" strings in UI
- Build exits 0

---

## Phase 2 — Persistent Memory Infrastructure

**Goal:** Implement `ribixMemoryService` — the foundation for all agent knowledge accumulation.

### New files

- `common/ribixTypes.ts` — all new shared types (start here)
- `common/ribixMemoryService.ts` — memory service interface + browser implementation
- `electron-main/ribixMemoryChannel.ts` — SQLite persistence channel

### Type definitions (ribixTypes.ts)

```typescript
// Memory entry types
export type MemoryEntryType =
  | 'codebase_file'        // file path + responsibility description
  | 'codebase_ownership'   // subsystem → owner mapping
  | 'codebase_pattern'     // naming/style/structure convention
  | 'mission_summary'      // past mission outcome + result
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

export type AgentType = 'planner' | 'coder' | 'tester' | 'debugger' | 'reviewer' | 'docs' | 'release'

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

export type Mission = {
  id: string
  outcome: string           // raw engineer input
  state: MissionState
  tasks: PlanTask[]
  agentIds: string[]
  branchName: string        // git branch for this mission
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
}

export type AgentActivityEntry = {
  timestamp: number
  agentId: string
  action: string            // human-readable description
  detail: string | null     // optional additional detail
  tool: string | null       // tool name if this was a tool call
  filePath: string | null   // file affected if relevant
}
```

### ribixMemoryService interface

```typescript
export interface IRibixMemoryService {
  // Read
  getEntries(type: MemoryEntryType, workspaceId: string): Promise<MemoryEntry[]>
  searchEntries(query: string, workspaceId: string): Promise<MemoryEntry[]>

  // Write
  writeEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>
  updateEntry(id: string, updates: Partial<Pick<MemoryEntry, 'content' | 'metadata' | 'confidence'>>): Promise<void>
  deleteEntry(id: string): Promise<void>

  // Workspace scoping
  getWorkspaceId(): Promise<string>   // derived from git remote URL

  // Events
  onDidChangeEntries: Event<void>
}
```

### Implementation notes

- **Storage backend:** Use `IStorageService` (StorageScope.WORKSPACE) for small entries. For large memory stores (1000+ entries), serialize to a file in `globalStorageUri/ribix-memory.json`.
- **Search:** Implement simple substring + keyword matching first. Semantic search (embeddings) is a future phase — design the interface to support it without requiring it.
- **Workspace ID:** derive from `voidSCMService` git remote URL, SHA-256 hashed. Falls back to workspace folder URI hash if no git remote.
- **Engineer override priority:** entries with `source: 'engineer'` always rank above `source: 'agent'` entries with same type + content scope.

### Action items

- [ ] Define all types in `common/ribixTypes.ts`
- [ ] Define `IRibixMemoryService` interface in `common/ribixMemoryService.ts`
- [ ] Implement `RibixMemoryService` — IStorageService-backed, StorageScope.WORKSPACE
- [ ] Register `IRibixMemoryService` as singleton in `browser/void.contribution.ts`
- [ ] Implement `getWorkspaceId()` — use `IWorkspaceContextService` + git remote from `voidSCMService`
- [ ] Implement `searchEntries()` — simple substring match first
- [ ] Write unit tests: write/read round-trip, search, delete, workspace scoping
- [ ] Wire `onDidChangeEntries` emitter

### Acceptance criteria

- Write + read round-trip test passes
- Entries survive session restart (IStorageService persistence confirmed)
- `getWorkspaceId()` returns consistent ID across restarts for same repo
- No build errors

---

## Phase 3 — Task Queue & File Lock Infrastructure

**Goal:** Async task execution foundation. File locking to prevent concurrent agent write collisions.

### New files

- `common/ribixTaskQueueService.ts`
- `common/ribixFileLockService.ts`

### ribixTaskQueueService

Manages a priority queue of async tasks. Each task has a cancellation token.

```typescript
export interface IRibixTaskQueueService {
  enqueue<T>(fn: (token: CancellationToken) => Promise<T>, priority?: number): Promise<T>
  cancelAll(): void
  onDidChangeQueue: Event<void>
  readonly pendingCount: number
  readonly runningCount: number
}
```

- Max concurrent: configurable (default 4 — one per agent type)
- Priority: higher number runs first (planner=10, coder=5, tester=5, reviewer=3, docs=2, release=1)
- Uses `CancellationToken` from `base/common/cancellation.js` (already in codebase)

### ribixFileLockService

Prevents two agents from writing the same file simultaneously.

```typescript
export interface IRibixFileLockService {
  acquire(filePath: string, agentId: string): Promise<() => void>  // returns release fn
  isLocked(filePath: string): boolean
  getLockHolder(filePath: string): string | null   // agentId
  onDidChangeLocks: Event<void>
}
```

- Lock acquisition is async — queues if file is locked by another agent
- Lock timeout: 30 seconds (releases automatically on hang)
- Lock release: called by agent on completion or error

### Action items

- [ ] Define and implement `IRibixTaskQueueService`
- [ ] Register as singleton
- [ ] Define and implement `IRibixFileLockService`
- [ ] Register as singleton
- [ ] Write tests: queue ordering, cancellation, lock acquire/release, lock timeout

### Acceptance criteria

- Two concurrent `acquire()` calls on same path: second waits, first completes, second proceeds
- Task queue respects priority ordering
- Cancelled tasks do not execute

---

## Phase 4 — Mission Service & State Machine

**Goal:** Mission lifecycle management — the top-level abstraction for all agent work.

### New file: `browser/ribixMissionService.ts`

State machine:

```
AWAITING_OUTCOME → PLANNING → PLAN_READY → EXECUTING → REVIEWING → COMPLETE
                                                      ↘ ABORTED
                                                      ↘ FAILED
```

```typescript
export interface IRibixMissionService {
  // Create
  createMission(outcome: string, context: MissionContext): Promise<Mission>

  // Read
  getMission(id: string): Mission | null
  getAllMissions(): Mission[]
  getActiveMissions(): Mission[]

  // Transitions
  submitForPlanning(id: string): Promise<void>
  approvePlan(id: string, modifiedTasks?: PlanTask[]): Promise<void>
  abortMission(id: string): Promise<void>
  completeMission(id: string, result: Mission['result']): Promise<void>

  // Persistence
  onDidChangeMissions: Event<void>
}

export type MissionContext = {
  attachedFiles: string[]
  attachedSelections: { filePath: string; range: [number, number]; content: string }[]
  issueUrls: string[]
  notes: string
}
```

- Missions persisted in `ribixMemoryService` with type `mission_summary`
- Max concurrent missions: 3 (configurable)
- Each mission gets a git branch: `ribix/mission-{id-prefix}` (via `voidSCMService`)

### Action items

- [ ] Define `IRibixMissionService` interface
- [ ] Implement state machine — each transition validates current state before proceeding
- [ ] Integrate with `ribixMemoryService` for persistence
- [ ] Integrate with `voidSCMService` for branch creation on `approvePlan`
- [ ] Emit `onDidChangeMissions` on every state change
- [ ] Write unit tests: state transitions, persistence, branch naming

### Acceptance criteria

- Mission created → persists across session restart
- Invalid state transitions throw (e.g., `approvePlan` on COMPLETE mission)
- `getAllMissions()` returns missions sorted by `createdAt` descending

---

## Phase 5 — Planning Service

**Goal:** Outcome → task graph via LLM. The Planner agent implementation.

### New file: `browser/ribixPlanningService.ts`

```typescript
export interface IRibixPlanningService {
  plan(missionId: string, outcome: string, context: MissionContext): Promise<PlanTask[]>
  onDidProducePlan: Event<{ missionId: string; tasks: PlanTask[] }>
}
```

### Planning prompt structure

The planning LLM call is sent via `sendLLMMessageService`. The prompt includes:

1. **System:** Planner agent role definition — "You decompose software engineering outcomes into a task graph. You return structured JSON only."
2. **Codebase context:** Top 20 most-relevant memory entries (from `ribixMemoryService`) + directory tree (from `directoryStrService`) + file ownership summary
3. **Outcome:** The engineer's outcome text
4. **Attached context:** File contents + selections + issue text
5. **Output schema:** JSON matching `PlanTask[]` type

### Task graph rules (enforced by planning prompt)

- Maximum 12 tasks per mission
- First task always type: `planner` — "Analyze scope and read key files"
- Planner task has no dependsOn (always runs first)
- Coder tasks depend on the planner task minimum
- Tester tasks depend on all coder tasks they test
- Reviewer task depends on all coder + tester tasks
- Docs task depends on the reviewer task
- Release task is never included automatically — only added if engineer requests

### Action items

- [ ] Define prompt template in `common/prompt/ribixPlanningPrompt.ts`
- [ ] Implement `IRibixPlanningService` — sends LLM call via `sendLLMMessageService`
- [ ] Parse LLM response into `PlanTask[]` — validate schema
- [ ] Handle LLM refusal / malformed output — return a minimal safe default plan
- [ ] Wire `onDidProducePlan` emitter
- [ ] Write unit tests: prompt construction, response parsing, schema validation

### Acceptance criteria

- Valid outcome → returns `PlanTask[]` with correct dependency structure
- Malformed LLM response → graceful fallback, not a crash
- Planning call completes in under 30 seconds for typical outcomes

---

## Phase 6 — Agent Service & Orchestration

**Goal:** Spawn, track, and coordinate typed agent instances. The execution engine.

### New files

- `browser/ribixAgentService.ts` — agent instance management
- `browser/ribixOrchestrationService.ts` — multi-agent coordination

### ribixAgentService

```typescript
export interface IRibixAgentService {
  spawnAgent(type: AgentType, missionId: string, taskId: string): Promise<AgentInstance>
  getAgent(id: string): AgentInstance | null
  getAgentsForMission(missionId: string): AgentInstance[]
  getAllActiveAgents(): AgentInstance[]
  abortAgent(id: string): Promise<void>
  onDidChangeAgents: Event<void>
}
```

Each agent is a long-running async loop:

```
1. Read task description from mission
2. Read relevant memory entries
3. Acquire file locks for planned writes
4. Execute: LLM call → tool calls → file writes (via voidModelService + editCodeService)
5. Write activity log entries to AgentInstance
6. Write memory entries (decisions, findings) to ribixMemoryService
7. Release file locks
8. Report completion or failure to ribixOrchestrationService
```

Agent executes tool calls using the **existing `toolsService`** — no new tool execution layer needed. The agent loop uses `sendLLMMessageService` for LLM calls.

Each agent type has a **system prompt** defined in `common/prompt/`:

| Agent type | System prompt file |
|---|---|
| planner | `ribixPlannerPrompt.ts` |
| coder | `ribixCoderPrompt.ts` |
| tester | `ribixTesterPrompt.ts` |
| debugger | `ribixDebuggerPrompt.ts` |
| reviewer | `ribixReviewerPrompt.ts` |
| docs | `ribixDocsPrompt.ts` |
| release | `ribixReleasePrompt.ts` |

### ribixOrchestrationService

Coordinates task execution across multiple agents:

```typescript
export interface IRibixOrchestrationService {
  executeMission(missionId: string): Promise<void>
  pauseMission(missionId: string): Promise<void>
  resumeMission(missionId: string): Promise<void>
  onDidChangeMissionProgress: Event<{ missionId: string }>
}
```

Orchestration algorithm:

```
1. Get all tasks for mission (from ribixMissionService)
2. Topological sort by dependsOn graph
3. For each ready task (dependencies complete): spawn agent via ribixAgentService + ribixTaskQueueService
4. Monitor agent completion events
5. When task completes: mark in mission, find newly-unblocked tasks, spawn their agents
6. When all tasks complete: transition mission to REVIEWING
7. On any agent failure: pause mission, surface error to engineer
```

### Action items

- [ ] Define system prompt templates for all 7 agent types
- [ ] Implement `IRibixAgentService` — agent spawn, tracking, abort
- [ ] Implement agent execution loop — LLM call → tool calls → memory writes
- [ ] Wire agent to `toolsService` for tool execution
- [ ] Wire agent to `ribixFileLockService` for write locking
- [ ] Wire agent to `ribixCheckpointService` (Phase 7) for pre-write checkpoints
- [ ] Implement `IRibixOrchestrationService` — topological execution
- [ ] Write unit tests: agent lifecycle, dependency resolution, failure handling

### Acceptance criteria

- Two agents writing different files: both succeed concurrently
- Two agents writing same file: second waits for first lock release
- Failed agent: mission pauses, engineer is notified
- All tasks in a 3-task chain complete in correct dependency order

---

## Phase 7 — Checkpoint Service (Mission-Scoped Rollback)

**Goal:** Extend Void's existing checkpoint system to support mission-scoped rollback.

### New file: `browser/ribixCheckpointService.ts`

Void already has `CheckpointEntry` in `chatThreadServiceTypes.ts` and file snapshot support in
`editCodeServiceTypes.ts`. This phase wraps that with mission-scoped grouping.

```typescript
export interface IRibixCheckpointService {
  // Called by agent before every file write
  checkpoint(missionId: string, agentId: string, filePath: string): Promise<string>  // returns checkpoint ID

  // Called by engineer from UI
  rollbackFile(checkpointId: string, filePath: string): Promise<void>
  rollbackAgent(agentId: string): Promise<void>        // undo all writes by this agent
  rollbackMission(missionId: string): Promise<void>    // restore all files to pre-mission state

  getCheckpoints(missionId: string): MissionCheckpoint[]
}

export type MissionCheckpoint = {
  id: string
  missionId: string
  agentId: string
  filePath: string
  snapshot: VoidFileSnapshot   // from editCodeServiceTypes.ts
  timestamp: number
}
```

### Action items

- [ ] Define `IRibixCheckpointService`
- [ ] Implement using `VoidFileSnapshot` (reuse existing Void snapshot structure)
- [ ] Integrate: agents call `checkpoint()` before every `voidModelService` write
- [ ] Implement `rollbackMission` — restores all snapshotted files in reverse order
- [ ] Write unit tests: checkpoint → write → rollback restores original content

### Acceptance criteria

- Write file → checkpoint → rollback → file matches original
- `rollbackMission` restores N files modified by M agents, all correct

---

## Phase 8 — Command Center Panel (Primary UX)

**Goal:** Build the Ribix Command Center — the new primary UI panel. The code editor is demoted to secondary.

### New files

- `browser/ribixCommandCenterPane.ts` — panel registration and React mount (follow `sidebarPane.ts` pattern)
- `browser/react/ribixCommandCenter.tsx` — root component
- `browser/react/ribixMissionsPanel.tsx` — Missions tab
- `browser/react/ribixAgentsPanel.tsx` — Agents tab
- `browser/react/ribixMemoryPanel.tsx` — Memory tab
- `browser/react/ribixMissionCard.tsx`
- `browser/react/ribixAgentCard.tsx`
- `browser/react/ribixTaskTree.tsx`
- `browser/react/ribixAgentActivityFeed.tsx`
- `browser/react/ribixPlanReviewDialog.tsx`
- `browser/react/ribixDiffSummary.tsx`

### Panel registration (`ribixCommandCenterPane.ts`)

Follow `sidebarPane.ts` exactly:
- Register a new view container in the Activity Bar with Ribix icon
- Register the Command Center view inside it
- Mount the React root component into the webview

### Command Center tabs

**Missions tab** (`ribixMissionsPanel.tsx`)
- Outcome input box at top (large, gold border, placeholder: "Describe what you want to achieve...")
- "Plan This" button (Ribix gold `#C6AA58`, dark bg `#01311F`)
- Mission list below — each mission as a `ribixMissionCard`
- Mission card: title (outcome truncated to 80 chars), status badge (color-coded), agent count, duration
- Click → expand to full mission detail: outcome, task tree, activity feed, diff summary, test report

**Agents tab** (`ribixAgentsPanel.tsx`)
- Grid of `ribixAgentCard` components
- Each card: agent type icon, name, status, current action, files touched count
- Status color coding: idle=grey, executing=gold, blocked=red, complete=green

**Memory tab** (`ribixMemoryPanel.tsx`)
- Segmented control: Codebase | Patterns | History | Vocabulary
- Each section: searchable list of memory entries
- Each entry: type badge, content preview, confidence bar, source badge (agent/engineer)
- Edit / Delete actions per entry
- "Add note" — engineer can write a new memory entry directly

### Layout defaults

- Command Center panel: 380px wide in sidebar (same as current Void sidebar)
- On first launch: Command Center panel is focused (not the file explorer)
- Editor area: unchanged — engineers open files normally when they want to inspect

### Outcome submission flow

```
Engineer types outcome → clicks "Plan This"
  → ribixMissionService.createMission()
  → ribixMissionService.submitForPlanning()
  → ribixPlanningService.plan() (async)
  → onDidProducePlan fires
  → Mission state: PLAN_READY
  → ribixPlanReviewDialog renders in-panel
  → Engineer reviews task tree, approves or modifies
  → ribixMissionService.approvePlan()
  → ribixOrchestrationService.executeMission()
  → Real-time updates via onDidChangeAgents and onDidChangeMissions emitters
```

### Action items

- [ ] Create `ribixCommandCenterPane.ts` — follow `sidebarPane.ts` pattern exactly
- [ ] Register panel in `void.contribution.ts`
- [ ] Build React component tree (all 10+ component files)
- [ ] Wire all components to service layer via React context or direct service injection
- [ ] Style all components with Ribix design tokens (CSS variables defined in Phase 1)
- [ ] Implement outcome input → plan review → approve flow end to end
- [ ] Implement real-time agent activity feed (subscribe to `onDidChangeAgents` emitter)
- [ ] Implement mission card expand/collapse
- [ ] Implement task tree with approve/remove/add controls in `ribixPlanReviewDialog`
- [ ] Run `npm run buildreact` — confirm React bundle includes new components

### Acceptance criteria

- Command Center panel opens on first launch
- Outcome input → plan review dialog renders with task tree
- Approve plan → mission transitions to EXECUTING
- Agent activity feed updates in real time during execution
- All components use Ribix design tokens (no hardcoded colors)

---

## Phase 9 — Editor Integration (Diff Annotation)

**Goal:** Surface agent changes and annotations directly in the code editor.

### New file: `browser/ribixDiffAnnotationWidget.ts`

Extends Void's existing DiffZone system to add:
- Per-block agent attribution: "Written by Coder-1 — [View reasoning]"
- Per-block approve/reject controls (same as Void's existing apply approval, but mission-scoped)
- Inline agent annotations (decision notes, warnings, questions)

### Integration with editCodeService

The existing `editCodeService` already handles DiffZone rendering. This phase adds:
1. A decoration type for "agent-written" blocks (subtle Ribix gold left border)
2. A code lens above each agent-written block showing: agent name, timestamp, "[View reasoning]" link
3. The "[View reasoning]" link opens a webview panel with the agent's full activity log for that edit
4. A "Reject this block" action per code lens (triggers `ribixCheckpointService.rollbackFile()`)

### Action items

- [ ] Create `ribixDiffAnnotationWidget.ts` — register decoration types and code lens provider
- [ ] Wire to `ribixAgentService` — subscribe to file writes, annotate affected ranges
- [ ] Implement "[View reasoning]" panel — renders `AgentActivityEntry[]` for the write operation
- [ ] Implement "Reject this block" — calls `ribixCheckpointService.rollbackFile()` for the range
- [ ] Test: agent writes file → code lens appears above changed block

### Acceptance criteria

- Agent writes a file → code lens visible above changed lines within 2 seconds
- "[View reasoning]" opens panel with agent's decision log
- "Reject" rolls back the specific file to pre-agent state

---

## Phase 10 — Ribix Backend Connection

**Goal:** Connect to Ribix API for org memory sync, OAuth, and PR creation.

### New files

- `common/ribixApiClient.ts` — HTTP client (same pattern as `ribix-vs-extension/src/core/apiClient.ts`)
- `browser/ribixAuthService.ts` — OAuth flow (same pattern as `ribix-vs-extension/src/vscode/oauthSessionManager.ts`)
- `electron-main/ribixAuthChannel.ts` — PKCE token exchange (needs Node.js)

### ribixApiClient

Mirror the pattern from `ribix-vs-extension/src/core/apiClient.ts`:
- Native `fetch`, POST/GET helpers
- `RibixApiError(status, code, message)` error class
- `buildHeaders()` injects `Authorization: Bearer <token>` + request ID
- Methods: `syncMemory`, `createPR`, `getOrgMemory`, `getMissions`

### ribixAuthService

Mirror the pattern from `ribix-vs-extension/src/vscode/oauthSessionManager.ts`:
- PKCE OAuth flow
- Session stored in a suitable secure store (IndexedDB encrypted, or via electron-main channel to OS keychain if available)
- `onDidChangeSession` event — services subscribe to auth state changes

### Org memory sync

When authenticated:
1. On workspace open: pull org memory entries from Ribix API → merge into `ribixMemoryService` (server entries with lower confidence than engineer entries)
2. On mission complete: push new memory entries to org memory
3. Conflict resolution: engineer entries always win; newer agent entries win over older agent entries

### Action items

- [ ] Implement `IRibixApiClient` + `RibixApiClient` in `common/ribixApiClient.ts`
- [ ] Implement `IRibixAuthService` + OAuth flow in `browser/ribixAuthService.ts`
- [ ] Add "Ribix: Sign In" / "Sign Out" commands (register in `void.contribution.ts`)
- [ ] Wire auth to `ribixApiClient` — all API calls check auth before firing
- [ ] Implement memory sync: pull on open, push on mission complete
- [ ] Add auth status to Command Center Settings tab
- [ ] Write unit tests: auth state transitions, API client error handling

### Acceptance criteria

- "Ribix: Sign In" opens browser OAuth, completes login, updates auth status in Command Center
- Authenticated session persists across IDE restart
- Org memory pulls on workspace open (visible in Memory tab)

---

## Phase 11 — PR Creation & Release Integration

**Goal:** Release agent and PR creation workflow integrated with Ribix backend.

### Release Agent

The Release agent (defined in Phase 6) executes only when engineer explicitly triggers "Prepare Release" from the Command Center Missions tab.

Release agent tasks:
1. Analyze mission diff to determine semver bump (patch/minor/major)
2. Draft changelog entry from mission history + agent notes
3. Bump version in `package.json` (or equivalent)
4. Create git tag
5. Call `ribixApiClient.createPR()` with full context

PR payload (same structure as ribix-vs-extension PR creation):
- Branch: `ribix/mission-{id}`
- Title: derived from mission outcome (first 70 chars)
- Body: mission summary, task list, test report, agent notes
- Labels: `ribix-agent`

### Action items

- [ ] Implement Release agent system prompt (`common/prompt/ribixReleasePrompt.ts`)
- [ ] Wire Release agent to `voidSCMService` for branch + tag operations
- [ ] Wire Release agent to `ribixApiClient.createPR()`
- [ ] Add "Prepare Release" button to Mission detail view (only shown when mission in COMPLETE state)
- [ ] Show PR URL in Mission card after creation

### Acceptance criteria

- Complete mission → "Prepare Release" button appears
- Trigger → Release agent runs → PR created → URL shown in mission card

---

## Phase 12 — Quick Edit Mode (Preserve Void UX)

**Goal:** Ensure all existing Void features (autocomplete, Cmd+K, chat) remain intact and well-labeled.

### Changes

- Rename "Chat" in existing sidebar to "Quick Edit"
- Add a header note: "For full missions, use the Ribix Command Center (left panel)"
- Label autocomplete settings section: "Quick Edit — Inline Completions"
- Preserve all existing `chatThreadService`, `editCodeService`, `autocompleteService` behavior unchanged
- No feature removals — all Void capabilities remain available

### Action items

- [ ] Update string literals in `sidebarPane.ts` and related React components: "Chat" → "Quick Edit"
- [ ] Update `voidSettingsPane.ts` section labels
- [ ] Confirm Cmd+K still works after all new service registrations
- [ ] Confirm autocomplete still functions on all configured providers

### Acceptance criteria

- Existing Void "apply" flow works end-to-end
- Autocomplete fires on configured providers
- Cmd+K rewrite works on a selected range

---

## Phase 13 — Settings Extension

**Goal:** Extend Void settings pane with Ribix-specific configuration.

### New settings section: "Ribix Command Center"

| Setting | Type | Default | Description |
|---|---|---|---|
| `ribix.maxConcurrentMissions` | number | 3 | Max missions running simultaneously |
| `ribix.maxAgentsPerMission` | number | 6 | Max agents spawned per mission |
| `ribix.defaultPlannerModel` | ModelSelection | (Void default) | Model used for Planner agent |
| `ribix.defaultCoderModel` | ModelSelection | (Void default) | Model used for Coder agent |
| `ribix.autoOpenCommandCenter` | boolean | true | Focus Command Center panel on startup |
| `ribix.orgSyncEnabled` | boolean | true | Sync memory to org on mission complete |
| `ribix.checkpointOnEveryWrite` | boolean | true | Checkpoint before every agent file write |
| `ribix.missionBranchPrefix` | string | "ribix/mission" | Git branch prefix for mission branches |

### Action items

- [ ] Add Ribix settings section to `voidSettingsPane.ts`
- [ ] Read settings from `voidSettingsService` (extend with Ribix keys)
- [ ] Wire settings to all services that consume them

### Acceptance criteria

- All Ribix settings visible in Settings tab of Command Center
- Changes take effect without IDE restart

---

## Phase 14 — E2E Testing & Hardening

**Goal:** Full end-to-end validation before alpha release.

### E2E scenarios (see `E2E_QA_Checklist.md` for full detail)

1. **Cold start:** Open IDE fresh → Command Center focused → no missions
2. **Create mission:** Type outcome → click Plan → plan renders with task tree
3. **Approve plan:** Click Approve → agents spawn → activity feed updates → mission completes
4. **Abort mission:** Mid-execution → abort → all files rolled back to pre-mission state
5. **Memory persistence:** Complete mission → restart IDE → memory entries persist
6. **File lock:** Two concurrent agents writing same file → second waits, no collision
7. **Auth flow:** Sign in → org memory pulls → sign out → org sync disabled
8. **Quick Edit:** Cmd+K works → autocomplete fires → existing Void behavior unaffected
9. **Rollback:** Agent writes file → engineer clicks "Reject this block" → file restored

### Performance targets

| Operation | Target |
|---|---|
| Planning call (outcome → task graph) | < 30 seconds |
| Command Center panel open | < 200ms |
| Agent activity feed update latency | < 500ms |
| Mission rollback (10 files) | < 3 seconds |
| Memory search (1000 entries) | < 100ms |

### Action items

- [ ] Run all E2E scenarios from `E2E_QA_Checklist.md`
- [ ] Profile Command Center render time
- [ ] Profile memory search at 1000 entries
- [ ] Fix any failures before marking phase complete

### Acceptance criteria

- All E2E scenarios pass
- All performance targets met
- Zero uncaught errors in console during normal usage

---

## Phase 15 — Alpha Packaging & Distribution

**Goal:** Package and distribute Ribix IDE for internal alpha users.

### Action items

- [ ] Confirm `product.json` has correct Ribix branding (from Phase 1)
- [ ] Run full build: `yarn gulp vscode-darwin-x64` (or platform equivalent)
- [ ] Sign build (macOS code signing, Windows Authenticode)
- [ ] Create internal download link
- [ ] Write alpha release notes (from mission history and phase summaries)
- [ ] Set up auto-update endpoint (`update.ribix.dev`)

### Acceptance criteria

- App launches on macOS and Windows without security warnings
- Auto-update check connects to `update.ribix.dev`
- All branding correct in About dialog, title bar, dock icon

---

## Appendix A — Agent System Prompts (Seed Versions)

These are starting points. Each prompt lives in `common/prompt/ribix{Type}Prompt.ts`.

### Planner Agent

```
You are the Planner agent for Ribix IDE.

Your job: Given an engineering outcome, decompose it into a task graph.

Rules:
- Return ONLY valid JSON matching the PlanTask[] schema
- Maximum 12 tasks
- First task always type "planner" with dependsOn: []
- Never include a "release" task unless the engineer explicitly requested it
- Flag high-risk tasks: tasks that touch auth, billing, crypto, or recently-broken files
- Write clear task descriptions an engineer can read and approve in 30 seconds
- Use the codebase memory and directory tree to resolve file references

Schema: [paste PlanTask[] TypeScript type here]
```

### Coder Agent

```
You are the Coder agent for Ribix IDE.

Your job: Implement the code changes described in your assigned task.

Rules:
- Read files before writing them — never assume content
- Write minimal targeted diffs — prefer editing existing code over full rewrites
- Match the existing code style exactly (naming, error handling, imports)
- Acquire a file lock before every write
- Leave a decision annotation comment for any non-obvious choice
- Do not write tests — that is the Tester agent's job
- Do not write documentation — that is the Docs agent's job
- If you are blocked (missing information, unclear scope), emit a "blocked" status and describe what you need
```

### Tester Agent

```
You are the Tester agent for Ribix IDE.

Your job: Write tests that verify the Coder agent's changes.

Rules:
- Detect the test framework from package.json before writing any tests
- Match the existing test file style exactly
- Write tests for the changed behavior, not the implementation
- Run the test suite after writing tests — report pass/fail per test
- If tests fail: emit a "blocked" status and surface the failure to the Debugger agent
- Do not write implementation code
```

### Reviewer Agent

```
You are the Reviewer agent for Ribix IDE.

Your job: Review the complete mission diff and report findings.

Rules:
- Read the full diff (all changed files) before commenting
- Check for: security surface changes, broken patterns, missing error handling, incorrect types
- Each finding must have: severity (low/medium/high), file, line, description, suggestion
- Do not rewrite code — annotate only
- A clean diff (no findings) is a valid result — say so explicitly
```

---

## Appendix B — Ribix vs Void Feature Map

| Feature | Void | Ribix IDE |
|---|---|---|
| Inline completions | ✅ Autocomplete | ✅ Preserved (Quick Edit) |
| Cmd+K rewrite | ✅ Quick Edit | ✅ Preserved (Quick Edit) |
| Chat sidebar | ✅ Thread-based chat | ✅ Preserved + labeled "Quick Edit" |
| Apply / diff review | ✅ Fast/Slow Apply | ✅ Preserved + extended with agent attribution |
| MCP tool integration | ✅ mcpService | ✅ Preserved |
| Outcome missions | ❌ | ✅ **New — core product** |
| Multi-agent execution | ❌ | ✅ **New** |
| Persistent memory | ❌ | ✅ **New** |
| Mission-scoped rollback | ❌ (per-edit only) | ✅ **New** |
| Command Center panel | ❌ | ✅ **New — primary UX** |
| Agent activity feed | ❌ | ✅ **New** |
| File lock coordination | ❌ | ✅ **New** |
| Ribix backend / org sync | ❌ | ✅ **New** |
| PR creation | ❌ | ✅ **New (via Release agent)** |

---

Confidential — Ribix Inc.   |   Version 1.0   |   2026-06-09
