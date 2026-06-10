# Ribix IDE

**The agent-first software engineering operating system.**

Ribix IDE is a fork of the Void editor (itself a VS Code fork) rebuilt as an agent-first development environment. Instead of writing code with AI assistance, you describe outcomes and Ribix deploys autonomous agents to plan, code, test, debug, document, and ship the result.

---

## What it does

- **Mission-driven work** — type an outcome in the Command Center, approve the agent plan, watch agents execute
- **QA-first agents** — every Tester agent acts as a real user via Playwright, finds bugs through E2E interaction, classifies severity p0–p3
- **Visual design review** — Reviewer agent checks contrast ratios, spacing, accessibility, responsive behavior
- **Browser tools** — agents can navigate, click, type, screenshot, and analyze any URL
- **Persistent memory** — codebase graph, ownership model, and mission history compound across sessions
- **Multi-agent orchestration** — Planner, Coder, Tester, Debugger, Reviewer, Docs, and Release agents run in parallel with dependency resolution and file locking

---

## Quick start

**Prerequisites:** Node.js 20.18.2 (via nvm), macOS/Windows/Linux

**Linux users** — install build dependencies first:
```bash
sudo apt-get install -y build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3
```

```bash
# 0. Clone the repository
git clone https://github.com/ch1kim0n1/ribix-ide.git
cd ribix-ide

# 1. Install dependencies
nvm use 20.18.2
npm install

# 2. Build React components
npm run buildreact

# 3. Compile TypeScript (takes ~8–10 min on first run; requires build tools)
npm run compile

# 4. Download Electron
node build/lib/preLaunch.js

# 5. Launch
./scripts/code.sh --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions
```

**Windows:** use `scripts/code.bat` instead of `scripts/code.sh`

On first launch: the Ribix onboarding screen asks for an LLM API key (Anthropic/OpenAI/Gemini). After that, the Command Center panel is your primary workspace.

---

## Architecture

- **Command Center** — primary sidebar panel with Missions, Agents, Memory, and Settings tabs
- **Agent services** — `ribixAgentService`, `ribixOrchestrationService`, `ribixPlanningService`, `ribixMissionService`
- **Browser tools** — `ribixBrowserChannel.ts` (Electron main) runs Playwright headless Chromium
- **Memory** — `ribixMemoryService` persists to workspace storage and optionally syncs to the Ribix backend
- **Auth** — OAuth PKCE flow connects to the Ribix backend for org features (optional for local-only use)

All Ribix-specific code lives in `src/vs/workbench/contrib/void/browser/ribix*` and `src/vs/workbench/contrib/void/common/ribix*`.

---

## How it relates to other Ribix surfaces

| Surface | Role |
|---------|------|
| **Ribix IDE** | Agent-first development — describe outcomes, run missions |
| **ribix-vs-extension** | VS Code extension for inline QA findings and PR approval |
| **ribix-cli** | Terminal interface for CI/CD, scripting, agent runs |
| **ribix-web** | Dashboard for cross-repo trends, team management, billing |
| **ribix** | Backend API, enrichment pipeline, GitHub App |

---

## License

MIT — see [LICENSE.txt](LICENSE.txt).

For questions: [vkondratyev@md7.com](mailto:vkondratyev@md7.com) | [ribix.dev](https://ribix.dev)
