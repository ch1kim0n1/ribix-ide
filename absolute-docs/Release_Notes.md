# Ribix IDE — Alpha Release Notes

**Version:** 1.99.3-alpha
**Release Date:** 2026-06-09
**Status:** Alpha Release (Internal Distribution Only)

---

## Overview

Ribix IDE is an agent-first software engineering operating system, built on the Void editor fork (Code-OSS 1.99.3). This alpha release introduces a paradigm shift from AI-assisted coding to autonomous agent-driven development.

**Key Innovation:** The Command Center replaces the traditional code editor as the primary interface, with agents executing multi-step missions to achieve engineering outcomes.

---

## What's New in Alpha

### Core Architecture

**Agent System (Phases 4, 5, 6)**
- **Mission Service:** Complete mission lifecycle state machine (AWAITING_OUTCOME → PLANNING → PLAN_READY → EXECUTING → REVIEWING → COMPLETE)
- **Planning Service:** LLM-powered outcome decomposition into dependency-aware task graphs
- **Agent Service:** Multi-agent coordination with typed agent instances (Planner, Coder, Reviewer, Tester)
- **Orchestration Service:** Task queue execution with automatic dependency resolution and parallel execution

**Memory Infrastructure (Phase 2)**
- **Persistent Memory:** SQLite-backed memory storage surviving session restarts
- **Memory Types:** Mission history, patterns, decisions, org memory
- **Workspace Awareness:** Automatic workspace ID generation for scoped memory
- **Search Capability:** Full-text search across all memory entries

**Concurrency Control (Phase 3)**
- **File Lock Service:** Automatic file locking to prevent concurrent agent write collisions
- **Task Queue Service:** Priority-based async task execution with cancellation support
- **Lock Timeout:** Automatic timeout and retry for stuck operations

**Safety & Rollback (Phase 7)**
- **Mission-Scoped Checkpoints:** Automatic file snapshots before agent writes
- **One-Click Rollback:** Restore entire mission to pre-execution state
- **Per-Block Rollback:** Reject individual agent edits via code lens
- **Branch Management:** Automatic branch creation per mission

### User Interface

**Command Center Panel (Phase 8)**
- **Primary UX:** Command Center replaces file explorer as default view on launch
- **Three-Tab Layout:** Missions, Agents, and Memory tabs
- **Outcome Input:** Natural language outcome description with "Plan This" action
- **Plan Review Dialog:** Interactive task tree with approve/modify/abort controls
- **Agent Activity Feed:** Real-time event stream showing agent actions
- **Mission Cards:** Status tracking with progress indicators

**Editor Integration (Phase 9)**
- **Diff Annotations:** Gold-left-border highlighting for agent-written code blocks
- **Agent Attribution:** Code lens showing "Written by [Agent Name]" with timestamp
- **Decision Log:** Click "[View reasoning]" to see agent's decision process
- **Per-Block Controls:** Approve/reject individual edits via code lens
- **Diff Summary:** Post-mission summary of all file changes

**Quick Edit Preserved (Phase 12)**
- **Autocomplete:** Void's inline completion system fully functional
- **Cmd+K:** Quick edit for selected code ranges
- **Quick Edit Chat:** Secondary sidebar chat for single-turn queries
- **No Regression:** All existing Void features preserved and working

### Backend Integration

**Ribix API Connection (Phase 10)**
- **OAuth Authentication:** Secure sign-in via Ribix backend
- **Org Memory Sync:** Pull organizational memory for connected workspaces
- **Session Persistence:** Authentication survives IDE restarts
- **Settings Integration:** Connection status visible in Command Center settings

**PR Creation (Phase 11)**
- **Automatic PR Generation:** Create pull requests from completed missions
- **Branch Management:** Automatic branch creation and cleanup
- **Commit Message Generation:** AI-generated commit summaries
- **GitHub Integration:** Direct integration with GitHub PR system

### Identity & Branding (Phase 1)

- **Product Name:** "Ribix IDE" throughout application
- **Color Scheme:** Dark green (#01311F) activity bar with gold (#C6AA58) accents
- **Icons:** Ribix branding in dock, title bar, and UI elements
- **About Dialog:** Complete Ribix branding and version information
- **No Void References:** All Void branding replaced with Ribix identity

---

## Completed Phases

This alpha release includes the following completed phases from the Engineering Plan:

- ✅ **Phase 0 — Audit & Preparation:** Complete codebase understanding and documentation
- ✅ **Phase 1 — Identity & Branding:** Full Ribix rebranding
- ✅ **Phase 2 — Memory Infrastructure:** Persistent memory service with SQLite
- ✅ **Phase 3 — Task Queue & File Lock:** Concurrency control foundation
- ✅ **Phase 4 — Mission Service:** Mission lifecycle state machine
- ✅ **Phase 5 — Planning Service:** LLM-powered task decomposition
- ✅ **Phase 6 — Agent Service & Orchestration:** Multi-agent execution engine
- ✅ **Phase 7 — Checkpoint Service:** Mission-scoped rollback system
- ✅ **Phase 8 — Command Center Panel:** Primary UX implementation
- ✅ **Phase 9 — Editor Integration:** Diff annotations and agent attribution
- ✅ **Phase 10 — Backend Connection:** OAuth and API integration
- ✅ **Phase 11 — PR Creation:** Automated pull request generation
- ✅ **Phase 12 — Quick Edit Preservation:** Void feature compatibility
- ✅ **Phase 13 — Settings & Configuration:** Comprehensive settings system

**Pending Phases:**
- ⏳ **Phase 14 — E2E Testing & Hardening:** Full end-to-end validation
- ⏳ **Phase 15 — Alpha Packaging & Distribution:** Build, sign, and distribute (current phase)

---

## Known Limitations

### Alpha Release Constraints

1. **Distribution:**
   - Internal distribution only (no public release)
   - No code signing certificates acquired yet
   - Manual build process (no CI/CD automation)

2. **Auto-Update:**
   - Update server infrastructure not yet deployed
   - Auto-update feature present but non-functional
   - Manual update required for new versions

3. **Testing:**
   - E2E testing not yet completed (Phase 14 pending)
   - Performance targets not yet validated
   - Limited real-world usage data

### Feature Limitations

1. **Agent Capabilities:**
   - Maximum 12 tasks per mission (planning constraint)
   - No inter-mission dependency tracking
   - Limited to single-repository missions

2. **Memory:**
   - No cross-workspace memory sharing
   - Limited memory search at scale (target: 1000 entries)
   - No memory export/import functionality

3. **Collaboration:**
   - No real-time collaboration features
   - No team mission sharing
   - Single-user focus only

---

## System Requirements

### Minimum Requirements

- **Operating System:**
  - macOS 11.0 (Big Sur) or later
  - Windows 10 (version 1903) or later
  - Linux (Ubuntu 20.04, Fedora 33, or equivalent)

- **Hardware:**
  - 4GB RAM minimum (8GB recommended)
  - 2GHz dual-core processor (4-core recommended)
  - 10GB free disk space

- **Network:**
  - Internet connection for LLM API calls
  - Optional: Ribix backend connection for org memory

### Supported LLM Providers

- **Anthropic Claude** (recommended)
- **OpenAI GPT-4**
- **Google Gemini**
- **Mistral AI**
- **Ollama** (local models)
- **Groq** (high-speed inference)

---

## Installation

### macOS

```bash
# Download and mount DMG
open Ribix-IDE-1.99.3-alpha.dmg

# Drag to Applications folder
# Launch from Applications
```

### Windows

```bash
# Run installer
RibixIDESetup-1.99.3-alpha.exe

# Follow installation wizard
# Launch from Start Menu
```

### Linux

```bash
# Extract tarball
tar -xzf ribix-ide-1.99.3-alpha.tar.gz

# Run executable
./ribix-ide/ribix-ide
```

---

## First-Time Setup

1. **Launch Ribix IDE**
2. **Configure LLM Provider:**
   - Open Command Center → Settings
   - Select provider (e.g., Anthropic Claude)
   - Enter API key
3. **Optional: Connect to Ribix Backend:**
   - Command Palette → "Ribix: Sign In"
   - Complete OAuth flow
4. **Create First Mission:**
   - Type outcome in Command Center
   - Click "Plan This"
   - Review and approve plan

---

## Getting Started

### Create Your First Mission

1. Open Command Center (default view on launch)
2. In the Missions tab, type: "Add input validation to the login form. All tests must still pass."
3. Click "Plan This"
4. Review the generated task tree
5. Click "Approve Plan"
6. Watch agents execute in real-time
7. Review results and approve or redirect

### Use Quick Edit

1. Select code in editor (3-5 lines)
2. Press Cmd+K (macOS) or Ctrl+K (Windows/Linux)
3. Type instruction: "Add null check"
4. Press Enter
5. Review DiffZone and approve/reject

### View Memory

1. Open Command Center
2. Switch to Memory tab
3. Browse mission history, patterns, and decisions
4. Click any entry to view details
5. Edit or delete entries as needed

---

## Troubleshooting

### Common Issues

**Issue:** Agents not responding
- Check LLM API key is configured correctly
- Verify internet connection
- Check API quota/billing status

**Issue:** Mission stuck in "Planning" state
- Planning timeout is 30 seconds
- Check LLM provider status
- Try simpler outcome description

**Issue:** File lock timeout
- Another agent may be holding the lock
- Wait for current operation to complete
- Abort mission if stuck

**Issue:** Memory not persisting
- Check SQLite database permissions
- Verify workspace ID is consistent
- Check storage service logs

### Getting Help

- **Issues:** https://github.com/ribix/ribix-ide/issues
- **Documentation:** `absolute-docs/` directory
- **Engineering Plan:** `absolute-docs/Engineering_Plan.md`

---

## Security & Privacy

### Data Handling

- **Local Storage:** All mission data stored locally by default
- **LLM API:** Code context sent to configured LLM provider
- **Ribix Backend:** Optional org memory sync (requires authentication)
- **No Telemetry:** No usage analytics or telemetry in alpha release

### Code Signing

**Status:** Pending (certificates not yet acquired)
- Alpha builds are unsigned
- macOS may show security warning on first launch
- Windows SmartScreen may warn about unsigned installer
- **Workaround:** Right-click → Open on macOS; "More info" → Run anyway on Windows

---

## Roadmap

### Beta Release (Planned)

- Complete E2E testing and hardening (Phase 14)
- Acquire code signing certificates
- Set up auto-update infrastructure
- Performance optimization
- Public beta distribution

### v1.0 Release (Planned)

- Multi-repository mission support
- Inter-mission dependencies
- Team collaboration features
- Advanced memory management
- Plugin system for third-party agents

---

## Credits

**Base:** Void editor fork (Code-OSS 1.99.3)
**Developed by:** Ribix Inc.
**License:** MIT

---

## Feedback

This is an alpha release for internal testing. Please provide feedback via:

- GitHub Issues: https://github.com/ribix/ribix-ide/issues
- Internal Slack: #ribix-ide-feedback
- Email: feedback@ribix.dev

---

**Thank you for testing Ribix IDE Alpha!**

---

## Corrections

*Added 2026-06-13. These correct factual errors in the release notes above.*

### "SQLite-backed memory storage" is wrong

The "Memory Infrastructure (Phase 2)" section states: "Persistent Memory: SQLite-backed memory storage surviving session restarts."

The actual implementation uses VS Code's `IStorageService` with `StorageScope.WORKSPACE` and `StorageTarget.USER` (see `ribixMemoryService.ts`). The code does not use SQLite directly, does not import a SQLite driver, and does not own the storage path or schema. At the Electron platform layer, `IStorageService` happens to persist to a platform-managed SQLite file — but this is an implementation detail of the VS Code platform, not a deliberate choice made in ribix-ide code. The memory service has no direct SQLite dependency and cannot make guarantees about the storage format.

The correct description: persistent memory backed by `IStorageService` (VS Code workspace/profile storage), which survives session restarts.

The "Troubleshooting" entry "Issue: Memory not persisting — Check SQLite database permissions" is also inaccurate for the same reason. The correct diagnostic is to check `IStorageService` workspace storage state, not a SQLite file path.

### "Completed Phases 0–13" is aspirational, not verified

The "Completed Phases" section marks all phases 0–13 with a checkmark. This reflects that the code for each phase was written, not that each phase was validated end-to-end.

Current actual status:

- All 119 E2E scenarios across all phases in `E2E_Test_Results.md` remain **Pending**.
- No testable binary has been produced from the build pipeline.
- The core autonomous loop (agents iterating, missions persisting across restarts, auto-trigger on save) does not yet function. See `Engineering_Plan.md` for the full gap list.

Phases 0–13 are better described as: scaffold landed, not validated. The Engineering Plan (version 2.0, 2026-06-12) was written specifically because the marked-complete scaffold does not yet deliver the product's defining behavior.