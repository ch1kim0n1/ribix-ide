# ADR: Fork vs Extension Model for Ribix IDE

- **Status:** Proposed
- **Date:** 2025
- **Decision Maker:** Ribix IDE core team
- **Supersedes:** None
- **Related:** `README.md`, `product.json`, `CODEBASE_GUIDE.md`, `IMPLEMENTATION_STATUS.md`, `docs/production-secrets.md`

---

## Context

Ribix IDE is a **QA-first, agent-first IDE** whose headline features — autonomous Playwright QA agents, multi-agent orchestration, inline edit-code diffs, a Command Center panel, persistent codebase memory, and a browser tool channel — cannot be delivered by stock VS Code. To achieve this, the project was built as a **fork of VS Code** (originally derived from the Void fork lineage, as evidenced by `marketplaceCompat.ts` which references "the Void fork's extension host").

### Evidence from the codebase

The fork model is unambiguous and confirmed by multiple signals:

1. **Full VS Code source tree in-repo.** `src/vs/` contains the complete upstream layout — `base/`, `code/`, `editor/`, `platform/`, `server/`, `workbench/` — including `monaco.d.ts` (267 KB) and `loader.js`. This is the VS Code source, not a consumed dependency.

2. **Branded `product.json`.** `product.json` rebrands the product: `nameLong: "Ribix IDE"`, `applicationName: "ribix-ide"`, `darwinBundleIdentifier: "dev.ribix.ide"`, custom Windows AppIDs, a `ribix://` URL protocol, and `ribixVersion: "1.0.0"`. A fork rebrands at the product layer; an extension does not.

3. **Bundled built-in extensions.** `extensions/` ships the full set of upstream language extensions (bat, cpp, css, git, json, python, …) — these only ship inside a fork, not as part of an extension pack.

4. **Custom workbench contribution.** All Ribix logic lives in `src/vs/workbench/contrib/ribix/` — a **first-party workbench contribution** registered via `ribix.contribution.ts`, which imports ~60 sibling modules (agent, orchestration, planning, mission, memory, SCM, checkpoint, autocomplete, edit-code, findings, CI integration services). This is fork-level code: it imports internal VS Code services (`IProductService`, `IWorkbenchEnvironmentService`, platform paths like `../../../../base/common/platform.js`) that are **not exposed through the public extension API**.

5. **Electron-main channel.** `src/vs/workbench/contrib/ribix/electron-main/` contains `ribixBrowserChannel.ts` (Playwright headless Chromium), `mcpChannel.ts`, `sendLLMMessageChannel.ts`, `ribixSCMMainService.ts`, and `ribixUpdateMainService.ts`. These run in the Electron main process — a surface the extension host cannot reach.

6. **Marketplace compatibility is a *problem being solved*, not a given.** `marketplaceCompat.ts` and `extensionCompatibility.ts` exist precisely because a fork's extension host can drift from the official Marketplace's `engines.vscode` contract. The code proxies Marketplace queries through a Ribix backend (`/web-ide/marketplace/query`) to dodge CORS, and maintains a hand-curated compatibility database of "known-good" extensions. This is a fork-specific maintenance cost.

7. **A parallel web IDE exists.** `web-ide/` is a standalone Vite + React + Monaco + Yjs app (`@monaco-editor/react`, `y-websocket`, `zustand`) with its own `server/websocket-server.ts`, Dockerfiles, and k8s manifests. It is **not** the VS Code web build (`vscode-web`); it is an independent reimplementation. This means the "web IDE" surface is already diverging from the fork's own web build path.

8. **No extension manifest.** The root `package.json` has no `engines.vscode` field and no `extensionKind`/`main`/`browser` activation entry. There is no `extension.ts` activation point. The product is not packaged as an extension today.

### The decision question

The team must decide whether to:

- **(A)** continue shipping Ribix as a VS Code **fork** (current approach),
- **(B)** pivot to shipping Ribix as a **VS Code extension pack** on the official Marketplace, or
- **(C)** adopt a **hybrid** — fork only the workbench shell, but migrate feature surface into loadable extensions.

This choice governs maintenance cost, distribution reach, web-IDE strategy, and how long the product can stay viable as upstream VS Code evolves.

---

## Decision Options

### Option A — Continue as a VS Code fork (status quo)

Keep the full `src/vs/` tree, the `ribix` workbench contribution, and the Electron-main channels. Ship a branded binary via one-click installer and GitHub Releases.

### Option B — Ship as a VS Code extension pack

Abandon the fork. Reimplement Ribix as one or more extensions published to the VS Code Marketplace, targeting stock VS Code (desktop) and `vscode.dev` / Codespaces (web). Users install Ribix into their existing editor.

### Option C — Hybrid: fork the workbench shell, ship features as extensions

Keep a minimal fork (shell branding, Electron-main channels for Playwright/LLM, any deep workbench hooks that have no API equivalent), but extract the bulk of `ribix.contribution.ts`'s services into a bundled extension (or a small set of extensions) that runs against both the Ribix shell *and* stock VS Code, gated by capability checks.

---

## Analysis

### Option A — Continue as a fork

| Dimension | Assessment |
|---|---|
| **Maintenance burden** | **High.** Every monthly VS Code release must be merged/rebased into the fork. The `ribix` contribution touches internal services (`IWorkbenchEnvironmentService`, platform/base paths) that change without semver guarantees. 223 files under `src/vs/workbench/contrib/ribix/` must be reconciled against upstream workbench refactors. The Marketplace compatibility shim (`marketplaceCompat.ts`, `extensionCompatibility.ts`) is a perpetual tax: every upstream extension-host ABI change requires re-curating the compatibility database. |
| **Feature access** | **Unrestricted.** Fork-level code can: register first-party workbench contributions, run in Electron main (Playwright Chromium via `ribixBrowserChannel.ts`), patch the editor core, add custom URL protocols (`ribix://`), and rebrand the product. The inline edit-code zone (`editCodeZoneManager.ts`) and the autocomplete service likely depend on editor internals beyond the proposed-API surface. |
| **Distribution** | Direct download via one-click installer (`install.sh`/`install.bat`) and GitHub Releases. No Marketplace listing. Users must trust a custom binary and a custom update channel (`ribixUpdateMainService.ts`). |
| **User acquisition friction** | **High.** Download + install + trust a new app bundle. No "install from Marketplace" one-click path. No presence where VS Code's ~40M users already search for tools. |
| **Multi-agent loop requirements** | **Fully met.** The agent loop (`ribixAgentService.ts`, `ribixOrchestrationService.ts`, `agentSandbox.ts`, `fileLockManager.ts`) runs in-process with full access to workbench services, the editor, the terminal tool service, and the Electron-main browser channel. No IPC boundary imposed by an extension host. |
| **Web IDE support** | The fork *can* build a web variant (`minify-vscode-reh-web` script exists in `package.json`), but the team has instead built a **separate** `web-ide/` React app. This duplication is itself a fork-cost symptom: maintaining web parity inside the fork was hard enough that a parallel stack was started. |
| **Marketplace compatibility** | **Ongoing problem.** The compatibility layer exists *because* the fork's extension host can drift from the Marketplace's `engines.vscode` contract. Each upstream release risks marking popular extensions incompatible, eroding user trust. |
| **Long-term sustainability** | **Risky.** Forks of VS Code have a well-documented attrition rate (VSCodium, Theia-on-fork, Onivim, the Void fork this project descends from). Without a large full-time team, the rebase treadmill tends to win. The 223-file custom surface is large relative to typical successful forks. |

### Option B — Pure extension pack

| Dimension | Assessment |
|---|---|
| **Maintenance burden** | **Low for the editor, high for feature reimplementation.** No upstream rebase. But the current feature set uses fork-only surfaces that must be rebuilt on the public API: the Electron-main Playwright channel, the inline edit-code zone, the in-process agent loop, and first-party workbench contribution registration. `editCodeService.ts` (86 KB) and `chatThreadService.ts` (62 KB) are large modules whose current implementations lean on internals. |
| **Feature access** | **Restricted to the public + proposed API.** Playwright in the browser is impossible from a web extension (no Node, no Chromium spawn). On desktop, an extension can spawn a child process for Playwright via a bundled Node helper, but loses the tight Electron-main integration. The inline edit-code zone may be approximable via the inline-edit / inline-completions proposed APIs, but parity is not guaranteed. First-party sidebar panels are achievable via `webviewView` / `viewsWelcome`. |
| **Distribution** | **Best.** VS Code Marketplace + Open VSX. One-click install for ~40M VS Code users and all Cursor/Windsurf/VSCodium users on Open VSX. Automatic updates handled by the host. |
| **User acquisition friction** | **Lowest.** "Install the Ribix extension" is the canonical low-friction path. No new binary, no trust prompt for a custom app. |
| **Multi-agent loop requirements** | **Partially met.** The agent loop can run in the extension host, but every workbench/terminal/editor interaction goes through the API boundary (commands, tasks, terminals, `workspace.fs`, debug API). File locking and parallel agents are achievable but with more IPC overhead and less direct control. The Electron-main browser channel must become a spawned child process or a language-server-style companion. |
| **Web IDE support** | **Constrained.** Web extensions run in a worker with no Node and no process spawning — Playwright is unavailable. The QA-agent headline feature would be desktop-only or would require a remote backend that runs Playwright on behalf of the web session (which `marketplaceCompat.ts` already foreshadows with its `/web-ide` backend proxy). |
| **Marketplace compatibility** | **N/A — you *are* the Marketplace citizen.** No compatibility shim needed; you declare `engines.vscode` and inherit the host's compatibility guarantees. |
| **Long-term sustainability** | **High for distribution, uncertain for feature parity.** The product becomes "Ribix, the agent/QA extension" rather than "Ribix, the IDE." If the headline features (Playwright QA, inline edit-code, Command Center) can be expressed on the public API with acceptable fidelity, this is the most sustainable path. If they cannot, the product loses its differentiator. |

### Option C — Hybrid (fork the shell, ship features as extensions)

| Dimension | Assessment |
|---|---|
| **Maintenance burden** | **Medium, but bounded.** The fork shrinks to a thin shell: branding (`product.json`), the Electron-main channels (`ribixBrowserChannel.ts`, `mcpChannel.ts`, `sendLLMMessageChannel.ts`), and any workbench hooks with no API equivalent. The bulk of the 223 files — agent, orchestration, planning, mission, memory, settings, findings, CI — move into a bundled extension that imports only the public API. Rebase surface drops from "whole workbench + 223 custom files" to "shell + a handful of patches," which is far more tractable. |
| **Feature access** | **Best of both.** Fork-only capabilities (Playwright in Electron main, deep editor hooks, custom URL protocol) stay in the shell. Everything expressible on the API moves to the extension, where it also runs against stock VS Code (capability-gated). |
| **Distribution** | **Dual.** The Ribix shell ships as a branded binary (for users who want the full Electron-main experience and Playwright QA). The Ribix extension ships on the Marketplace (for users who want the agent/command-center experience in their existing VS Code). The extension detects whether it is running inside the Ribix shell and unlocks fork-only features; otherwise it degrades gracefully. |
| **User acquisition friction** | **Tiered.** Low friction via the Marketplace extension (acquisition funnel); higher friction via the shell binary (power users who need Playwright/Electron-main). This matches how the README already positions the product ("one-click install" binary *and* a `ribix-vs-extension` sibling surface). |
| **Multi-agent loop requirements** | **Fully met in the shell; mostly met in stock VS Code.** Inside the Ribix shell, the extension can call shell-proposed APIs for the browser channel and tight editor control. In stock VS Code, it falls back to spawned-process Playwright and API-bound interactions. |
| **Web IDE support** | **Cleanest story.** The fork shell can build the official `vscode-reh-web` web variant (the `minify-vscode-reh-web` script already exists), giving web parity *for free* instead of maintaining the separate `web-ide/` React app. The extension's web entry point runs in the web worker; Playwright QA is delegated to the Ribix backend (consistent with the existing `/web-ide` proxy pattern). The standalone `web-ide/` app can be retired or repurposed as a thin embedder. |
| **Marketplace compatibility** | **Solved on both sides.** The extension is a first-class Marketplace citizen. The shell's extension host stays close enough to upstream (because the fork is thin) that the compatibility shim shrinks to a thin wrapper rather than a 423-line compatibility database. |
| **Long-term sustainability** | **Strongest overall.** It concentrates fork-cost where it is unavoidable (Electron main, branding) and pushes everything else onto the stable API, where Microsoft bears the maintenance. It also creates a natural migration path: features can graduate from "shell-only" to "extension + stock VS Code" as the public API grows, shrinking the fork over time. |

---

## Decision

**Adopt Option C — the hybrid model.** Keep a minimal fork (the "Ribix shell") for branding, the Electron-main browser/LLM/MCP channels, and any workbench hooks that have no public-API equivalent. Migrate the feature bulk currently in `src/vs/workbench/contrib/ribix/` into a bundled extension (the "Ribix extension") that targets the public VS Code extension API and publishes to the Marketplace and Open VSX.

### Rationale (grounded in the codebase)

1. **The fork-only surface is smaller than it looks.** Of the 223 files under `ribix/`, the genuinely fork-dependent ones are concentrated in `electron-main/` (8 files: Playwright, MCP, LLM message, SCM, update, auth, metrics channels) and a handful of editor-internal modules (`editCodeZoneManager.ts`, `editCodeService.ts`, `autocompleteService.ts`, `ribixSelectionHelperWidget.ts`). The majority — `ribixAgentService.ts`, `ribixOrchestrationService.ts`, `ribixPlanningService.ts`, `ribixMissionService.ts`, `ribixMemoryService.ts`, `ribixSettingsService.ts`, `ciIntegration.ts`, `fixMemory.ts`, `missionReplay.ts`, etc. — are orchestration and domain logic that can run in an extension host against the public API.

2. **The web-ide duplication is already signaling the answer.** The team built a *separate* Vite/React/Monaco web app rather than ship the fork's own web build. That is evidence that maintaining web parity inside a thick fork was too expensive. A thin fork + extension lets the official `vscode-reh-web` build carry the web surface, retiring the parallel stack.

3. **Marketplace compatibility is a self-inflicted cost of the thick fork.** `marketplaceCompat.ts` (423 lines) and `extensionCompatibility.ts` (350 lines) exist only because the fork's extension host can drift from the Marketplace contract. Shipping the bulk as a real Marketplace extension eliminates this entire class of work, and a thin shell keeps the host close enough to upstream that the residual shim becomes trivial.

4. **Distribution reach is decisive for a product whose README explicitly competes with Cursor and Windsurf.** Those products win on install base. A Marketplace-listed extension puts Ribix in front of VS Code's existing user base with one-click install, while the shell binary serves users who need the full Playwright/Electron-main QA loop. The hybrid captures both audiences.

5. **The multi-agent loop does not fundamentally require fork-level access.** The loop needs: file read/write (`workspace.fs`), terminal (`window.createTerminal` / tasks), editor edits (`workspace.applyEdit`), LLM calls (extension can call out to providers directly), and Playwright (spawned child process on desktop; backend service on web). None of these *require* being inside the workbench process. The Electron-main channel is an optimization (tighter Playwright integration), not a necessity — which is exactly what the hybrid model preserves.

### Migration shape (non-binding)

- **Phase 1 — Extract.** Move domain/orchestration services out of `ribix.contribution.ts` into an `extensions/ribix/` extension with `main` (desktop) and `browser` (web) entry points. Keep `electron-main/` channels in the shell; expose them to the extension via a proposed API or a command channel.
- **Phase 2 — Thin the fork.** Reduce `src/vs/workbench/contrib/ribix/` to the shell-only modules (branding, browser channel wiring, editor-zone hooks pending public API). Rebase upstream into the thinned shell.
- **Phase 3 — Publish.** List the Ribix extension on the VS Code Marketplace and Open VSX. Gate fork-only features behind a capability probe (`ExtensionMode`, product name check) so the same extension runs in stock VS Code and the Ribix shell.
- **Phase 4 — Consolidate web.** Evaluate retiring `web-ide/` in favor of the fork's `vscode-reh-web` build hosting the Ribix extension, keeping the Ribix backend (`/web-ide/marketplace/query`, Playwright-on-behalf-of-web) as the remote service layer.

---

## Consequences

### Positive

- **Rebase cost drops sharply.** The fork surface shrinks from the whole workbench + 223 custom files to a thin shell + a small set of patches, making monthly upstream merges tractable for a small team.
- **Marketplace reach.** A real Marketplace/Open VSX listing unlocks one-click install for VS Code, Cursor, Windsurf, and VSCodium users — the acquisition funnel the README's competitive table implies is needed.
- **Marketplace compatibility shim largely disappears.** The 773 lines of compatibility scaffolding (`marketplaceCompat.ts`, `extensionCompatibility.ts`) shrink to a thin wrapper or are deleted.
- **Web parity without a parallel stack.** The official `vscode-reh-web` build can host the extension, allowing `web-ide/` to be consolidated and reducing total surface area.
- **Graceful degradation.** Users on stock VS Code get a working agent/command-center experience; users on the Ribix shell get the full Playwright/Electron-main QA loop. One codebase, two tiers.
- **Gradual migration.** Features can move from shell-only to extension+stock-VS-Code as the public API grows, shrinking the fork over time rather than via a risky big-bang rewrite.

### Negative

- **Up-front migration cost.** Extracting ~60 services from a workbench contribution into an extension is non-trivial. Modules that import internal paths (`../../../../base/common/platform.js`, `IProductService`, `IWorkbenchEnvironmentService`) must be rewritten against the public API. The largest modules (`editCodeService.ts` 86 KB, `chatThreadService.ts` 62 KB, `editCodeService` autocomplete 34 KB) will require careful porting.
- **Feature-fidelity risk on stock VS Code.** The inline edit-code zone and autocomplete may lose fidelity when constrained to the public/proposed API. The hybrid mitigates this by keeping those in the shell, but the extension-only experience will be weaker than the shell experience by design.
- **Dual-distribution complexity.** Shipping both a binary shell and a Marketplace extension means two release cadences, two update mechanisms (`ribixUpdateMainService.ts` for the shell, Marketplace auto-update for the extension), and version-compatibility testing across both.
- **Web extension Playwright limitation.** Web users cannot run Playwright locally; QA must be delegated to the Ribix backend. This is consistent with the existing `/web-ide` proxy architecture but adds a backend dependency for the web QA flow.
- **Proposed-API dependency.** Any fork-only hooks exposed to the extension via proposed APIs tie the extension to the Ribix shell (and to specific upstream API versions), reintroducing a mild version-coupling cost that the hybrid is meant to reduce. This must be kept to a minimum.

### Neutral / open questions

- Whether `editCodeService` / `editCodeZoneManager` can reach acceptable fidelity on the public inline-edit proposed API, or must remain shell-only permanently.
- Whether the standalone `web-ide/` React app is retired in favor of `vscode-reh-web`, or retained as a lightweight embedder for non-VS-Code surfaces (e.g., the `ribix-web` dashboard).
- The exact split of "shell-only" vs "extension-capable" services — to be finalized by an audit of each module's import graph against the public `vscode` API surface.

---

## Status tracking

| Phase | Owner | Status |
|---|---|---|
| Module-by-module API-dependency audit | core team | Not started |
| Extract domain services into `extensions/ribix/` | core team | Not started |
| Thin `src/vs/workbench/contrib/ribix/` to shell-only | core team | Not started |
| Publish extension to Marketplace + Open VSX | core team | Not started |
| Consolidate `web-ide/` onto `vscode-reh-web` | core team | Not started |
