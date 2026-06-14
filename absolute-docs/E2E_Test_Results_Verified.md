# Ribix IDE — E2E Test Results (Static Verification)

**Date:** 2026-06-13
**Phase:** 14 — E2E Testing & Hardening
**Method:** Static verification — code tracing without a running binary.

---

## About This File

Five scenarios from `E2E_QA_Checklist.md` have been traced through the source to confirm that the code path exists and behaves correctly.  Each entry records:

- The exact function-call chain through production code
- The state transitions or data shapes produced
- The file:line evidence

These are marked **Verified (static)** — they confirm code correctness, not live runtime behaviour.

---

## Verified Scenarios

---

### Scenario V1 — Mission Creation Flow

**Checklist reference:** Phase 5 + 8 — Create Mission — Planning

**Claim:** Submitting an outcome in the panel creates a mission, transitions it to `planning`, kicks off the planner, and transitions to `plan_ready` after the planner resolves.

**Code trace:**

1. `RibixMissionsPanel.handlePlanThis()` — `ribixMissionsPanel.tsx`
   Calls `missionService.createMission(outcome, context)` with the collected `attachedFiles`, `attachedSelections`, and `issueUrls`.

2. `RibixMissionService.createMission()` — `ribixMissionService.ts:228`
   Creates a `Mission` object with `state: 'awaiting_outcome'`, persists it via `saveMission()`, fires `onDidChangeMissions`.

3. `RibixMissionsPanel.handlePlanThis()` calls `missionService.submitForPlanning(mission.id)`.

4. `RibixMissionService.submitForPlanning()` — `ribixMissionService.ts:309`
   Validates `state === 'awaiting_outcome'`, sets `mission.state = 'planning'`, persists, then calls `this.planningService.plan(id, mission.outcome, planningContext)` (fire-and-forget `.then()`).

5. `RibixPlanningService.plan()` — `ribixPlanningService.ts:52`
   Gathers memory + directory context, builds prompt, calls LLM, returns `PlanTask[]`.

6. Back in `submitForPlanning`'s `.then()` handler — `ribixMissionService.ts:329`
   Calls `this.setPlanReady(id, tasks)`.

7. `RibixMissionService.setPlanReady()` — `ribixMissionService.ts:337`
   Validates `state === 'planning'`, sets `mission.tasks = tasks`, sets `mission.state = 'plan_ready'`, persists, fires `onDidChangeMissions`.

**State machine path:** `awaiting_outcome` → `planning` → `plan_ready`.

**Status:** Verified (static)

---

### Scenario V2 — Agent Loop Multi-Turn

**Checklist reference:** Phase 6 — Execute Mission — agent activity feed + file writes

**Claim:** The agent loop feeds tool results back into the message array every turn, and budget guards (maxTurns, maxTokens, deadlineMs) terminate the loop cleanly.

**Code trace:**

1. `RibixAgentService.executeAgent()` — `ribixAgentService.ts:188`
   Initialises a `CancellationTokenSource` and `budget = this.budgetForType(agent.type)`, computes `deadline = Date.now() + budget.deadlineMs`.

2. Message array is initialised: `messages: AgentTurnMessage[] = [{ role: 'system', content: prompt }, { role: 'user', content: taskDescription }]`.

3. Turn loop — `ribixAgentService.ts:210`
   ```
   for (let turn = 0; turn < budget.maxTurns; turn++) {
       if (token.isCancellationRequested) { break; }
       if (Date.now() > deadline) { budgetHit = 'deadline'; break; }
       if (estimateTokens(messages) > budget.maxTokens) { budgetHit = 'tokens'; break; }
   ```
   All three guards are checked at the top of every turn before any LLM call.

4. After each LLM reply, tool calls are parsed — `ribixAgentService.ts:226`:
   ```
   const toolCalls = this.parseToolCalls(reply);
   for (const call of toolCalls) {
       const resultText = await this.runOneTool(agent, call);
       messages.push({ role: 'tool', toolName: call.tool, content: resultText });
   ```
   Tool results are pushed as `role: 'tool'` messages and carried into the next turn's `callLLM()` call.

5. `callLLM()` — `ribixAgentService.ts:503`
   Converts `role: 'tool'` messages to `{ role: 'user', content: '[tool result: <name>]\n<result>' }` so the LLM receives each tool output on the next turn.

6. If `turn === budget.maxTurns - 1`, `budgetHit = 'maxTurns'` is set before the loop exits.

**Evidence:** `DEFAULT_AGENT_BUDGETS` is defined in `ribixAgentLoopTypes.ts` and consumed at `ribixAgentService.ts:179`.

**Status:** Verified (static)

---

### Scenario V3 — Reviewer env-parity Detection

**Checklist reference:** Phase 6 + QA Checklist Section 13 (Error States)

**Claim:** The Reviewer agent prompt contains explicit env-parity detection instructions, including checking `process.env.X` references against `.env.example`.

**Code trace:**

`generateReviewerPrompt()` — `ribixReviewerPrompt.ts:21`

The prompt contains a dedicated section at line 77:

```
## Environment Parity Detection (env-parity)

Flag any finding in this category with tag [env-parity].

- **OS-specific paths**: hardcoded /tmp/, C:\\, \\\\, or drive letters...
- **Missing .env.example entries**: every process.env.X reference must have
  a corresponding entry in .env.example. Flag any variable that does not.
- **Node version assumptions**: ...
- **Dev stubs in production paths**: any code that behaves differently based on
  NODE_ENV must have an explicit if (process.env.NODE_ENV !== 'production') guard.
```

The prompt instructs the reviewer to:
1. Detect every `process.env.X` reference in the diff.
2. Cross-check against `.env.example`.
3. Emit a `[env-parity]`-tagged finding for any variable without a `.env.example` entry.

**Status:** Verified (static)

---

### Scenario V4 — Finding Submission to Backend

**Checklist reference:** Phase 10 (Auth) + Phase 11 (PR Creation) downstream

**Claim:** After a mission completes, findings are submitted to the backend via `POST /cli/findings/submit`. On network failure, they are queued for retry. The submit is fire-and-forget — it never fails the mission.

**Code trace:**

1. `RibixMissionService.completeMission()` — `ribixMissionService.ts:400`
   Sets `mission.state = 'complete'`, persists, then:
   ```ts
   this.submitFindingsToBackend(mission).catch(e => {
       console.warn('submitFindingsToBackend: unexpected error:', e);
   });
   ```
   Fire-and-forget: `.catch()` swallows errors so the mission is never blocked.

2. `RibixMissionService.submitFindingsToBackend()` — `ribixMissionService.ts:432`
   Collects `AgentFinding[]` from `mission.result.reviewerFindings`, resolves auth config via `authService.getRequiredConfig()` (returns early if not signed in), resolves `repoFullName` from the git remote, then:
   ```ts
   const apiClient = new RibixApiClient();
   const response = await apiClient.submitFindings(config, repoFullName, findings, mission.id);
   ```

3. `RibixApiClient.submitFindings()` — `ribixApiClient.ts:87`
   Maps `AgentFinding[]` to `SubmittedFinding[]` (severity mapping: `high→p0`, `medium→p1`, `low→p2`), then:
   ```ts
   return this.post<SubmitFindingsResponse>(config, '/cli/findings/submit', request);
   ```
   Route: `POST /cli/findings/submit`.

4. On network failure, the `catch` block in `submitFindingsToBackend` — `ribixMissionService.ts:488` — calls `this.queueFindingsForRetry(repoFullName, findings, mission.id)`.

5. `queueFindingsForRetry()` — `ribixMissionService.ts:499`
   Reads the queue from `storageService.get(RIBIX_PENDING_FINDINGS_KEY, StorageScope.APPLICATION, '[]')`, appends the new item with `retries: 0`, persists back.

**Status:** Verified (static)

---

### Scenario V5 — Offline Queue Retry

**Checklist reference:** Phase 10 (Auth) — sign-in triggers offline queue flush

**Claim:** `flushPendingFindings()` reads from the `ribix.pendingFindings` storage key, retries submissions on failure, discards items after 5 retries, and is triggered on auth sign-in and IDE window focus.

**Code trace:**

1. Storage key — `ribixMissionService.ts:77`:
   ```ts
   const RIBIX_PENDING_FINDINGS_KEY = 'ribix.pendingFindings';
   const MAX_PENDING_FINDINGS_RETRIES = 5;
   ```

2. Auth sign-in trigger — `ribixMissionService.ts:117`:
   ```ts
   this._register(this.authService.onDidChangeSession(summary => {
       if (summary.status === 'signed_in') {
           this.flushPendingFindings().catch(...);
       }
   }));
   ```

3. Window focus trigger — `ribixMissionService.ts:125`:
   ```ts
   this._register(this.hostService.onDidChangeFocus(focused => {
       if (focused) {
           this.flushPendingFindings().catch(...);
       }
   }));
   ```

4. `flushPendingFindings()` — `ribixMissionService.ts:516`:
   Reads `RIBIX_PENDING_FINDINGS_KEY` with `StorageScope.APPLICATION`, iterates each item:
   ```ts
   if (item.retries >= MAX_PENDING_FINDINGS_RETRIES) {
       console.warn(`...discarding findings for mission ${item.missionId} after ${item.retries} failed attempts`);
       continue; // discard — not pushed to remaining
   }
   ```
   On successful submit: item is not pushed to `remaining` (dropped).
   On failed submit: `remaining.push({ ...item, retries: item.retries + 1 })`.
   After processing: `storageService.store(RIBIX_PENDING_FINDINGS_KEY, JSON.stringify(remaining), ...)`.

**Discard threshold:** 5 retries (`MAX_PENDING_FINDINGS_RETRIES = 5`, `ribixMissionService.ts:79`).

**Status:** Verified (static)

---

## Updated Scenario Table

| # | Scenario | Status |
|---|---|---|
| V1 | Mission creation flow (state machine) | Verified (static) |
| V2 | Agent loop multi-turn + budget enforcement | Verified (static) |
| V3 | Reviewer env-parity detection | Verified (static) |
| V4 | Finding submission to backend (fire-and-forget + error queue) | Verified (static) |
| V5 | Offline queue retry (storage key, discard at 5, flush on sign-in) | Verified (static) |

5 of 119 total scenarios verified.  The remaining 114 require a built, runnable IDE binary and are blocked by the P0/P1 gaps documented in `E2E_Test_Results.md`.

---

**Prepared by:** Ribix Engineering (static analysis pass)
**Date:** 2026-06-13
