# ribix-ide - agent notes

## Project overview

Ribix IDE is a QA-first IDE built on a VS Code fork. It integrates
autonomous agents that find bugs, write tests, and generate fixes while
you code. The Ribix-specific code lives in
`src/vs/workbench/contrib/ribix/` and adds an AI agent system, chat,
inline edit code, findings integration, mission orchestration, and a
React-based sidebar UI on top of the standard VS Code workbench.

## Verification commands

This is a VS Code fork that uses gulp for compilation. There is no
standard `npm test` — tests are run via dedicated scripts.

- `npm run typecheck` - `npm run compile` (gulp compile; this is the
  closest equivalent to a typecheck since tsc is invoked by gulp)
- `npm run eslint` - `node build/eslint` (lints the codebase)
- `npm run stylelint` - `node build/stylelint` (lints CSS/styles)
- `npm run validate` - `npm run eslint && npm run typecheck`
- `npm run compile` - `gulp compile` (full compilation)
- `npm run compile-incremental` - `gulp compile-incremental` (faster
  incremental compile, needs 8GB heap)
- `npm run watch` - `npm-run-all -lp watch-client watch-extensions`
  (watch mode for development)
- `npm run buildreact` - builds the React sidebar UI bundle
  (`src/vs/workbench/contrib/ribix/browser/react/`)
- `npm run watchreact` - watch mode for the React sidebar UI
- `npm run test-browser` - Playwright-based browser unit tests
- `npm run test-node` - Mocha-based Node unit tests
- `npm run test-extension` - VS Code extension tests
- `npm run smoketest` - End-to-end smoke tests

**Note**: Full compilation is heavy (requires 8GB+ heap). For Ribix-only
changes, use `npm run watchreact` for React UI work and
`npm run compile-incremental` for TypeScript changes.

## Key conventions

- **VS Code fork patterns**: follow existing VS Code conventions for the
  workbench layer. Use `createDecorator` for services, register
  contributions via `registerWorkbenchContribution`.
- **Layer separation**: `common/` contains platform-agnostic types and
  services; `browser/` contains renderer-process implementations;
  `electron-main/` contains main-process code. Respect the layer
  boundaries — browser code must not import electron-main code.
- **React sidebar UI**: the sidebar and some panels use React, built
  separately via `src/vs/workbench/contrib/ribix/browser/react/build.js`
  (tsup + Tailwind). React source is in
  `src/vs/workbench/contrib/ribix/browser/react/src/`.
- **Service instantiation**: Ribix services use the VS Code
  instantiation service pattern (`InstantiationService`, `@IBrowserXxx`
  interfaces). See `ribix.contribution.ts` for registration.
- **AI provider abstraction**: `aiProviderManager.ts` and
  `modelCapabilities.ts` abstract multiple LLM providers (OpenAI,
  Anthropic, Google, Mistral, Groq, Ollama).
- **Agent loop**: `ribixAgentService.ts` is the core agent loop;
  `ribixOrchestrationService.ts` coordinates multi-step missions;
  `toolsService.ts` provides tool definitions.
- **Backend sync**: `cloudSync.ts` and `ribixBackendSseService.ts`
  handle communication with the Ribix backend.
- **No console.log**: use the VS Code logger (`ILogger`) for
  Ribix-specific logging. ESLint enforces this in Ribix code.
- **Settings**: all Ribix settings are defined in
  `ribixSettingsTypes.ts` and managed by `ribixSettingsService.ts`.

## Architecture notes

```
src/vs/workbench/contrib/ribix/
  browser/                    # Renderer-process implementations
    ribix.contribution.ts     # Workbench contribution registration
    ribixAgentService.ts      # Core agent loop (52K)
    ribixAgentLlmClient.ts    # LLM client for agent
    ribixOrchestrationService.ts  # Multi-step mission orchestration
    ribixPlanningService.ts   # Mission planning
    toolsService.ts           # Tool definitions and execution
    chatThreadService.ts      # Chat thread management (62K)
    editCodeService.ts        # Inline edit code (86K)
    autocompleteService.ts    # AI autocomplete (34K)
    contextGatheringService.ts  # Context gathering for prompts
    convertToLLMMessageService.ts  # Convert workspace context to LLM messages
    aiProviderManager.ts      # Multi-provider LLM abstraction
    ribixAuthService.ts       # Authentication
    ribixBackendSseService.ts # SSE connection to backend
    cloudSync.ts              # Cloud sync with Ribix backend
    nativeFindingsIntegration.ts  # Findings panel integration
    unifiedFindingsProvider.ts  # Unified findings data provider
    ribixMissionService.ts    # Mission management (37K)
    ribixCommandBarService.ts # Command bar UI (30K)
    sidebarPane.ts            # Sidebar pane registration
    ribixSettingsPane.ts      # Settings UI
    playwrightRunner.ts       # Playwright test execution
    ribixBrowserAgent.ts      # Browser automation agent
    ciIntegration.ts          # CI/CD integration
    fileLockManager.ts        # File locking for concurrent edits
    react/                    # React sidebar UI (separate build)
      src/                    # React component source
      build.js                # tsup build script
      tailwind.config.js      # Tailwind config
  common/                     # Platform-agnostic types and services
    ribixTypes.ts             # Core shared types
    ribixSettingsTypes.ts     # Settings type definitions
    ribixSettingsService.ts   # Settings service
    modelCapabilities.ts      # LLM model capability registry (60K)
    sendLLMMessageService.ts  # LLM message sending abstraction
    sendLLMMessageTypes.ts    # LLM message types
    mcpService.ts             # MCP (Model Context Protocol) service
    mcpServiceTypes.ts        # MCP types
    ribixApiClient.ts         # Backend API client
    ribixAuthTypes.ts         # Auth types
    toolsServiceTypes.ts      # Tool service types
    storageKeys.ts            # Storage key constants
    prompt/                   # Prompt templates
    helpers/                  # Shared helpers
  electron-main/              # Main-process code
  test/                       # Ribix-specific tests
```

The IDE inherits the full VS Code build system (gulp, esbuild, webpack).
Ribix-specific React UI is built separately via `npm run buildreact`.
The main compilation (`npm run compile`) handles all TypeScript including
Ribix workbench contributions.
