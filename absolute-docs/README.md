# Ribix IDE — Absolute Docs

Ribix IDE is the full-fork IDE surface of Ribix: an AI agent that uses software like a real user, finds everything blocking it from being shippable, and tells founders and solo developers exactly what to fix.

---

## What This Repo Is in the Ribix Vision

The Ribix product is delivered across five surfaces (backend, web, CLI, VS Code extension, IDE). This repo is the IDE surface. Its job is different from the extension: instead of surfacing findings inside an editor the developer already has open, the IDE provides the complete autonomous multi-agent loop as the primary environment.

The loop is: **Planner → Coder → Tester → Reviewer → Release**. The IDE runs that loop directly on the codebase, triggered by developer activity, without requiring a round-trip to a web dashboard or a manual CLI invocation.

What the IDE uniquely provides that the VS Code extension does not:

- **Mission-based workflows.** Describe an outcome in plain language. Ribix plans it into a dependency-ordered task graph, executes each agent type in sequence, and presents the results for approval. The engineer describes what should be true; Ribix works out how to verify and achieve it.
- **Auto-trigger on save.** When a file is saved or a commit lands, the IDE detects what changed, scopes a QA mission to that surface, and runs the Tester-led agent loop without being asked. This is the behavior that makes ribix-ide an autonomous QA engineer rather than a manual panel.
- **Inline findings.** Code lens annotations show what agents wrote, why, and what they found. Each annotation carries a link to the agent's decision log for that change.
- **Checkpoint and rollback.** Every file write is snapshotted before it happens. Agents run in parallel with per-file locks. Engineers can reject individual agent edits or roll back an entire mission to the pre-execution state.
- **Memory layer.** Team context, codebase knowledge, and decision history are persisted across sessions. The IDE is the surface where this memory is most directly connected to the work — the agent that runs on your save has access to what the agent that ran last Tuesday learned.

The IDE is where the "acts like a real user on your own codebase" experience lives most deeply, because it runs inside the tool where the developer is actually making changes.

---

## Honest Status (as of 2026-06-13)

**Alpha scaffold. Core autonomous loop not yet functional.**

The scaffold is real: ~49 Ribix files / ~6k LOC, cleanly namespaced under `src/vs/workbench/contrib/void/ribix*`. The Command Center UI, mission lifecycle state machine, planning service, orchestration, OAuth, API client, file locking, checkpoints, and diff annotation widget are all wired and demoable. A mission can be created, planned, and agents will spawn and make real LLM calls.

However, the product's defining behaviors do not yet work:

- **Agents are one-shot, not agentic.** Each agent makes one LLM call, executes any tool calls it names, and stops. Tool results are never fed back to the model. The "find bug → write failing test → verify fix → re-test" loop exists in the prompt text, not in the runtime.
- **No auto-trigger.** Nothing watches file saves or git commits and launches a scoped QA mission. Every mission is started manually.
- **Mission persistence corrupts after any agent run.** Missions and agent run summaries share the same `mission_summary` storage key with different shapes. After an agent runs, reloading the IDE produces a malformed mission list.
- **Context attachment UI is broken.** The mission panel always submits an empty `attachedFiles`/`selections`/`notes` to the planner. The context input UI exists; it does not wire through.

The P0/P1 phases in `Engineering_Plan.md` are the remediation roadmap for these gaps. P0-1 (multi-turn agent loop) and P0-2 (persistence fix) are the blockers for everything else.

**Build pipeline:** The CI release workflow (`build-release.yml`) was recently fixed to use the correct gulp tasks. No distributed binaries exist yet.

**E2E tests:** All 119 scenarios across all phases remain Pending. No testable binary has been produced.

---

## IDE vs Extension: The Open Strategic Question

ribix-ide is a VS Code fork — specifically a fork of Void, which is itself a fork of Code-OSS 1.99.3. The maintenance cost is real: gulp build, Electron, pinned Node version, ~8–10 minute cold builds, and periodic upstream rebases. Every Code-OSS release that Void or ribix-ide wants to track requires a rebase against ~6000 upstream files.

The mitigating discipline is that all Ribix code lives under `contrib/void/ribix*` and the only intentional upstream-file edits are at registration seams (`void.contribution.ts`, `app.ts` channel registration, the settings pane). This keeps rebase conflicts bounded and predictable.

The strategic question — whether `ribix-vscode` (the extension) should eventually replace the fork, with the IDE serving as an internal development surface rather than a distributed product — is open. The fork delivers capabilities the extension cannot easily replicate (full Electron process model, custom build, main-process IPC for the Playwright browser channel). The extension trades those for zero maintenance cost and instant distribution via the VS Code Marketplace. This decision has not been made. Both surfaces are in active development.

---

## Contents

| File | Purpose |
|---|---|
| `Engineering_Plan.md` | Phase-by-phase implementation plan with gap analysis. Source of truth for all reconstruction work. |
| `Release_Notes.md` | Alpha release notes. See the Corrections section at the bottom for factual fixes. |
| `E2E_Test_Results.md` | E2E test status. All scenarios Pending. |
| `Performance_Report.md` | Performance targets and profiling methodology. No measurements exist yet. |
| `E2E_QA_Checklist.md` | Full manual QA checklist for each phase. |
| `Build_Guide.md` | Build, packaging, and distribution documentation. |
| `Ribix_IDE_Overview.txt` | Product overview and feature reference. |

---

## Current Source of Truth for Code

- [`../README.md`](../README.md)
- [`../VOID_CODEBASE_GUIDE.md`](../VOID_CODEBASE_GUIDE.md)
- [`../src/vs/workbench/contrib/void/`](../src/vs/workbench/contrib/void/)

---

Confidential — Ribix Inc.
