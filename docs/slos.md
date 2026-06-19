# Ribix IDE — SLOs, Error Budgets, and Load Testing

> **Issue #85** — Measurable service-level objectives for the IDE, backed by
> load/performance tests so we can commit to a reliable user experience.

## 1. SLO Definitions

### 1.1 Desktop IDE

| Metric | p50 target | p95 target | p99 target | Measurement |
|---|---|---|---|---|
| Install (one-click script) | < 5 min | < 8 min | < 12 min | Time from `install.sh` start to IDE launch |
| First launch (cold start) | < 3 s | < 5 s | < 8 s | Time from process start to window visible |
| Project open (10k files) | < 2 s | < 4 s | < 7 s | Time from "Open Folder" to file tree rendered |
| TypeScript compile (incremental) | < 30 s | < 60 s | < 90 s | `npm run compile-incremental` |
| Agent mission start | < 2 s | < 5 s | < 10 s | Time from "Approve Plan" to first agent action |
| Agent mission completion (simple) | < 5 min | < 10 min | < 15 min | Single-file bug fix with test |
| Agent mission completion (complex) | < 15 min | < 30 min | < 45 min | Multi-file feature with tests + review |
| Settings panel open | < 500 ms | < 1 s | < 2 s | Time from command to panel visible |
| Autocomplete suggestion | < 300 ms | < 800 ms | < 1.5 s | Time from cursor stop to first suggestion |

### 1.2 Web IDE

| Metric | p50 target | p95 target | p99 target | Measurement |
|---|---|---|---|---|
| Page load (first contentful paint) | < 1.5 s | < 3 s | < 5 s | Lighthouse FCP |
| File save (web IDE) | < 200 ms | < 500 ms | < 1 s | Time from Ctrl+S to server confirmation |
| File tree load (100 files) | < 500 ms | < 1 s | < 2 s | Time from workspace open to tree rendered |
| AI chat response (first token) | < 1 s | < 3 s | < 5 s | Time from send to first streaming token |
| Terminal command execution | < 300 ms | < 800 ms | < 1.5 s | Time from command to output start |

### 1.3 Backend API (ribix)

| Metric | p50 target | p95 target | p99 target | Measurement |
|---|---|---|---|---|
| Auth (login/register) | < 200 ms | < 500 ms | < 1 s | API response time |
| File CRUD | < 100 ms | < 300 ms | < 500 ms | API response time |
| Marketplace proxy query | < 500 ms | < 1.5 s | < 3 s | API response time (with cache) |
| Agent SSE stream start | < 500 ms | < 1 s | < 2 s | Time to first SSE event |

## 2. Error Budgets

Error budgets are calculated per 30-day window. The budget is `100% - SLO%`.

| Service | SLO | Error budget | Budget consumption tracking |
|---|---|---|---|
| Desktop IDE launch | 99.5% | 0.5% (~3.6 min/month) | Count failed launches |
| Agent mission success | 95% | 5% (~36 min/month per user) | Count failed/aborted missions |
| Web IDE availability | 99.9% | 0.1% (~4.3 min/month) | Uptime monitoring |
| Backend API success rate | 99.5% | 0.5% | HTTP 5xx / total requests |
| AI provider call success | 99% | 1% | Failed API calls / total |

### Error budget policy
- **Green (< 50% consumed)**: No action required. Feature work proceeds normally.
- **Yellow (50–80% consumed)**: Prioritize reliability fixes over new features.
- **Red (> 80% consumed)**: Freeze new features. All engineering effort goes to reliability fixes until budget recovers.
- **Exhausted (100% consumed)**: Postmortem required. Roll back recent changes if correlated.

## 3. Load Testing Plan

### 3.1 Multi-Agent Loop Load Test
- **Goal**: Verify 5 concurrent missions complete within SLO
- **Setup**: 5 missions launched simultaneously, each with 3 agents
- **Pass criteria**: All 5 complete within 30 min p95, no OOM, no deadlock
- **Tool**: `test/integration/agentLoopLoadTest.ts`

### 3.2 AI Provider Integration Load Test
- **Goal**: Verify provider fallback works under rate limiting
- **Setup**: 100 rapid API calls to each provider (mocked)
- **Pass criteria**: Fallback triggers on 429, no unhandled rejections
- **Tool**: `test/integration/providerLoadTest.ts`

### 3.3 Web IDE File Operations Load Test
- **Goal**: Verify file CRUD under concurrent access
- **Setup**: 10 concurrent users, 1000 file operations each
- **Pass criteria**: All operations succeed, no data corruption, p95 < 500ms
- **Tool**: `test/integration/webIdeLoadTest.ts` (k6 or Playwright)

### 3.4 Build Performance Regression Test
- **Goal**: Catch build time regressions in CI
- **Setup**: Measure `npm run compile-incremental` time in CI
- **Pass criteria**: p95 < 60s. Alert if regression > 20% from baseline.
- **Tool**: CI job with timing measurement

## 4. Monitoring and Alerting

### 4.1 Metrics to collect
- **IDE**: launch time, mission duration, agent failure rate, autocomplete latency
- **Web IDE**: FCP, file save latency, API response times
- **Backend**: request rate, error rate, p50/p95/p99 latency, active connections

### 4.2 Alert rules
| Alert | Condition | Severity |
|---|---|---|
| IDE launch failure | > 1% of launches in 1h window | P1 |
| Agent mission failure rate | > 10% in 1h window | P2 |
| Web IDE 5xx rate | > 0.5% in 5m window | P1 |
| Backend p95 latency | > 2x SLO target for 10m | P2 |
| Error budget 80% consumed | Budget tracking | P2 (notify team) |
| Error budget exhausted | Budget tracking | P1 (page on-call) |

### 4.3 Dashboards
- **IDE Health**: launch success rate, mission success rate, agent activity feed
- **Web IDE Health**: request rate, error rate, latency percentiles
- **Error Budget**: per-service budget consumption with 30-day projection

## 5. CI Integration

Load tests should run in CI with the following cadence:

| Test | Cadence | Blocking |
|---|---|---|
| Build performance | Every PR | Yes (regression > 20%) |
| Agent loop load | Nightly | Yes (failure blocks deploy) |
| Provider load | Weekly | No (advisory) |
| Web IDE load | Nightly | Yes (failure blocks deploy) |

Results are published to the monitoring dashboard and linked to the release gate.
