# Ribix IDE — Performance Report

**Date:** 2026-06-09 (updated 2026-06-13)
**Phase:** 14 — E2E Testing & Hardening
**Status:** Targets defined. Zero measurements taken. No testable binary produced.

---

## Current Status

*Added 2026-06-13.*

All performance targets below are defined but none have been measured. There are no actual numbers in this document.

Reasons:

1. No testable binary exists. The build pipeline was recently fixed but has not produced a distributed build.
2. Several targets (rollback, agent activity feed) require the autonomous agent loop to be functional. The loop is currently one-shot (G-LOOP); missions also corrupt on restart (G-PERSIST). Meaningful performance measurement of these operations depends on P0 landing first.

Until a working binary is available and P0 gaps are resolved, all targets in the table below should be read as **design targets, not validated numbers.** Do not cite them as performance characteristics of the current product.

---

## Performance Targets

This report defines the performance targets for Ribix IDE and documents the methodology for measuring them.

| Operation | Target | Measurement Method | Status |
|---|---|---|---|
| Planning call (outcome → task graph) | < 30 seconds | Time from "Plan This" click to plan render | Pending measurement |
| Command Center panel open | < 200ms | Time from Activity Bar click to panel render | Pending measurement |
| Agent activity feed update latency | < 500ms | Time from agent state change to UI update | Pending measurement |
| Mission rollback (10 files) | < 3 seconds | Time from abort click to all files restored | Pending measurement |
| Memory search (1000 entries) | < 100ms | Time from search query to results display | Pending measurement |

---

## Profiling Methodology

### 1. Planning Call Performance

**Target:** < 30 seconds

**Measurement Steps:**
1. Open Ribix IDE with fresh workspace
2. Open Chrome DevTools (or VS Code DevTools) Performance tab
3. Start recording
4. Type outcome: "Add input validation to the login form. All tests must still pass."
5. Click "Plan This"
6. Stop recording when plan renders
7. Measure time from click to plan render completion

**Key Metrics to Capture:**
- Network request time to LLM API
- LLM response time (time to first token + full response)
- Plan parsing and validation time
- React render time for task tree

**Optimization Notes:**
- If > 30s, consider:
  - Streaming plan response (show tasks as they arrive)
  - Caching common plan patterns
  - Using faster model for planning
  - Reducing plan complexity (max 8 tasks instead of 12)

---

### 2. Command Center Panel Open Performance

**Target:** < 200ms

**Measurement Steps:**
1. Open Ribix IDE
2. Switch to a different panel (e.g., Explorer)
3. Open Chrome DevTools Performance tab
4. Start recording
5. Click Ribix icon in Activity Bar
6. Stop recording when Command Center is fully visible
7. Measure time from click to panel render

**Key Metrics to Capture:**
- React component mount time
- Initial data fetch time (missions, agents, memory)
- Layout calculation time
- Paint time

**Optimization Notes:**
- If > 200ms, consider:
  - Lazy loading tabs (only render active tab)
  - Caching panel state
  - Reducing initial data fetch (load on-demand)
  - Virtualizing long lists (missions, agents)

---

### 3. Agent Activity Feed Update Latency

**Target:** < 500ms

**Measurement Steps:**
1. Create and start a mission with multiple agents
2. Open Chrome DevTools Performance tab
3. Start recording
4. Wait for agent to perform an action (e.g., write a file)
5. Stop recording when activity feed updates
6. Measure time from agent action to UI update

**Key Metrics to Capture:**
- Event emission time (agent → orchestration service)
- Event propagation time (service → React component)
- React state update and render time
- DOM mutation time

**Optimization Notes:**
- If > 500ms, consider:
  - Batching activity feed updates (debounce to 100ms)
  - Using React.memo for feed items
  - Virtualizing feed (only render visible items)
  - Using Web Worker for feed processing

---

### 4. Mission Rollback Performance

**Target:** < 3 seconds (for 10 files)

**Measurement Steps:**
1. Create a mission that writes at least 10 files
2. Start mission execution
3. Open Chrome DevTools Performance tab
4. Start recording
5. Click "Abort" on the mission
6. Stop recording when all files are restored
7. Measure time from abort click to completion

**Key Metrics to Capture:**
- File lock release time
- File restore time per file
- Checkpoint lookup time
- Git operation time (if using git-based rollback)

**Optimization Notes:**
- If > 3s, consider:
  - Parallel file restoration
  - In-memory checkpoints (faster than git-based)
  - Incremental rollback (only restore changed files)
  - Background rollback with progress indicator

---

### 5. Memory Search Performance

**Target:** < 100ms (for 1000 entries)

**Measurement Steps:**
1. Generate or load 1000 memory entries (use script or manual import)
2. Open Memory tab
3. Open Chrome DevTools Performance tab
4. Start recording
5. Type search query in Memory tab search box
6. Stop recording when results display
7. Measure time from query to results

**Key Metrics to Capture:**
- Search index lookup time
- Filter time (applying search to entries)
- React render time for results
- Virtual list scroll time (if scrolling)

**Optimization Notes:**
- If > 100ms, consider:
  - Building search index (lunr.js, fuse.js)
  - Debouncing search input (300ms)
  - Virtualizing results list
  - Paginating results (show 50 at a time)
  - Using Web Worker for search

---

## Test Data Generation

### Memory Search Test Data

To test memory search with 1000 entries, use the following script:

```typescript
// scripts/generateMemoryTestData.ts
import { IRibixMemoryService } from 'vs/workbench/contrib/void/common/ribixMemoryService';

async function generateTestData(memoryService: IRibixMemoryService) {
  const entries = [];
  for (let i = 0; i < 1000; i++) {
    entries.push({
      id: `test-${i}`,
      type: 'pattern' as const,
      source: 'agent' as const,
      content: `Test pattern ${i}: Common code pattern for handling ${i % 10} different cases`,
      timestamp: Date.now() - (i * 1000),
      metadata: {
        file: `src/test/file${i % 50}.ts`,
        agent: `Coder-${i % 5}`,
        mission: `test-mission-${Math.floor(i / 100)}`
      }
    });
  }
  await memoryService.addEntries(entries);
  console.log(`Generated ${entries.length} memory entries`);
}
```

### Mission Rollback Test Data

To test rollback with 10 files, create a mission with the following outcome:

```
Create a new user authentication module with 10 files:
- auth/user.ts
- auth/session.ts
- auth/token.ts
- auth/middleware.ts
- auth/validator.ts
- auth/hasher.ts
- auth/error.ts
- auth/types.ts
- auth/index.ts
- auth/config.ts
```

---

## Profiling Tools

### Chrome DevTools

1. Open Chrome DevTools: Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
2. Go to Performance tab
3. Click "Record"
4. Perform the operation
5. Click "Stop"
6. Analyze the timeline:
   - Look for long tasks (> 50ms)
   - Check for layout thrashing
   - Identify slow network requests
   - Review JavaScript execution time

### VS Code Built-in Profiler

Ribix IDE (based on VS Code) has built-in profiling:

1. Open Command Palette: Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)
2. Run "Developer: Toggle Performance Profiler"
3. Perform the operation
4. Run "Developer: Stop Performance Profiler"
5. Profile is saved to temp directory
6. Open profile in Chrome DevTools for analysis

### React DevTools

For React-specific profiling:

1. Install React DevTools extension
2. Open React DevTools tab
3. Go to Profiler tab
4. Click "Record"
5. Perform the operation
6. Click "Stop"
7. Analyze component render times

---

## Methodology Status

As of Phase 14 (documentation phase), the following have been completed:

- Performance targets defined
- Profiling methodology documented
- Test data generation scripts outlined
- Profiling tools identified

The following remain entirely pending (no binary, no measurements):

- Actual profiling measurements
- Comparison of actuals to targets
- Optimization recommendations

---

## Next Steps

1. **Run actual profiling measurements:**
   - Build Ribix IDE: `yarn gulp vscode-darwin-x64`
   - Run each profiling scenario
   - Document actual times in this report

2. **Analyze results:**
   - Compare actual times to targets
   - Identify bottlenecks
   - Prioritize optimizations

3. **Implement optimizations (if needed):**
   - Address any targets not met
   - Re-profile after changes
   - Document improvements

4. **Final validation:**
   - Confirm all targets met
   - Document final performance characteristics
   - Mark Phase 14 complete

---

## Notes

- All performance targets are based on typical user expectations for a modern IDE
- Targets may be adjusted based on real-world usage feedback during alpha testing
- Some operations (e.g., planning call) depend on external LLM API latency, which may vary
- Consider adding performance monitoring in production to track real-world metrics

---

**Report Version:** 1.0
**Last Updated:** 2026-06-09