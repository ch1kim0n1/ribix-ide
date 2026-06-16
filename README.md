# Ribix IDE

**The QA-first IDE. AI agents find bugs before you ship them.**

Ribix IDE is the only development environment where autonomous QA agents run alongside your code — finding bugs in your staging environment, writing failing tests, generating fixes, and asking for your approval before opening a PR. No dashboard to visit. No separate QA tool to install.

---

Every other AI IDE helps you write code faster. Ribix IDE makes sure the code you write actually works. The Tester agent acts like a real user in your staging environment. The Reviewer agent checks accessibility, contrast, and layout. The Debugger agent traces failures to root cause. All running in parallel while you code.

---

## Why Ribix IDE over Cursor/Windsurf

| | Cursor | Windsurf | Ribix IDE |
|---|---|---|---|
| Write code with AI | ✓ | ✓ | ✓ |
| Proactive bug discovery | ✗ | ✗ | ✓ |
| Playwright E2E QA agent | ✗ | ✗ | ✓ |
| Auto-generates failing tests | ✗ | ✗ | ✓ |
| Accessibility reviewer | ✗ | ✗ | ✓ |
| Persistent codebase memory | ✗ | ✗ | ✓ |
| Approve before any PR | Optional | Optional | Required |

---

## What it does

- **Mission-driven work** — type an outcome in the Command Center, approve the agent plan, watch agents execute
- **QA-first agents** — every Tester agent acts as a real user via Playwright, finds bugs through E2E interaction, classifies severity p0–p3
- **Visual design review** — Reviewer agent checks contrast ratios, spacing, accessibility, responsive behavior
- **Browser tools** — agents can navigate, click, type, screenshot, and analyze any URL
- **Persistent memory** — codebase graph, ownership model, and mission history compound across sessions
- **Multi-agent orchestration** — Planner, Coder, Tester, Debugger, Reviewer, Docs, and Release agents run in parallel with dependency resolution and file locking

---

## One-click install

The fastest way to get Ribix IDE running. The installer clones the repo, installs dependencies, compiles, downloads Electron, and creates a desktop shortcut — no manual steps.

**macOS / Linux**
```bash
curl -sSL https://raw.githubusercontent.com/ch1kim0n1/ribix-ide/main/install.sh | bash
```

**Windows** (run in PowerShell or Command Prompt from the directory where you want the repo cloned)
```bat
curl -sSL https://raw.githubusercontent.com/ch1kim0n1/ribix-ide/main/install.bat -o install.bat && install.bat
```

> The first build takes ~8–10 minutes. Node.js 20.18.2 is required; the installer will warn if your version differs.

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

All Ribix-specific code lives in `src/vs/workbench/contrib/ribix/browser/ribix*` and `src/vs/workbench/contrib/ribix/common/ribix*`.

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

## Try it — Demo App

A sample app with intentional bugs ships in `demo-app/`. Start it to see ribix-ide's QA agent in action:

1. `cd demo-app && npm install && npm start`
2. Open ribix-ide
3. Command Center: "Find and fix bugs in the checkout app at http://localhost:3001"
4. Watch agents discover all 7 bugs, write failing tests, and generate fixes

Expected: Ribix IDE finds and fixes all 4 server bugs and 3 UI bugs in under 10 minutes.

---

## License

MIT — see [LICENSE.txt](LICENSE.txt).

For questions: [vkondratyev@md7.com](mailto:vkondratyev@md7.com) | [ribix.dev](https://ribix.dev)
