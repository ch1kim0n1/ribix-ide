# Ribix IDE Codebase Guide

Ribix IDE is a fork of VS Code (via the Void project) with an agentic engineering intelligence layer added on top. The VS Code base is largely untouched — nearly all Ribix-specific code lives under one folder.

---

## Where Ribix Code Lives

```
src/vs/workbench/contrib/void/
  browser/          UI panels and React entry points (renderer process)
  electron-main/    Node services: metrics, update checks, file watchers (main process)
  common/           Shared types, task queues, file lock service (both processes)
  test/             Unit and integration tests for Ribix services
```

### Key Files

| File | Purpose |
|------|---------|
| `browser/ribixAgentService.ts` | Agent lifecycle — start, abort, completion events |
| `common/ribixTaskQueueService.ts` | Serialised task queue with concurrency guard |
| `common/ribixFileLockService.ts` | File-level lock to prevent overlapping edits |
| `electron-main/metricsMainService.ts` | PostHog telemetry (reads `RIBIX_POSTHOG_KEY` env var) |
| `electron-main/voidUpdateMainService.ts` | Auto-update check (points to `ch1kim0n1/ribix-ide` releases) |

---

## VS Code Architecture Primer

Ribix runs inside Electron. Electron has two processes:

- **Main process** (`electron-main/`) — full Node.js, accesses the filesystem, spawns child processes, handles OS integrations.
- **Renderer process** (`browser/`) — Chromium web page, renders the UI. Cannot import native Node modules directly.

Communication between the two happens via VS Code's IPC channels (services registered with `registerSingleton`). Code in `common/` can be used by either process.

For a deeper VS Code architecture overview see Microsoft's [Source Code Organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) wiki page.

---

## Mission / Agent Lifecycle

1. User triggers a mission (or auto-trigger fires from `ribixAgentService.ts`).
2. A task is enqueued via `ribixTaskQueueService.ts` (prevents concurrent agent runs on the same target).
3. The agent acquires a file lock via `ribixFileLockService.ts` before writing.
4. On completion or abort, `onDidCompleteAgent` fires so listeners clean up.

---

## Telemetry

Telemetry uses PostHog. The client reads `process.env['RIBIX_POSTHOG_KEY']` at runtime. If the variable is absent, the key defaults to a disabled placeholder and no events are sent. To enable analytics, set `RIBIX_POSTHOG_KEY` as a GitHub Actions secret and inject it at build time.

---

## Building

See `HOW_TO_CONTRIBUTE.md` for full build instructions.

Quick reference:
```
npm install
npm run buildreact
# Then Ctrl+Shift+B inside VS Code to start the watch build
./scripts/code.sh   # macOS/Linux developer window
./scripts/code.bat  # Windows developer window
```

---

## Filing Issues

https://github.com/ch1kim0n1/ribix-ide/issues
