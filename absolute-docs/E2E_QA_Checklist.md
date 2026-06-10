# Ribix IDE — End-to-End Manual QA Checklist

**Goal:** Walk through every user-facing flow before marking each phase ready.

---

## Pre-conditions

Before starting, confirm all of the following:

- [ ] Fresh Ribix IDE build (`yarn gulp vscode-darwin-x64` or platform equivalent)
- [ ] OR: running from source (`./scripts/code.sh`)
- [ ] Clean workspace: a real GitHub repo with at least 10 source files
- [ ] Optional (for Phase 10+ checks): Ribix backend running at configured API URL

---

## 1. Identity & Branding (Phase 1)

- [ ] Title bar shows "Ribix IDE — [workspace name]"
- [ ] Activity Bar background: `#01311F` (dark green)
- [ ] Active Activity Bar item indicator: `#C6AA58` (gold)
- [ ] About dialog: product name "Ribix IDE", no "Void" visible
- [ ] Welcome / onboarding screen: mentions "Ribix IDE", no "Void" text
- [ ] Window dock icon (macOS): Ribix logo, not VS Code / Void icon
- [ ] Command Palette search "Ribix" → Ribix commands appear
- [ ] Command Palette search "Void" → no Void-branded commands visible to engineer

---

## 2. Command Center Panel (Phase 8)

### Panel opens

- [ ] IDE opens → Command Center panel is focused (not file explorer)
- [ ] Activity Bar: Ribix icon present, clicking it opens Command Center
- [ ] Command Center shows three tabs: Missions | Agents | Memory
- [ ] Missions tab is active by default

### Outcome input

- [ ] Outcome input box visible at top of Missions tab
- [ ] Placeholder text: "Describe what you want to achieve..."
- [ ] Input box has gold border (`#C6AA58`)
- [ ] "Plan This" button visible below input
- [ ] Clicking "Plan This" with empty input → no action (button disabled or validation shown)
- [ ] Typing an outcome → "Plan This" button becomes enabled

### Empty state

- [ ] No missions: Missions tab shows a helpful empty state (not a blank white box)
- [ ] Agents tab: shows "No active agents" when idle
- [ ] Memory tab: shows empty state sections for each memory type

---

## 3. Create Mission — Planning (Phase 5 + 8)

### Submit outcome

- [ ] Type outcome: "Add input validation to the login form. All tests must still pass."
- [ ] Click "Plan This"
- [ ] Mission card appears in list with status badge: "Planning"
- [ ] Mission card shows spinner or "Planner agent working..." text
- [ ] Planning completes within 30 seconds

### Plan review

- [ ] After planning: mission status changes to "Plan Ready"
- [ ] Plan review dialog / inline expansion appears in mission card
- [ ] Task tree renders: shows at minimum a Planner task + Coder task + Tester task
- [ ] Each task shows: agent type icon, description, dependency lines, risk badge
- [ ] "Approve Plan" button visible (gold, dark background)
- [ ] "Modify" option: clicking a task allows editing description or removing it
- [ ] "Abort" button: cancels the mission (mission disappears from list)
- [ ] At least one task has `dependsOn` correctly — tester task depends on coder task

---

## 4. Execute Mission (Phase 6 + 8)

### Approve and execute

- [ ] Click "Approve Plan" → mission status changes to "Executing"
- [ ] Agents tab shows new agent cards appearing
- [ ] Each agent card shows: type icon, name (e.g., "Coder-1"), status "Executing", current action text
- [ ] Current action text updates in real time (within 2 seconds of agent state change)
- [ ] Planner task runs first (before any Coder agent starts)

### Agent activity feed

- [ ] Activity feed (below plan tree or in mission detail) shows live entries
- [ ] Each entry: timestamp, agent name, action description
- [ ] Entries appear within 500ms of agent action
- [ ] Feed scrolls automatically as new entries appear

### File writes

- [ ] Open a file that the Coder agent is writing
- [ ] DiffZone appears in editor showing agent changes (gold left border)
- [ ] Code lens above changed block: "Written by Coder-1 · [View reasoning]"
- [ ] Click "[View reasoning]" → panel opens with agent's decision log for that edit
- [ ] Decision log shows: which files agent read, what it decided, why

### Completion

- [ ] All tasks complete → mission status: "Reviewing"
- [ ] Mission card shows: diff summary (N files changed), test report (pass/fail count), Reviewer agent findings
- [ ] "Approve & Commit" button appears (gold)
- [ ] "Redirect Agent" button appears for any finding from the Reviewer

---

## 5. Abort Mission (Phase 4 + 7)

- [ ] Create a mission and approve the plan
- [ ] While agents are executing: click "Abort" on the mission
- [ ] All agents stop within 3 seconds
- [ ] All files written by agents are rolled back (verify: file matches pre-mission content)
- [ ] Mission card shows status: "Aborted"
- [ ] Agents tab: all agents for the mission show status "Aborted"

---

## 6. Checkpoint Rollback (Phase 7 + 9)

- [ ] Complete any mission that writes at least one file
- [ ] Open the written file in the editor
- [ ] Code lens visible: "Written by [Agent]"
- [ ] Click "Reject this block" on the code lens
- [ ] Confirmation dialog appears: "Restore file to pre-agent state?"
- [ ] Confirm → file content restored to pre-agent version
- [ ] Code lens disappears from that block
- [ ] Other files written by the mission remain unchanged

---

## 7. Memory Persistence (Phase 2)

- [ ] Complete at least one mission (any outcome)
- [ ] Open Memory tab → entries visible under "Mission History"
- [ ] Pattern entries visible under "Patterns" (if enough code was analyzed)
- [ ] Restart Ribix IDE
- [ ] Reopen workspace
- [ ] Memory tab → entries from the previous session are still present
- [ ] Mission history entry: shows correct outcome text and result summary

### Engineer memory editing

- [ ] Click any memory entry → "Edit" option appears
- [ ] Edit entry content → save → Memory tab reflects new content
- [ ] Delete a memory entry → it disappears from the list
- [ ] Add a new engineer note via "Add note" → appears with source badge "engineer"
- [ ] Restart IDE → engineer notes still present

---

## 8. File Lock Coordination (Phase 3 + 6)

- [ ] Create a mission with at least 2 Coder agents assigned to overlapping files
  (Use an outcome that involves multiple changes to the same service file)
- [ ] In the Agents tab: confirm second agent's status shows "Blocked (waiting for file lock)"
- [ ] First agent completes → second agent's status changes to "Executing"
- [ ] Both agents' changes are present in the final file (no collision, no overwrite)

---

## 9. Quick Edit — Void Features Preserved (Phase 12)

### Autocomplete

- [ ] Open any source file
- [ ] Start typing a function body
- [ ] Inline completion appears within 2 seconds (ghost text)
- [ ] Tab to accept completion
- [ ] Escape to dismiss

### Cmd+K

- [ ] Select a range of code (3–5 lines)
- [ ] Press Cmd+K (macOS) / Ctrl+K (Windows/Linux)
- [ ] Quick Edit input appears above selection
- [ ] Type "add null check" → submit
- [ ] Agent rewrites selection, DiffZone appears
- [ ] Approve / Reject controls work

### Quick Edit chat

- [ ] Find the "Quick Edit" tab in the secondary sidebar (or panel)
- [ ] Type a question: "What does the fetchUser function return?"
- [ ] LLM response appears within 10 seconds
- [ ] Response is accurate (not a placeholder or error)
- [ ] No "Void" branding in the Quick Edit tab header

---

## 10. Authentication (Phase 10)

### Sign in

- [ ] Command Palette → "Ribix: Sign In"
- [ ] Browser opens to Ribix OAuth page
- [ ] Complete login
- [ ] Command Center Settings tab shows: "Connected — [workspace name]"
- [ ] Memory tab: org memory entries visible (if any exist for this repo)

### Sign out

- [ ] Command Palette → "Ribix: Sign Out"
- [ ] Settings tab shows: "Not connected"
- [ ] Org memory entries from previous session remain visible (local copy preserved)
- [ ] New memory entries no longer sync to org (local only)

### Session persistence

- [ ] Sign in → restart IDE
- [ ] Reopen workspace → Settings tab shows "Connected" without re-authentication

---

## 11. PR Creation (Phase 11)

- [ ] Complete a mission with at least one file change
- [ ] Mission card in "Reviewing" state: confirm Approve button visible
- [ ] Click Approve & Commit → mission transitions to "Complete"
- [ ] "Prepare Release" button appears
- [ ] Click "Prepare Release" → Release agent spawns
- [ ] Release agent creates a PR (requires authenticated Ribix backend + GitHub App)
- [ ] PR URL appears in mission card: clickable link
- [ ] Open PR URL → confirms: correct branch, correct title, mission summary in body, test report attached

---

## 12. Performance Checks

- [ ] Command Center panel opens: under 200ms (no spinner visible)
- [ ] Outcome submission → first planning response: under 30 seconds
- [ ] Agent activity feed update latency: entries appear within 500ms of agent action
- [ ] Mission rollback (10 files): completes within 3 seconds
- [ ] Memory search with "fetch" (assuming 100+ entries): results appear within 100ms
- [ ] IDE startup with 1 previous mission in memory: no slower than baseline

---

## 13. Error States

- [ ] Submit outcome while offline → error message shown in mission card (not a crash)
- [ ] LLM API rate limit hit mid-mission → agent shows "Blocked" with retry countdown
- [ ] Agent fails (LLM error) → mission pauses, error shown, "Retry" and "Skip task" options visible
- [ ] File lock timeout (agent hangs >30s): lock auto-released, next agent proceeds
- [ ] Corrupt memory entry: IDE still opens, bad entry shown as "[Unreadable — click to delete]"

---

## Pre-Alpha Release Sign-Off

All of the following must be checked before marking Ribix IDE as alpha-ready:

- [ ] All sections above pass with zero blockers
- [ ] Zero uncaught errors in the VS Code extension host console during normal usage
- [ ] `npm run buildreact` exits 0
- [ ] Application builds and launches on macOS (Apple Silicon + Intel) and Windows
- [ ] Title bar, dock, and About dialog all show Ribix IDE branding
- [ ] Command Center is the first thing engineers see on fresh workspace open
- [ ] At least one real mission (not a mock) completes end-to-end in a live codebase

---

Confidential — Ribix Inc.   |   Version 1.0   |   2026-06-09
