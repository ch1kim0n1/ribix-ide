import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAnalyticsStore, AnalyticsManager } from './analyticsStore';
import type { UsageMetrics, PerformanceMetrics, CostTracking } from './analyticsStore';

function makeUsage(
  overrides: Partial<UsageMetrics> & { timestamp?: number; userId?: string; workspaceId?: string } = {},
): UsageMetrics {
  return {
    timestamp: overrides.timestamp ?? 1000,
    userId: overrides.userId ?? 'u1',
    workspaceId: overrides.workspaceId ?? 'w1',
    metrics: {
      sessionDuration: 3600,
      filesEdited: 2,
      linesChanged: 10,
      aiRequests: 1,
      aiTokensUsed: 1000,
      collaborationMinutes: 5,
      terminalCommands: 3,
      ...overrides.metrics,
    },
  };
}

function makePerf(
  overrides: Partial<PerformanceMetrics> & { timestamp?: number; workspaceId?: string } = {},
): PerformanceMetrics {
  return {
    timestamp: overrides.timestamp ?? 1000,
    workspaceId: overrides.workspaceId ?? 'w1',
    metrics: {
      cpuUsage: 10,
      memoryUsage: 50,
      diskUsage: 20,
      networkBytesIn: 100,
      networkBytesOut: 200,
      responseTime: 30,
      errorRate: 0.01,
      ...overrides.metrics,
    },
  };
}

function makeCost(
  overrides: Partial<CostTracking> & { timestamp?: number; userId?: string; period?: CostTracking['period'] } = {},
): CostTracking {
  return {
    timestamp: overrides.timestamp ?? 1000,
    userId: overrides.userId ?? 'u1',
    period: overrides.period ?? 'daily',
    costs: {
      compute: 1,
      storage: 0.5,
      network: 0.2,
      ai: 0.3,
      total: 2,
      ...overrides.costs,
    },
    currency: 'USD',
  };
}

beforeEach(() => {
  useAnalyticsStore.setState({
    usageMetrics: [],
    performanceMetrics: [],
    costTracking: [],
    currentReport: null,
    isLoading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAnalyticsStore', () => {
  it('starts with empty metrics and no report', () => {
    const s = useAnalyticsStore.getState();
    expect(s.usageMetrics).toEqual([]);
    expect(s.performanceMetrics).toEqual([]);
    expect(s.costTracking).toEqual([]);
    expect(s.currentReport).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('setError sets and clears the error field', () => {
    useAnalyticsStore.getState().setError('boom');
    expect(useAnalyticsStore.getState().error).toBe('boom');
    useAnalyticsStore.getState().setError(null);
    expect(useAnalyticsStore.getState().error).toBeNull();
  });

  it('loadUsageMetrics loads metrics into state and clears loading', async () => {
    await useAnalyticsStore.getState().loadUsageMetrics({ userId: 'u1' });
    const s = useAnalyticsStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(Array.isArray(s.usageMetrics)).toBe(true);
  });

  it('loadPerformanceMetrics loads performance metrics into state', async () => {
    await useAnalyticsStore.getState().loadPerformanceMetrics({ workspaceId: 'w1' });
    const s = useAnalyticsStore.getState();
    expect(s.isLoading).toBe(false);
    expect(Array.isArray(s.performanceMetrics)).toBe(true);
  });

  it('loadCostTracking loads costs into state', async () => {
    await useAnalyticsStore.getState().loadCostTracking({ period: 'daily' });
    const s = useAnalyticsStore.getState();
    expect(s.isLoading).toBe(false);
    expect(Array.isArray(s.costTracking)).toBe(true);
  });

  it('generateReport sets currentReport and clears loading', async () => {
    await useAnalyticsStore.getState().generateReport('daily');
    const s = useAnalyticsStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.currentReport).not.toBeNull();
    expect(s.currentReport?.period).toBe('daily');
    expect(s.currentReport?.summary).toBeDefined();
    expect(s.currentReport?.topUsers).toEqual([]);
    expect(s.currentReport?.trends).toEqual({
      userGrowth: 0,
      costGrowth: 0,
      usageGrowth: 0,
    });
  });

  it('generateReport supports weekly and monthly periods', async () => {
    await useAnalyticsStore.getState().generateReport('weekly');
    expect(useAnalyticsStore.getState().currentReport?.period).toBe('weekly');
    await useAnalyticsStore.getState().generateReport('monthly');
    expect(useAnalyticsStore.getState().currentReport?.period).toBe('monthly');
  });
});

describe('AnalyticsManager', () => {
  let manager: AnalyticsManager;

  beforeEach(() => {
    manager = new AnalyticsManager();
  });

  it('records and retrieves usage metrics sorted by timestamp desc', () => {
    manager.recordUsageMetrics(makeUsage({ timestamp: 100 }));
    manager.recordUsageMetrics(makeUsage({ timestamp: 300 }));
    manager.recordUsageMetrics(makeUsage({ timestamp: 200 }));

    const result = manager.getUsageMetrics();
    expect(result).toHaveLength(3);
    expect(result[0].timestamp).toBe(300);
    expect(result[1].timestamp).toBe(200);
    expect(result[2].timestamp).toBe(100);
  });

  it('getUsageMetrics filters by userId', () => {
    manager.recordUsageMetrics(makeUsage({ userId: 'u1', timestamp: 100 }));
    manager.recordUsageMetrics(makeUsage({ userId: 'u2', timestamp: 200 }));

    const result = manager.getUsageMetrics({ userId: 'u1' });
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
  });

  it('getUsageMetrics filters by workspaceId', () => {
    manager.recordUsageMetrics(makeUsage({ workspaceId: 'w1', timestamp: 100 }));
    manager.recordUsageMetrics(makeUsage({ workspaceId: 'w2', timestamp: 200 }));

    const result = manager.getUsageMetrics({ workspaceId: 'w2' });
    expect(result).toHaveLength(1);
    expect(result[0].workspaceId).toBe('w2');
  });

  it('getUsageMetrics filters by date range', () => {
    manager.recordUsageMetrics(makeUsage({ timestamp: 100 }));
    manager.recordUsageMetrics(makeUsage({ timestamp: 200 }));
    manager.recordUsageMetrics(makeUsage({ timestamp: 300 }));

    const result = manager.getUsageMetrics({ startDate: 150, endDate: 250 });
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(200);
  });

  it('records and retrieves performance metrics with filters', () => {
    manager.recordPerformanceMetrics(makePerf({ workspaceId: 'w1', timestamp: 100 }));
    manager.recordPerformanceMetrics(makePerf({ workspaceId: 'w2', timestamp: 200 }));
    manager.recordPerformanceMetrics(makePerf({ workspaceId: 'w1', timestamp: 300 }));

    const filtered = manager.getPerformanceMetrics({ workspaceId: 'w1' });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].timestamp).toBe(300);

    const ranged = manager.getPerformanceMetrics({ startDate: 150, endDate: 250 });
    expect(ranged).toHaveLength(1);
    expect(ranged[0].timestamp).toBe(200);
  });

  it('records and retrieves cost tracking with filters', () => {
    manager.recordCostTracking(makeCost({ userId: 'u1', period: 'daily', timestamp: 100 }));
    manager.recordCostTracking(makeCost({ userId: 'u2', period: 'weekly', timestamp: 200 }));
    manager.recordCostTracking(makeCost({ userId: 'u1', period: 'monthly', timestamp: 300 }));

    const byUser = manager.getCostTracking({ userId: 'u1' });
    expect(byUser).toHaveLength(2);

    const byPeriod = manager.getCostTracking({ period: 'weekly' });
    expect(byPeriod).toHaveLength(1);
    expect(byPeriod[0].period).toBe('weekly');

    const byRange = manager.getCostTracking({ startDate: 150, endDate: 250 });
    expect(byRange).toHaveLength(1);
    expect(byRange[0].timestamp).toBe(200);
  });

  it('calculateCosts computes compute and AI costs from usage metrics', () => {
    const metrics = [
      makeUsage({ userId: 'uX', metrics: { sessionDuration: 3600, aiTokensUsed: 1000 } } as any),
      makeUsage({ userId: 'uX', metrics: { sessionDuration: 3600, aiTokensUsed: 1000 } } as any),
    ];
    const cost = manager.calculateCosts(metrics);
    // 2 hours compute * 0.05 = 0.1 ; 2000 tokens / 1000 * 0.003 = 0.006
    expect(cost.userId).toBe('uX');
    expect(cost.period).toBe('daily');
    expect(cost.currency).toBe('USD');
    expect(cost.costs.compute).toBeCloseTo(0.1, 5);
    expect(cost.costs.ai).toBeCloseTo(0.006, 5);
    expect(cost.costs.total).toBeCloseTo(0.106, 5);
  });

  it('calculateCosts handles empty metrics array', () => {
    const cost = manager.calculateCosts([]);
    expect(cost.userId).toBe('unknown');
    expect(cost.costs.total).toBe(0);
  });

  it('setPricing and getPricing update and return pricing config', () => {
    const original = manager.getPricing();
    expect(original.computePerHour).toBe(0.05);

    manager.setPricing({ computePerHour: 0.1 });
    const updated = manager.getPricing();
    expect(updated.computePerHour).toBe(0.1);
    // other fields preserved
    expect(updated.storagePerGB).toBe(0.02);
    // getPricing returns a copy
    updated.computePerHour = 999;
    expect(manager.getPricing().computePerHour).toBe(0.1);
  });

  it('generateAnalyticsReport aggregates usage and costs for the period', () => {
    const now = Date.now();
    manager.recordUsageMetrics(makeUsage({ userId: 'u1', workspaceId: 'w1', timestamp: now - 1000 }));
    manager.recordUsageMetrics(makeUsage({ userId: 'u2', workspaceId: 'w2', timestamp: now - 500 }));
    manager.recordCostTracking(makeCost({ userId: 'u1', timestamp: now - 1000, costs: { compute: 1, storage: 0, network: 0, ai: 0, total: 1 } }));
    manager.recordCostTracking(makeCost({ userId: 'u2', timestamp: now - 500, costs: { compute: 0, storage: 0, network: 0, ai: 2, total: 2 } }));

    const report = manager.generateAnalyticsReport('daily');
    expect(report.period).toBe('daily');
    expect(report.summary.totalUsers).toBe(2);
    expect(report.summary.activeWorkspaces).toBe(2);
    expect(report.summary.totalSessions).toBe(2);
    expect(report.summary.totalCost).toBeCloseTo(3, 5);
    expect(report.summary.averageSessionDuration).toBe(3600);
    // topUsers sorted by cost desc
    expect(report.topUsers[0].userId).toBe('u2');
    expect(report.topUsers[0].cost).toBeCloseTo(2, 5);
    expect(report.topUsers[1].userId).toBe('u1');
    expect(report.trends).toEqual({
      userGrowth: 0,
      costGrowth: 0,
      usageGrowth: 0,
    });
  });

  it('generateAnalyticsReport returns empty summary when no data', () => {
    const report = manager.generateAnalyticsReport('weekly');
    expect(report.summary.totalUsers).toBe(0);
    expect(report.summary.activeWorkspaces).toBe(0);
    expect(report.summary.totalSessions).toBe(0);
    expect(report.summary.averageSessionDuration).toBe(0);
    expect(report.summary.totalCost).toBe(0);
    expect(report.topUsers).toEqual([]);
  });
});
