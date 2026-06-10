# Changelog

All notable changes to Ribix IDE are documented here.

## [1.0.0] — 2026-06-10

### Added

#### Core Product
- **Command Center panel** — primary sidebar panel replacing the file explorer on first launch; four tabs: Missions, Agents, Memory, Settings
- **Mission lifecycle state machine** — `awaiting_outcome → planning → plan_ready → executing → reviewing → complete` (+ `aborted`, `failed`); persists to IStorageService across restarts
- **Multi-agent orchestration** — topological task graph execution with dependency resolution, concurrent agent spawning, and per-file locking; agents run in parallel where dependencies allow
- **Agent types** — Planner, Coder, Tester, Debugger, Reviewer, Docs, Release; each with QA-first system prompt
- **Planning service** — LLM call that decomposes a natural-language outcome into a structured `PlanTask[]` graph; JSON schema validated; graceful fallback plan on parse failure
- **Checkpoint + rollback** — `IRibixCheckpointService` snapshots file content before every agent write; `rollbackFile`, `rollbackAgent`, `rollbackMission` restore prior state; persisted to workspace storage

#### Browser & QA Tools (7 new built-in tools)
- `browser_navigate` — headless Chromium via Playwright; navigates URL, returns screenshot path + title + URL
- `browser_screenshot` — capture current page state
- `browser_click` — click element by CSS/role/text selector; screenshot after
- `browser_type` — fill input field; screenshot after
- `browser_scroll` — scroll in any direction; screenshot after
- `browser_get_html` — return full page or element HTML for DOM/accessibility inspection
- `browser_close` — close browser session and free resources
- MCP routing — unknown tool names fall through to `IMCPService` for any configured MCP server (Playwright MCP, Puppeteer MCP, etc.)

#### Persistent Memory
- `IRibixMemoryService` — SHA-256 workspace IDs, IStorageService-backed, async init race resolved via `_initPromise`
- Memory types: `codebase_file`, `codebase_ownership`, `codebase_pattern`, `mission_summary`, `approval_decision`, `vocabulary_entry`
- Org sync: push on mission complete, pull on workspace open (requires Ribix backend auth)
- Memory tab — searchable, editable entries with source badge (agent / engineer); inline note-adding form

#### Authentication & Backend
- OAuth PKCE flow: `Ribix: Sign In` command, `RibixOAuthURLHandlerContribution` processes `ribix-ide://ribix.ribix-ide/oauth/callback`
- Session stored in `IEncryptionService` (OS keychain-backed encrypted storage)
- Connects to Ribix backend `/api/v1/*` for org memory sync, session verification, and PR creation

#### Ribix Branding
- Dark green `#01311F` Activity Bar and Command Center; gold `#C6AA58` accents throughout
- Ribix face logo (green circle, gold eyes) in onboarding screen
- Editor watermark, file icons, Getting Started, Release Notes, Walkthrough screens all use Ribix SVG mark
- Onboarding overlay: dark green background, gold CTA buttons, Ribix logo
- `--void-ring-color` and `--void-link-color` updated to Ribix gold

#### Developer Experience
- CI pipeline: type check + React build on every PR; full gulp compile on main push
- Node.js 20.18.2 pinned (matches `.nvmrc`)
- `prepare-commit-msg` hook appends `Co-Authored-By: Ribix IDE <ide@ribix.dev>`

### Changed
- Base: forked from Void editor (Code-OSS 1.99.3)
- Product identity: `product.json` fully updated (`nameShort: "Ribix IDE"`, `applicationName: "ribix-ide"`, `darwinBundleIdentifier: "dev.ribix.ide"`, `urlProtocol: "ribix-ide"`)
- All React components renamed to PascalCase (`RibixMissionsPanel`, `RibixAgentsPanel`, etc.)
- `useAccessor()` extended with `IInstantiationService.invokeFunction` fallback for services not in the pre-built accessor map (avoids circular module dep constraint)
- All 10 command-center React components renamed to PascalCase
- Existing Void "Chat" sidebar renamed to "Quick Edit" — preserves all Void functionality (autocomplete, Cmd+K, inline completions)

### Fixed
- Circular module dependency: `util/services.tsx` no longer imports `IToolsService` or Ribix agent services directly; avoids toolsService → voidCommandBarService → void-editor-widgets → util/services → toolsService TDZ cycle
- `handleOAuthCallback` now on `IRibixAuthService` interface; redirect URI corrected to `ribix-ide://ribix.ribix-ide/oauth/callback`
- `getWorkspacePath()` implemented via `IWorkspaceContextService` (was always-null stub)
- `transitionToReviewing()` in orchestration service calls `missionService.setReviewing()` (was no-op stub)
- `processToolCalls` uses `toolsService.validateParams` + `toolsService.callTool` (replaces broken `any`-cast approach)
- `callLLM` uses correct `sendLLMMessage` API with `messagesType`, `separateSystemMessage`, `chatMode` fields
