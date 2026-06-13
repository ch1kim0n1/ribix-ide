# Contributing to Ribix IDE

Welcome! Ribix IDE is a VS Code fork that adds agentic engineering intelligence — a Command Center, mission lifecycle, and AI-driven code analysis — on top of the VS Code base. This guide covers everything you need to start contributing.

---

## Ways to Contribute

- Fix open issues: https://github.com/ch1kim0n1/ribix-ide/issues
- Propose features or report bugs by opening a new issue: https://github.com/ch1kim0n1/ribix-ide/issues/new
- Improve documentation

---

## Branch Naming

Use descriptive prefixes:

```
fix/<short-description>        # bug fixes
feat/<short-description>       # new features
docs/<short-description>       # documentation only
chore/<short-description>      # tooling, deps, config
```

Example: `fix/posthog-key-fallback`, `feat/mission-retry-ui`

---

## Fork and Setup

1. Fork the repo on GitHub, then clone your fork:
   ```
   git clone https://github.com/<your-username>/ribix-ide.git
   cd ribix-ide
   ```

2. Install dependencies (Node 20.18.2 required — see `.nvmrc`):
   ```
   npm install
   ```

3. Build the React sidebar components:
   ```
   npm run buildreact
   ```

4. Open the repo in VS Code or Ribix IDE itself and start the watch build:
   - Press `Ctrl+Shift+B` (Windows/Linux) or `Cmd+Shift+B` (macOS)
   - Wait for all three spinners to complete (roughly 5 minutes on first run)

5. Launch a Developer Mode window:
   - macOS/Linux: `./scripts/code.sh`
   - Windows: `./scripts/code.bat`

6. Reload the window after any code change with `Ctrl+R` / `Cmd+R`.

### Platform Prerequisites

**macOS:** Python and Xcode Command Line Tools (usually pre-installed).

**Windows:** Install [Visual Studio 2022 Community](https://visualstudio.microsoft.com/) with these workloads:
- Desktop development with C++
- Node.js build tools

Also select from Individual Components:
- MSVC v143 x64/x86 Spectre-mitigated libs (Latest)
- C++ ATL for latest build tools with Spectre Mitigations
- C++ MFC for latest build tools with Spectre Mitigations

**Linux (Debian/Ubuntu):**
```
sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3
```

---

## Where Ribix Code Lives

Ribix-specific code is under `src/vs/workbench/contrib/void/`. See `CODEBASE_GUIDE.md` for a full architectural overview.

Key areas:
- `browser/` — UI components (runs in Electron renderer process)
- `electron-main/` — backend services, metrics, update checks (runs in Node/main process)
- `common/` — shared logic accessible from both processes

---

## Submitting a PR

1. Create a branch from `main` using the naming convention above
2. Make your changes; keep commits focused
3. Push to your fork and open a PR against `ch1kim0n1/ribix-ide` `main`
4. Describe what you changed and why in the PR body
5. Link the issue your PR addresses (e.g. `Fixes #12`)

---

## Getting Help

Open an issue: https://github.com/ch1kim0n1/ribix-ide/issues

For VS Code internals not covered here, Microsoft's [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) wiki is a useful reference.
