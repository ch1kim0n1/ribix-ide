# Ribix IDE — Engineering Plan

**Date:** 2026-06-12
**Version:** 2.0 (forward-looking rewrite)
**Status:** Alpha scaffold landed; **core autonomous loop NOT yet functional.** The Command Center UI, mission lifecycle, multi-agent orchestration scaffolding, OAuth, API client, checkpoints, and file locking are wired and demoable. However, the agent runtime is **one-shot, not agentic**, mission **persistence corrupts** after any agent run, inter-agent handoff is **cosmetic**, and there is **no auto-on-change trigger** — so the product's defining behavior (autonomous QA on every change) does not yet run. This plan is the remediation roadmap, not a completion report.

**Base:** Void editor fork (forks Code-OSS 1.99.3) — `ribix-ide/`. ~6000 base files; Ribix adds ~49 files / ~6k LOC, cleanly namespaced under `src/vs/workbench/contrib/void/{browser,common,electron-main}/ribix*` plus React UI under `react/src/command-center-tsx/`.

**Goal of this repo (`ribix-ide`):** Be the desktop IDE surface of Ribix — an autonomous AI QA Engineer. The system's core loop is **IDENTIFY → DOCUMENT → SOLVE (real PR)** plus a UI/UX vision pass. It must run **unsupervised**: automatically on the changed chunk per commit/save, *or* on explicit user demand.

**This repo is one of five that form one system ("Ribix"):**
- `ribix` — backend engine (agent-run + finding schema, `/api/v1/*` contracts)
- `ribix-cli` — command-line surface
- **`ribix-ide` — THIS repo, the desktop IDE**
- `ribix-vs-extension` — VS Code extension surface (shares OAuth/apiClient patterns mirrored here)
- `ribix-web` — web dashboard

Cross-repo contracts (OAuth scopes, `/api/v1/*` memory + PR endpoints, and the shared **agent-run / finding** schema) are owned by `ribix` (backend). Any change to those shapes in this repo must be coordinated there. Items below that touch shared contracts are explicitly flagged **[cross-repo]**.

**Fork-maintenance posture.** This is a *full* VSCode/Code-OSS fork: gulp build, Electron, pinned Node, ~8–10 min cold builds, and periodic upstream rebases. The cost is real and ongoing. The mitigating fact is that **all Ribix code is isolated under `contrib/void/ribix*`** with low conflict surface against upstream. The discipline that keeps the rebase cost bounded is: *never edit upstream files except at registration seams* (`void.contribution.ts`, `app.ts`/`mainProcessService` channel registration, settings pane). Every phase below respects that boundary, and P3 includes a rebase runbook.

---

## Current State Assessment

### What is real and wired (verified by reading source)

The end-to-end *demo* path closes in the UI: the React Command Center (`react/src/command-center-tsx/ribixMissionsPanel.tsx`) submits an outcome, the plan-review dialog approves it (`ribixPlanReviewDialog.tsx:36-38` → `approvePlan` → `executeMission`), orchestration spawns agents, and agents make **real** `toolsService.callTool` calls and **real** LLM calls through `ILLMMessageService`.

| Capability | Where | Status |
|---|---|---|
| Service DI registration | `browser/void.contribution.ts:69-124` | Real — all Ribix services `registerSingleton`'d |
| Mission lifecycle state machine | `browser/ribixMissionService.ts` (421 LOC) | Real transitions; **persistence broken (see gaps)** |
| Topological orchestration + cycle detection | `browser/ribixOrchestrationService.ts` (412), `ribixPlanningService.ts:309-363` | Real DAG sort, cycle + dangling-dep checks |
| Agent spawn / tracking / abort | `browser/ribixAgentService.ts` (460) | Real lifecycle; **execution is one-shot (see gaps)** |
| Outcome → task graph via LLM | `browser/ribixPlanningService.ts` (380) | Real LLM call, schema validation, safe fallback |
| Real tool execution | `ribixAgentService.ts:383-405` via `toolsService.callTool` | Real — write/read/search/run, lock + checkpoint on writes |
| Browser/QA tools over IPC to Playwright | `electron-main/ribixBrowserChannel.ts:136` | Real IPC channel |
| MCP tool routing (fallthrough) | `ribixAgentService.ts:353-368` via `IMCPService` | Real |
| OAuth PKCE | `browser/ribixAuthService.ts` (395), `ribixAuthActions.ts:43-66` (scope `ide:memory`) | Real PKCE flow |
| Backend HTTP client | `common/ribixApiClient.ts` (178) — fetch to `/api/v1/*` | Real |
| Checkpoint / rollback | `browser/ribixCheckpointService.ts` (173), reuses `VoidFileSnapshot` | Real |
| File locking | `common/ribixFileLockService.ts` (140) | Real acquire/release |
| Task queue | `common/ribixTaskQueueService.ts` (115) | Real priority queue |
| Diff annotation widget | `browser/ribixDiffAnnotationWidget.ts` (378) | Real decorations + code lens |
| Agent system prompts (×8) | `common/prompt/ribix*Prompt.ts` | Real prompt templates |
| CI release build | `.github/workflows/build-release.yml` | Fixed — correct gulp darwin/linux tasks (latest commit) |

### What is shallow, stubbed, or broken

| Problem | Where | Symptom |
|---|---|---|
| Agents are one-shot | `ribixAgentService.ts:146-197` | Single `callLLM` → parse → execute → done. Tool results never returned to the model. No iteration. |
| Mission persistence corrupts | `ribixMissionService.ts:69-92` vs `ribixAgentService.ts:409-428` | Two writers share the `mission_summary` memory type with different shapes; `loadMissions()` JSON-parses *all* of them as `Mission`. |
| Append-not-update persistence | `ribixMissionService.ts:82-94` | Every save appends a *new* memory entry; unbounded duplicates, stale reload. |
| Inter-agent handoff cosmetic | `ribixOrchestrationService.ts:392-397` | `extractAgentOutput` returns the last activity-log `detail` string. |
| `determineSemverBump` stub | `ribixMissionService.ts:292-299` | Hardcoded `return 'patch'`. |
| `setInterval` polling | `ribixOrchestrationService.ts:285-305` | 1 s poll for agent completion instead of events. |
| Empty mission context | `ribixMissionService.ts:145-150` | Planner called with empty `attachedFiles`/`selections`/`notes`. |
| No auto-trigger | *absent everywhere in `ribix*`* | Nothing watches saves/commits; everything is manual. |

---

## Vision Gap

The product is an **autonomous QA engineer** whose core loop is *find a bug → write a failing test → propose/verify a fix → re-test*, running **unsupervised on the changed chunk** of every commit/save. Three gaps sit between the current scaffold and that vision. They are the spine of P0 and P1.

**1. The agent cannot iterate (G-LOOP — the #1 gap).** `ribixAgentService.executeAgent` (`ribixAgentService.ts:146-197`) does exactly one LLM turn: build prompt → `callLLM` → `processToolCalls` → write memory → done. `processToolCalls` (`:315-407`) *executes* tools but **throws the results away** — `toolsService.callTool[...]()` returns `{ result, interruptTool? }` and the agent ignores `result`. Because tool output is never fed back to the model, the model can never observe a test failure, read a file it just discovered it needs, or decide what to do next. The "find bug → write failing test → verify fix → re-test" loop exists only in the prompt text, not in the runtime. **Without a real multi-turn loop, no agent type actually does its job.**

**2. There is no autonomous trigger (G-AUTOTRIGGER — the biggest IDE-specific gap).** Every mission today starts from a human clicking "Plan This." Nothing in `ribix*` listens for file saves or git commits, computes what changed, and launches a scoped QA mission on that surface. This is the single behavior that makes Ribix an *autonomous* QA engineer inside the IDE rather than a manual agent panel.

**3. Persistence corrupts the mission store (G-PERSIST).** Missions are stored as `mission_summary` memory entries (`ribixMissionService.ts:82-92`), but agents *also* write `mission_summary` entries with a completely different shape (`ribixAgentService.ts:409-428`). On reload, `loadMissions()` (`:69-80`) `JSON.parse`s **every** `mission_summary` entry as a `Mission`, so after any agent has ever run, the mission list is polluted with malformed objects. Compounding it, every state transition *appends* a new entry rather than updating in place, producing unbounded duplicates and stale reloads. A product that runs unsupervised must survive a restart; today it does not.

Secondary gaps that block depth: cosmetic inter-agent handoff (G-HANDOFF), `setInterval` polling instead of events (G-POLL), unused rich mission context (G-CONTEXT), and the `determineSemverBump` stub (G-SEMVER).

---

## Key architectural patterns (follow in all new code)

These are the Void/Code-OSS idioms every new Ribix file must conform to. They are *not* optional — deviating from them is what makes upstream rebases painful.

- **Service definition:** `export const IFooService = createDecorator<IFooService>('fooService')` next to an `export interface IFooService { readonly _serviceBrand: undefined; ... }`.
- **Service registration:** `registerSingleton(IFooService, FooService, InstantiationType.Delayed)` at the bottom of the file; add a side-effect `import './fooService.js'` to `browser/void.contribution.ts` (or the `common/` block at its tail) so registration runs. **This is the only edit to an upstream-adjacent file that a new service should require.**
- **Service consumption:** constructor injection — `@IFooService private readonly fooService: IFooService`. Extend `Disposable` and `super()` first.
- **Events:** `private readonly _onDidX = new Emitter<T>(); readonly onDidX = this._onDidX.event;` from `base/common/event.js`. Register listeners with `this._register(other.onDidY(() => ...))`. Prefer events over polling.
- **Cancellation:** `CancellationTokenSource` / `CancellationToken` from `base/common/cancellation.js`; pair with `AbortController` when crossing into fetch/IPC (the agent service already does this at `ribixAgentService.ts:147-148`).
- **Browser ↔ main (Node) work:** implement in `electron-main/`, expose a channel, register it in `app.ts`, and consume from the browser via `ProxyChannel.toService<IFoo>(mainProcessService.getChannel('void-channel-foo'))` (see `ribixMissionService.ts:65` and `electron-main/ribixBrowserChannel.ts`).
- **LLM calls:** `ILLMMessageService.sendLLMMessage({ messagesType: 'chatMessages', messages, modelSelection, logging, onText, onFinalMessage, onError, onAbort })` returns a `requestId | null`; cancel via `.abort(requestId)`. The callback hooks are stripped before crossing IPC (`sendLLMMessageService.ts:104-139`). Wrap in a `Promise` that resolves on `onFinalMessage` and rejects on `onError`/`onAbort` (existing pattern at `ribixAgentService.ts:279-313`).
- **Tools:** `IToolsService` exposes three parallel maps keyed by tool name — `validateParams[tool](rawParams)` → typed params, `callTool[tool](typed)` → `{ result, interruptTool? }`, and **`stringOfResult[tool](typed, result)` → string**. The last one is the key to the agentic loop: it turns a tool result into text to feed back to the model.
- **Storage:** `IStorageService` with `StorageScope.WORKSPACE` (per-repo) or `StorageScope.PROFILE` (global) + `StorageTarget.USER`. Serialize JSON; guard `JSON.parse` (see `ribixMemoryService.ts:65-75`).
- **React layer:** lives under `react/src/command-center-tsx/`, bundled separately (`node build.js` / `npm run buildreact`), mounted via `ReactDOM.createRoot` from the pane (`ribixCommandCenterPane.ts`). React talks to services through injected accessors, not by importing service singletons directly.
- **Test harness:** Void/Code-OSS uses Mocha with the `suite()`/`test()` globals and `assert` from `assert`. Service unit tests instantiate via `TestInstantiationService` (`platform/instantiation/test/common/instantiationServiceMock.ts`) and run under `./scripts/test.sh` (browser/common) or the integration runner. New `*.test.ts` files live beside the code under a `test/` sibling, mirroring upstream layout.

---

## Phase P0 — Make the agent actually work

**Goal:** Turn the scaffold into a functioning runtime. After P0, a single agent can iterate to completion, missions survive a restart, agents hand structured output to each other, and orchestration reacts to events instead of polling. **Nothing in P1–P3 is meaningful until P0 lands.**

### P0-1 — Convert `ribixAgentService` to a real multi-turn agentic loop

**Files:** `browser/ribixAgentService.ts` (rewrite `executeAgent`, `callLLM`, `processToolCalls`); `common/ribixTypes.ts` (add loop budget/types); optionally `common/ribixAgentLoopTypes.ts` (new) for the message/turn types.

**What to implement.** Replace the linear `executeAgent` body (`ribixAgentService.ts:146-197`) with a turn loop that maintains a running message array and feeds tool results back to the model until the model emits no tool calls, signals done, or the budget is exhausted:

```typescript
// common/ribixAgentLoopTypes.ts
export type AgentLoopBudget = { maxTurns: number; maxTokens: number; deadlineMs: number };
export type AgentTurnMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; toolName: string; content: string };  // serialized tool result fed back
```

```typescript
// ribixAgentService.ts — sketch of the new loop
private async executeAgent(agent: AgentInstance, taskDescription: string, context?: AgentRunContext): Promise<void> {
  const tokenSource = new CancellationTokenSource();
  this.executionStates.set(agent.id, { agentId: agent.id, tokenSource, abortController: new AbortController() });
  const budget = this.budgetForType(agent.type); // e.g. coder: { maxTurns: 12, maxTokens: 120_000, deadlineMs: 5*60_000 }
  const messages: AgentTurnMessage[] = [
    { role: 'system', content: this.generatePrompt(agent.type, taskDescription, await this.loadMemory(agent), context) },
    { role: 'user', content: taskDescription },
  ];
  try {
    for (let turn = 0; turn < budget.maxTurns; turn++) {
      if (tokenSource.token.isCancellationRequested) break;
      this.updateAgentStatus(agent, 'executing', `Turn ${turn + 1}`);
      const reply = await this.callLLM(messages, tokenSource.token);  // now takes message array
      messages.push({ role: 'assistant', content: reply });
      const toolCalls = this.parseToolCalls(reply);
      if (toolCalls.length === 0) { break; }                  // model is done
      for (const call of toolCalls) {
        if (tokenSource.token.isCancellationRequested) break;
        const resultText = await this.runOneTool(agent, call); // executes + STRINGIFIES result
        messages.push({ role: 'tool', toolName: call.tool, content: resultText });
      }
    }
    await this.writeMemory(agent, taskDescription, messages); // see P0-2: write to AGENT namespace, not mission_summary
    this.updateAgentStatus(agent, 'complete', 'Task completed');
    agent.completedAt = Date.now();
  } catch (e) { /* markAgentFailed unless cancelled */ }
  finally { this.executionStates.delete(agent.id); this._onDidChangeAgents.fire(); }
}
```

`runOneTool` is the refactor of the inner body of `processToolCalls` (`:337-406`) for a *single* call, with the critical change that it **captures the result** and stringifies it via `toolsService.stringOfResult`:

```typescript
private async runOneTool(agent: AgentInstance, call: { tool: string; params: Record<string,string|undefined> }): Promise<string> {
  // ... MCP fallthrough unchanged (:353-368), but RETURN the MCP text instead of only logging it
  const validated = this.toolsService.validateParams[call.tool as keyof ...](call.params);
  const filePath = validated?.uri?.fsPath ?? null;
  if (WRITE_TOOLS.has(call.tool) && filePath) {
    const release = await this.fileLockService.acquire(filePath, agent.id);
    try {
      await this.checkpointService.checkpoint(agent.missionId, agent.id, filePath);
      const { result } = await this.toolsService.callTool[call.tool as keyof ...](validated as never);
      agent.filesWritten.push(filePath);
      return this.toolsService.stringOfResult[call.tool as keyof ...](validated as never, await result);
    } finally { release(); }
  }
  const { result } = await this.toolsService.callTool[call.tool as keyof ...](validated as never);
  if (call.tool === 'read_file' && filePath && !agent.filesRead.includes(filePath)) agent.filesRead.push(filePath);
  return this.toolsService.stringOfResult[call.tool as keyof ...](validated as never, await result);
}
```

`callLLM` (`:279-313`) changes signature from `(prompt: string)` to `(messages: AgentTurnMessage[])`, mapping the array into the `messages` field of `sendLLMMessage` (the first `system` message goes into `separateSystemMessage`, the rest into `messages`). Keep the existing Promise-wrapping, cancellation hook (`:309-311`), and abort behavior.

**Rationale.** Directly closes G-LOOP. Reusing `toolsService.stringOfResult` means no new tool layer — the loop is built entirely from existing seams.

**Acceptance criteria.**
- An agent given "read file X, then summarize it" performs ≥2 turns: turn 1 emits a `read_file` call; the file contents appear as a `tool` message; turn 2 produces a summary that references real content.
- A Tester agent can write a failing test, observe the failure via fed-back `run_command` output, and react (write a fix or mark blocked) — within budget.
- Budget guardrails terminate cleanly: hitting `maxTurns`/`deadlineMs` marks the agent complete-with-warning, not hung.
- Cancellation mid-loop aborts the in-flight LLM request and stops the loop within one turn.

**Test approach.** Mocha unit test with a stub `ILLMMessageService` whose `sendLLMMessage` returns scripted `onFinalMessage` payloads turn-by-turn, and a stub `IToolsService` recording `callTool`/`stringOfResult` invocations. Assert message array growth, tool-result feedback, and budget termination. Run under `./scripts/test.sh`.

**Code-review checklist.** Tool results are appended as `tool` messages every turn; no `result` is silently dropped; budget enforced; locks always released in `finally`; checkpoint precedes every write; cancellation token checked at top of each turn and between tool calls; no upstream files touched.

**Dependencies.** Independent of P1–P3. Blocks everything. **[cross-repo]** none directly, but the loop's notion of a completed "agent run" should serialize to the shared agent-run schema owned by `ribix` backend — coordinate field names before P0-2 finalizes the persisted shape.

### P0-2 — Fix mission persistence (separate namespace, update-in-place, schema-versioned, migration)

**Files:** `browser/ribixMissionService.ts` (`loadMissions`, `saveMission`, all transition methods); `browser/ribixAgentService.ts` (`writeMemory`, `:409-428`); `common/ribixTypes.ts` (add `schemaVersion`); optionally `common/ribixMissionStore.ts` (new) to encapsulate storage.

**What to implement.**
1. **Stop overloading `mission_summary`.** Missions must not share a memory type with agent summaries. Give missions their own dedicated `IStorageService` key, `ribix.missions.v1`, separate from the memory store entirely — missions are application state, not "knowledge." Agent run summaries keep using memory but under a distinct type, e.g. `'agent_run'` (add to `MemoryEntryType` in `ribixTypes.ts:7-13`), so `ribixAgentService.writeMemory` (`:409-428`) no longer collides.
2. **Update-in-place, not append.** Replace `saveMission` (`:82-94`): load the full mission array from `ribix.missions.v1`, splice/replace the mission with matching `id`, and `store` the whole array once. No more one-entry-per-transition.
3. **Schema-versioned records.** Add `schemaVersion: number` to `Mission` (`ribixTypes.ts:55-72`). Persist `{ schemaVersion: 1, missions: Mission[] }`.
4. **Migration of corrupt entries.** On first load after this lands, run a one-shot migration: read legacy `mission_summary` memory entries, attempt to parse each, keep only objects that pass a `isMission()` type guard (has `id`, `state`, `tasks[]`), write the survivors to `ribix.missions.v1`, then delete the legacy `mission_summary` entries that were *missions* (leave agent-shaped ones, which the new `agent_run` reader will ignore). Guard the whole thing so it runs at most once (a `ribix.missions.migrated` flag).

```typescript
// ribixMissionService.ts
private async saveMission(mission: Mission): Promise<void> {
  const all = this.missions.slice();
  const i = all.findIndex(m => m.id === mission.id);
  if (i >= 0) all[i] = mission; else all.unshift(mission);
  this.missions = all;
  this.storageService.store('ribix.missions.v1', JSON.stringify({ schemaVersion: 1, missions: all }),
    StorageScope.WORKSPACE, StorageTarget.USER);
  this._onDidChangeMissions.fire();
}
```

**Rationale.** Closes G-PERSIST. An unsupervised product must survive restarts deterministically.

**Acceptance criteria.**
- Run a mission to completion (agents write `agent_run` entries), restart, reload: the mission list contains exactly the real missions, correctly shaped, with final state — zero malformed objects.
- N state transitions on one mission produce exactly **one** persisted record (verified by store inspection), not N.
- Opening a workspace that contains legacy corrupt `mission_summary` entries triggers migration once and yields a clean mission list; second open is a no-op.

**Test approach.** Mocha unit test with an in-memory `IStorageService` stub. Seed legacy mixed `mission_summary` entries (some valid Mission JSON, some agent-shaped). Assert migration output, single-record update semantics, and round-trip survival.

**Code-review checklist.** Missions and agent summaries never share a storage namespace; `saveMission` writes the whole array once; `schemaVersion` present; migration idempotent and guarded; `loadMissions` guards `JSON.parse` and the outer shape; agent `writeMemory` uses `agent_run`.

**Dependencies.** Should land alongside or just after P0-1 (the loop's `writeMemory` change is part of this). **[cross-repo]** the `agent_run` memory shape should match the backend's agent-run schema if those entries sync via `/api/v1/*` — confirm with `ribix`.

### P0-3 — Real inter-agent handoff (structured `AgentOutput`, not last-log string)

**Files:** `browser/ribixOrchestrationService.ts` (`extractAgentOutput` `:392-397`, `buildTaskContext` `:254-283`, `handleTaskCompletion` `:307-333`); `common/ribixTypes.ts` (add `AgentOutput`); `browser/ribixAgentService.ts` (populate a structured output on the agent instance).

**What to implement.** Add a structured output that the agent fills as it runs and that orchestration reads when wiring dependents:

```typescript
// ribixTypes.ts
export type AgentOutput = {
  summary: string;            // 1–3 sentence what-was-done
  filesChanged: string[];
  testReport: string | null;  // tester/debugger fill this
  findings: { severity: RiskLevel; file: string; line: number | null; message: string }[]; // reviewer
  blocked: { reason: string } | null;
  rawFinalMessage: string;    // model's last assistant turn, for debugging
};
```

`AgentInstance` (`ribixTypes.ts:74-86`) gains `output: AgentOutput | null`. The agent loop (P0-1) populates it on completion — `summary`/`findings` parsed from the final assistant message, `filesChanged` from `agent.filesWritten`, `testReport` from the last `run_command` tool result that looks like a test run. `extractAgentOutput` (`:392-397`) is deleted; `handleTaskCompletion` stores `agent.output` into `taskContexts`. `buildTaskContext` (`:254-283`) maps the *structured* dependency outputs onto the right prompt slots (`plannerOutput`, `coderOutput`, `testReport`, etc.) instead of a string blob, so the prompt-builder slots in `ribixAgentService.generatePrompt` (`:199-277`) finally receive real content.

**Rationale.** Closes G-HANDOFF. The Coder needs the Planner's actual plan; the Tester needs the Coder's actual changed files; the Reviewer needs the real test report. Today they get the last log line.

**Acceptance criteria.**
- In a planner→coder→tester chain, the coder prompt's `plannerOutput` contains the planner's structured summary; the tester prompt's `coderOutput` lists the coder's `filesChanged`.
- A reviewer task receives a non-empty `testReport` when an upstream tester produced one.

**Test approach.** Orchestration unit test with stub agents returning canned `AgentOutput`s; assert the context object passed into `spawnAgent` for each dependent.

**Code-review checklist.** `AgentOutput` populated for every terminal status (complete *and* blocked/failed); `buildTaskContext` reads structured fields, not strings; no references to `extractAgentOutput` remain.

**Dependencies.** Builds on P0-1 (the loop produces the final message and tool results that populate `AgentOutput`).

### P0-4 — Replace `setInterval` polling with `Emitter`-based completion events

**Files:** `browser/ribixAgentService.ts` (add `onDidCompleteAgent`); `browser/ribixOrchestrationService.ts` (`monitorAgentCompletion` `:285-305`).

**What to implement.** Add a dedicated event on the agent service:

```typescript
// ribixAgentService.ts
private readonly _onDidCompleteAgent = new Emitter<{ agentId: string; status: 'complete' | 'failed' }>();
readonly onDidCompleteAgent = this._onDidCompleteAgent.event;
// fire in updateAgentStatus / markAgentFailed when status becomes terminal
```

Add `onDidCompleteAgent` to the `IRibixAgentService` interface (`ribixAgentService.ts:28-41`). In orchestration, delete `monitorAgentCompletion`'s `setInterval` (`:287-301`) and instead, when spawning, register a one-shot listener keyed by `agentId` that routes to `handleTaskCompletion`/`handleTaskFailure` and disposes itself:

```typescript
const listener = this.agentService.onDidCompleteAgent(e => {
  if (e.agentId !== agentId) return;
  listener.dispose();
  if (e.status === 'complete') this.handleTaskCompletion(missionId, task.id, agentId, state);
  else this.handleTaskFailure(missionId, task.id, agentId, state);
});
this._register(listener);
```

**Rationale.** Closes G-POLL. Polling adds up to 1 s latency per task transition and leaks intervals across missions; events are the codebase idiom.

**Acceptance criteria.** No `setInterval` remains in orchestration; a 3-task chain advances with sub-100 ms transition latency in tests; aborting/disposing the service removes all listeners (no leaks).

**Test approach.** Fire `onDidCompleteAgent` from a stub agent service; assert `handleTaskCompletion` runs immediately and the listener is disposed.

**Code-review checklist.** Listener keyed and one-shot; `this._register` on the listener; terminal event fired exactly once per agent; interface updated.

**Dependencies.** Independent of P0-1 but trivially combined with it.

---

## Phase P1 — Autonomous on-change in the IDE (vision-critical)

**Goal:** Make Ribix run *by itself*. A new watcher service observes file saves and git commits, debounces, computes the changed chunk, and auto-launches a **scoped** QA mission (Tester-led) on just that surface — with a user-controllable auto/manual toggle and non-blocking notification UX. This is the behavior that distinguishes the IDE product. **Depends on P0** (an auto-launched mission is worthless if the agent can't iterate).

### P1-1 — `ribixChangeWatcherService` (save + commit watcher with debounce)

**Files (new):** `browser/ribixChangeWatcherService.ts`; register in `void.contribution.ts`. **Reuses:** `ITextFileService` (already imported in `voidModelService.ts:7,33`) for save events; `IVoidSCMService` (`common/voidSCMTypes.ts`) for commit/branch context.

**What to implement.** A `Disposable` service registered `InstantiationType.Eager` (it must start listening at startup, not lazily). It listens to `ITextFileService.files.onDidSave` (and a workspace git HEAD-change signal for commits), buffers changed URIs, and debounces (default 2500 ms of quiet) before emitting a single `onDidDetectChange` event carrying the batch:

```typescript
export interface IRibixChangeWatcherService {
  readonly _serviceBrand: undefined;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;             // auto/manual toggle
  onDidDetectChange: Event<ChangedChunk>;
}
export type ChangedChunk = {
  trigger: 'save' | 'commit';
  files: { uri: string; ranges: [number, number][] }[]; // ranges from P1-2
  branch: string | null;
  detectedAt: number;
};
```

Gate everything behind `enabled` and the `ribix.autoTriggerMode` setting (P1-4). Ignore files outside the workspace, files matching VCS-ignore, generated/`node_modules`/`out` paths, and files Ribix agents themselves just wrote (consult `ribixFileLockService` / recent `agent.filesWritten`) to prevent self-trigger loops. Coalesce rapid saves of the same file.

**Rationale.** Closes G-AUTOTRIGGER. Save and commit are the two natural "a change happened" signals in an IDE.

**Acceptance criteria.** Saving three files within the debounce window yields exactly one `onDidDetectChange` with three files; a save inside an ignored path yields none; a file written by an agent during a mission does not re-trigger; toggling `enabled` off silences all events.

**Test approach.** Stub `ITextFileService` save emitter; fire bursts; assert debounced batching, ignore filtering, and self-write suppression.

**Code-review checklist.** Eager registration; debounce timer disposed on dispose; ignore + self-write filters present; no event when disabled; no synchronous heavy work in the save handler.

**Dependencies.** Feeds P1-2/P1-3. **[cross-repo]** none.

### P1-2 — Changed-chunk computation (changed files + line ranges)

**Files (new):** `common/ribixChangedChunk.ts` (pure helpers); consumed by `ribixChangeWatcherService`. **Reuses:** `IVoidSCMService.gitSampledDiffs`/`gitStat` (`voidSCMTypes.ts:15-21`) for commit-scoped diffs; for save-scoped ranges, diff the saved buffer against its on-disk/last-checkpoint baseline.

**What to implement.** Given a set of changed URIs, produce per-file changed line ranges. For the `commit` trigger, parse `gitSampledDiffs` hunks into ranges. For the `save` trigger (no git diff yet), compute ranges from the editor model's dirty/changed regions (or a cheap line-level diff against the last saved snapshot). The result is the `files[].ranges` of `ChangedChunk`. Keep this pure and unit-testable; no service state.

> **Gap to flag for backend coordination:** `IVoidSCMService` exposes `gitStat`, `gitSampledDiffs`, `gitBranch`, `gitLog` but **no per-file ranged `git diff`**. If commit-scoped precise ranges are required, add a `gitDiffFile(path, file): Promise<string>` method to `IVoidSCMService` (`common/voidSCMTypes.ts`) and its `electron-main` channel implementation — a small, isolated addition that does not touch upstream files.

**Rationale.** The QA mission must be *scoped* to what changed, not the whole repo — that is what makes autonomous runs cheap enough to run on every save.

**Acceptance criteria.** A two-hunk diff yields two ranges for that file; a save that changed lines 10–14 yields `[[10,14]]`; an empty/whitespace-only change yields no ranges (and thus no mission).

**Test approach.** Pure-function Mocha tests with fixture diff strings and fixture before/after buffers.

**Code-review checklist.** Pure functions, no I/O; handles multi-hunk, file-add, file-delete; whitespace-only changes filtered.

**Dependencies.** Consumed by P1-3. May require the `gitDiffFile` channel addition above.

### P1-3 — Auto-launch a scoped QA mission (Tester-led) on a changed chunk

**Files:** `browser/ribixChangeWatcherService.ts` (wire the event to mission creation); `browser/ribixMissionService.ts` (add `createScopedQAMission`); reuses `ribixPlanningService`/`ribixOrchestrationService`.

**What to implement.** On `onDidDetectChange`, build a `MissionContext` from the chunk (attachedFiles = changed files, attachedSelections = changed ranges with content, notes = "Auto QA on changed chunk: <trigger>"), then create a mission whose plan is **pre-scoped** — rather than the full planner DAG, default to a minimal QA graph: `planner (scope analysis on the chunk) → tester (write/verify failing test for the change) → debugger (if tester reports failure)`, with reviewer optional. Expose `createScopedQAMission(chunk: ChangedChunk): Promise<Mission>` on `IRibixMissionService` that creates the mission, sets context, and either auto-approves the canned QA plan (in `auto` mode) or surfaces it for approval (in `ask` mode — see P1-4). Concurrency: respect `maxConcurrentMissions` (`ribixMissionService.ts:54,98-100`); if at cap, queue or skip with a notification rather than throwing.

**Rationale.** This is the IDENTIFY→DOCUMENT→SOLVE loop firing automatically on the smallest meaningful surface.

**Acceptance criteria.** Saving a file with a real change auto-creates a mission scoped to that file, runs the Tester agent (which, post-P0, actually iterates), and reports a finding or a clean result — with no human click in `auto` mode. At mission cap, a new change does not throw; it queues or notifies.

**Test approach.** Integration-style test wiring stub watcher → real mission/planning/orchestration with stub LLM + tools; assert mission scoped to the chunk and Tester spawned.

**Code-review checklist.** Context actually populated from the chunk (not empty like `submitForPlanning:145-150`); cap respected without throwing; auto vs ask honored; no self-trigger from the agent's own writes.

**Dependencies.** **Hard depends on P0-1/P0-2/P0-3** and P1-1/P1-2. **[cross-repo]** findings emitted should match the shared **finding** schema in `ribix` backend so they sync/report consistently.

### P1-4 — Auto/manual toggle, settings, and non-blocking notification UX

**Files:** `common/voidSettingsService.ts` (+`voidSettingsTypes.ts`) for new keys; `browser/voidSettingsPane.ts` for the Ribix settings section; React `react/src/command-center-tsx/` for an in-Command-Center toggle + activity surfacing; use `INotificationService` for non-blocking toasts.

**What to implement.** New settings: `ribix.autoTriggerMode: 'off' | 'ask' | 'auto'` (default `ask`), `ribix.autoTriggerDebounceMs` (default 2500), `ribix.autoTriggerOn: ('save'|'commit')[]` (default `['commit']` — commits are higher-signal than every save). A toolbar toggle in the Command Center header flips `off`/`ask`/`auto` and calls `ribixChangeWatcherService.setEnabled`. When an auto mission starts, show a **non-blocking** notification (`INotificationService.notify({ severity: Info, ... })`) with "View" (focus Command Center) and "Dismiss" — never a modal, never stealing focus, since the engineer is mid-edit. When a finding is produced, escalate the notification to a clickable summary.

**Rationale.** Autonomy must be *controllable* and *unobtrusive*. An IDE that interrupts the typing flow with modals will be turned off immediately.

**Acceptance criteria.** Toggle persists across restart; `off` fully silences the watcher; `ask` surfaces the plan in-panel before running; `auto` runs and shows a dismissible toast; no auto-trigger UX ever opens a modal or steals editor focus.

**Test approach.** Settings round-trip unit test; React component test for the toggle calling `setEnabled`; manual smoke for notification non-blocking behavior (note: notification UX is hard to unit-test; cover via the integration build checklist).

**Code-review checklist.** Defaults conservative (`ask`, commit-only); notifications use `Info` severity and `[{label, run}]` actions, never `prompt` modals; toggle state read from settings, not duplicated; focus not stolen.

**Dependencies.** Pairs with P1-1/P1-3.

---

## Phase P2 — Harden

**Goal:** Make the now-functional loop trustworthy: real semver, robust rollback, concurrency correctness, auth races, and visible errors. Depends on P0; benefits from P1.

### P2-1 — Real `determineSemverBump`

**Files:** `browser/ribixMissionService.ts` (`determineSemverBump` `:292-299`); reuse `IVoidSCMService.gitLog`/`gitSampledDiffs`.

**What to implement.** Replace the hardcoded `return 'patch'`. Strategy: (a) parse conventional-commit prefixes from `gitLog` (`voidSCMTypes.ts:33`) over the mission branch — `feat:` → minor, `fix:`/`chore:` → patch, `BREAKING CHANGE`/`!` → major; (b) fall back to diff heuristics from `gitSampledDiffs` (public API signature deletions/renames → major; new exported files/functions → minor; else patch). Take the max bump found.

**Acceptance criteria.** A branch with a `feat:` commit yields `minor`; a `BREAKING CHANGE:` footer yields `major`; pure bug-fix commits yield `patch`.

**Test approach.** Unit test with fixture `gitLog`/diff strings.

**Code-review checklist.** Conventional-commit parsing case-insensitive; `!`-bang and footer both detected; safe default `patch` when nothing matches.

**Dependencies.** Closes G-SEMVER. **[cross-repo]** if PR/release semver is also computed backend-side, align rules with `ribix`.

### P2-2 — Checkpoint/rollback edge cases

**Files:** `browser/ribixCheckpointService.ts` (173); tests beside it.

**What to implement.** Cover and fix: rollback of a *created* file (no prior snapshot → delete on rollback), rollback when a file was deleted by an agent, ordering of `rollbackMission` (reverse chronological, already intended — verify), rollback when the file has unsaved editor edits, and rollback idempotency (rolling back twice is a no-op). Ensure checkpoints are scoped per mission so an aborted mission's rollback never touches another mission's files.

**Acceptance criteria.** Create→checkpoint→rollback deletes the created file; multi-file multi-agent `rollbackMission` restores all originals; double-rollback is safe; cross-mission isolation holds.

**Test approach.** Unit tests against a stub model/file service capturing snapshot/restore calls.

**Code-review checklist.** Created-file vs modified-file rollback distinguished; reverse order; mission-scoped; idempotent.

**Dependencies.** Independent; pairs with the abort path in orchestration (`:335-363`).

### P2-3 — File-lock contention tests + timeout/deadlock guard

**Files:** `common/ribixFileLockService.ts` (140); tests beside it.

**What to implement.** Verify queued acquisition (second waiter proceeds only after first release), add/confirm a lock timeout so a crashed agent cannot hold a lock forever, and guard against the agent loop (P0-1) acquiring the same lock twice in one turn (reentrancy or explicit avoidance). Ensure `release` is always called even when `callTool` throws (the P0-1 sketch already wraps in `finally`).

**Acceptance criteria.** Two concurrent `acquire` on the same path serialize correctly; a never-released lock auto-expires after the timeout; releasing an already-released lock is safe.

**Test approach.** Concurrency unit tests with deferred promises; fake timers for timeout.

**Code-review checklist.** No lost wakeups; timeout disposes timer; double-release safe; lock holder tracked for diagnostics.

**Dependencies.** Tightly coupled to P0-1's per-write locking.

### P2-4 — OAuth / token-refresh races

**Files:** `browser/ribixAuthService.ts` (395), `browser/ribixAuthActions.ts:43-66`; `electron-main/ribixAuthChannel.ts`; consumers `ribixApiClient.ts`, `ribixMemoryService.syncFromOrg/syncToOrg` (`:168-204`).

**What to implement.** Coalesce concurrent refreshes (single in-flight refresh promise shared by all callers), retry a 401 once after a forced refresh then surface a clean re-auth prompt, and ensure `getRequiredConfig` (used in `ribixMissionService.prepareRelease:272` and `ribixMemoryService:170,189`) does not throw uncaught when signed out — it should reject with a typed, catchable error that callers already `try/catch` (memory sync swallows it at `:181-184,200-203`; release should surface it). Verify PKCE state/verifier is single-use and the callback handler (`ribixAuthActions.ts:43-66`) rejects replayed codes.

**Acceptance criteria.** Ten concurrent API calls during an expired token trigger exactly one refresh; a hard 401 leads to one retry then a single re-auth prompt; signed-out memory sync stays silent; signed-out release shows a clear "sign in to create PR" error.

**Test approach.** Unit test with stub channel returning expiring tokens; assert single in-flight refresh and retry-once.

**Code-review checklist.** Shared refresh promise; bounded retry; typed auth errors; PKCE single-use; no token logged.

**Dependencies.** **[cross-repo]** token endpoint + refresh semantics owned by `ribix` backend `/api/v1/*`; confirm refresh-token rotation behavior.

### P2-5 — Error surfaces in the Command Center

**Files:** React `react/src/command-center-tsx/` (mission cards, activity feed, plan-review dialog); `browser/ribixOrchestrationService.ts` (`handleTaskFailure:335-363` already pauses + aborts — surface it).

**What to implement.** When a mission pauses on failure, the mission card must show *why* (failed task, agent error message from `AgentOutput.blocked`/`markAgentFailed`), offer Retry/Abort, and the activity feed must show the failing turn. Planning fallback (`ribixPlanningService:365-378` minimal safe plan) should be visibly labeled "fallback plan — LLM planning failed," not silently presented as a real plan. Auto-trigger failures (P1) surface via the non-blocking toast, not the console.

**Acceptance criteria.** A failed agent run shows a human-readable error and Retry/Abort in the card within the activity-feed latency budget; fallback plans are visibly labeled; no failure is console-only.

**Test approach.** React component tests rendering a failed mission state; assert error text + actions present.

**Code-review checklist.** Every catch path that currently `console.error`s (e.g. `ribixMissionService:153,201,238`; orchestration `:247,357`) also reaches a UI surface; no silent failures on the autonomous path.

**Dependencies.** Benefits from P0-3 (`AgentOutput.blocked`) and P1-4 (toasts).

---

## Phase P3 — Depth & polish

**Goal:** Round out the agent system, the UX-vision pass, sync conflict UX, loop performance, and fork maintainability.

### P3-1 — Richer agent behavior per type

**Files:** `common/prompt/ribix*Prompt.ts`; `browser/ribixAgentService.ts` (per-type budgets, tool allowlists).

**What to implement.** Give each agent type a tailored tool allowlist (e.g., Reviewer is read-only — no `WRITE_TOOLS`; Tester may run tests; Coder may write) and per-type loop budgets (`budgetForType` from P0-1). Tighten prompts now that tool results actually feed back (instruct the model to read before writing, to run tests and react to output).

**Acceptance criteria.** A Reviewer agent cannot write files (write tools rejected with a tool-result explaining the restriction); per-type budgets observed.

**Test approach.** Unit test the allowlist gate in `runOneTool`.

**Code-review checklist.** Allowlist enforced in code, not just prompt; budgets centralized.

**Dependencies.** Builds on P0-1.

### P3-2 — Visual / UX-vision agent surfacing

**Files:** `browser/ribixDiffAnnotationWidget.ts` (378); React mission detail; possibly a new `ui_vision` finding category in the shared schema.

**What to implement.** Surface the product's "UI/UX vision" output: when a change touches UI, the QA mission should produce UX-vision notes/findings (rendered region screenshots via the Playwright browser tools over `ribixBrowserChannel`, with annotated suggestions) and display them in the mission detail and as diff annotations. This is the "+ UI/UX vision" half of the core loop made visible in the IDE.

**Acceptance criteria.** A UI-touching change yields a UX-vision section in mission detail with at least a textual critique (screenshots when browser tools available).

**Test approach.** Integration smoke with the Playwright channel stubbed.

**Code-review checklist.** Browser-tool failures degrade gracefully to text-only; no blocking on screenshot capture.

**Dependencies.** **[cross-repo]** UX-vision findings should fit the shared finding schema (`ribix`).

### P3-3 — Memory org-sync conflict UX

**Files:** `browser/ribixMemoryService.ts` (`mergeMemoryEntries`/`resolveConflict` `:206-245`); Memory tab React.

**What to implement.** The current resolution is silent "engineer wins / newer agent wins." Surface conflicts the engineer should know about (e.g., server entry contradicts a local engineer note) in the Memory tab with accept-mine/accept-theirs controls, and make sync status (last pulled/pushed, pending) visible.

**Acceptance criteria.** A contradicting server entry produces a visible conflict the engineer can resolve; sync status shown.

**Test approach.** Unit test `resolveConflict` conflict detection; component test for the conflict UI.

**Dependencies.** **[cross-repo]** `/api/v1/*` memory endpoints + entry schema (`ribix`).

### P3-4 — Performance of the agent loop

**Files:** `browser/ribixAgentService.ts`; `common/ribixTaskQueueService.ts` (115).

**What to implement.** Now that agents make multiple LLM turns, watch token/latency cost: cap message-history growth (truncate or summarize old tool results), parallelize independent read-only tool calls within a turn, and confirm `ribixTaskQueueService` concurrency limits keep total in-flight LLM calls bounded. Add lightweight timing logs behind a debug flag.

**Acceptance criteria.** A 12-turn coder run stays under a defined token ceiling; queue caps concurrent agent LLM calls to the configured max.

**Test approach.** Instrumented unit test counting LLM calls and message sizes across a scripted multi-turn run.

**Dependencies.** Builds on P0-1.

### P3-5 — Fork upstream-rebase runbook

**Files (docs):** `absolute-docs/` runbook; no source changes.

**What to implement.** A concrete procedure for rebasing onto a newer Void/Code-OSS: pin the upstream tag, rebase, expect conflicts essentially only at the registration seams (`void.contribution.ts`, `app.ts` channel registration, settings pane), re-run `npm run buildreact` + gulp, and a regression checklist (mission run, auto-trigger, OAuth, autocomplete/Cmd+K still work). Document the Node pin and the ~8–10 min build expectation so the cost is planned, not discovered.

**Acceptance criteria.** A new engineer can follow the runbook to land an upstream bump without guessing where conflicts will be.

**Dependencies.** None; ongoing maintenance discipline.

---

## Appendix A — Gap-to-phase traceability

| Gap | Description | Addressed by |
|---|---|---|
| G-LOOP | Agents one-shot; tool results not fed back (`ribixAgentService.ts:146-197,315-407`) | **P0-1** |
| G-PERSIST | Mission store corrupts; append-not-update (`ribixMissionService.ts:69-94` vs `ribixAgentService.ts:409-428`) | **P0-2** |
| G-HANDOFF | Cosmetic inter-agent context (`ribixOrchestrationService.ts:392-397`) | **P0-3** |
| G-POLL | `setInterval` completion polling (`ribixOrchestrationService.ts:285-305`) | **P0-4** |
| G-AUTOTRIGGER | No changed-chunk / on-change trigger anywhere | **P1-1/P1-2/P1-3/P1-4** |
| G-CONTEXT | Empty `MissionContext` to planner (`ribixMissionService.ts:145-150`) | **P1-3** |
| G-SEMVER | Hardcoded `patch` (`ribixMissionService.ts:292-299`) | **P2-1** |

## Appendix B — Cross-repo contract touchpoints

| Item | Shared contract | Owner repo |
|---|---|---|
| P0-2 `agent_run` persisted shape | agent-run schema | `ribix` (backend) |
| P1-3 findings | finding schema | `ribix` |
| P2-4 token refresh / 401 | `/api/v1/*` auth | `ribix` |
| P3-2 UX-vision findings | finding schema (ui_vision category) | `ribix` |
| P3-3 memory sync | `/api/v1/*` memory endpoints + entry schema | `ribix` |
| OAuth/apiClient patterns | mirrored, keep parity | `ribix-vs-extension` |

---

Confidential — Ribix Inc.   |   Version 2.0   |   2026-06-12
