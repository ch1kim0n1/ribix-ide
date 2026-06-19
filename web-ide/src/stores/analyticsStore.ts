/**
 * Advanced Analytics
 * Usage metrics, performance monitoring, and cost tracking
 */

export interface UsageMetrics {
  timestamp: number;
  userId: string;
  workspaceId: string;
  metrics: {
    sessionDuration: number;
    filesEdited: number;
    linesChanged: number;
    aiRequests: number;
    aiTokensUsed: number;
    collaborationMinutes: number;
    terminalCommands: number;
  };
}

export interface PerformanceMetrics {
  timestamp: number;
  workspaceId: string;
  metrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkBytesIn: number;
    networkBytesOut: number;
    responseTime: number;
    errorRate: number;
  };
}

export interface CostTracking {
  timestamp: number;
  userId: string;
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  costs: {
    compute: number;
    storage: number;
    network: number;
    ai: number;
    total: number;
  };
  currency: string;
}

export interface AnalyticsReport {
  period: string;
  summary: {
    totalUsers: number;
    activeWorkspaces: number;
    totalSessions: number;
    averageSessionDuration: number;
    totalCost: number;
  };
  topUsers: Array<{
    userId: string;
    usage: number;
    cost: number;
  }>;
  trends: {
    userGrowth: number;
    costGrowth: number;
    usageGrowth: number;
  };
}

export class AnalyticsManager {
  private usageMetrics: UsageMetrics[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  private costTracking: CostTracking[] = [];
  private pricing: {
    computePerHour: number;
    storagePerGB: number;
    networkPerGB: number;
    aiPer1kTokens: number;
  } = {
    computePerHour: 0.05,
    storagePerGB: 0.02,
    networkPerGB: 0.01,
    aiPer1kTokens: 0.003,
  };

  /**
   * Record usage metrics
   */
  recordUsageMetrics(metrics: UsageMetrics): void {
    this.usageMetrics.push(metrics);
  }

  /**
   * Record performance metrics
   */
  recordPerformanceMetrics(metrics: PerformanceMetrics): void {
    this.performanceMetrics.push(metrics);
  }

  /**
   * Record cost tracking
   */
  recordCostTracking(costs: CostTracking): void {
    this.costTracking.push(costs);
  }

  /**
   * Get usage metrics for period
   */
  getUsageMetrics(filters?: {
    userId?: string;
    workspaceId?: string;
    startDate?: number;
    endDate?: number;
  }): UsageMetrics[] {
    let metrics = [...this.usageMetrics];

    if (filters?.userId) {
      metrics = metrics.filter(m => m.userId === filters.userId);
    }
    if (filters?.workspaceId) {
      metrics = metrics.filter(m => m.workspaceId === filters.workspaceId);
    }
    const startDate = filters?.startDate;
    if (startDate !== undefined) {
      metrics = metrics.filter(m => m.timestamp >= startDate);
    }
    const endDate = filters?.endDate;
    if (endDate !== undefined) {
      metrics = metrics.filter(m => m.timestamp <= endDate);
    }

    return metrics.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get performance metrics for period
   */
  getPerformanceMetrics(filters?: {
    workspaceId?: string;
    startDate?: number;
    endDate?: number;
  }): PerformanceMetrics[] {
    let metrics = [...this.performanceMetrics];

    if (filters?.workspaceId) {
      metrics = metrics.filter(m => m.workspaceId === filters.workspaceId);
    }
    const perfStartDate = filters?.startDate;
    if (perfStartDate !== undefined) {
      metrics = metrics.filter(m => m.timestamp >= perfStartDate);
    }
    const perfEndDate = filters?.endDate;
    if (perfEndDate !== undefined) {
      metrics = metrics.filter(m => m.timestamp <= perfEndDate);
    }

    return metrics.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get cost tracking for period
   */
  getCostTracking(filters?: {
    userId?: string;
    period?: 'hourly' | 'daily' | 'weekly' | 'monthly';
    startDate?: number;
    endDate?: number;
  }): CostTracking[] {
    let costs = [...this.costTracking];

    if (filters?.userId) {
      costs = costs.filter(c => c.userId === filters.userId);
    }
    if (filters?.period) {
      costs = costs.filter(c => c.period === filters.period);
    }
    const costStartDate = filters?.startDate;
    if (costStartDate !== undefined) {
      costs = costs.filter(c => c.timestamp >= costStartDate);
    }
    const costEndDate = filters?.endDate;
    if (costEndDate !== undefined) {
      costs = costs.filter(c => c.timestamp <= costEndDate);
    }

    return costs.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Calculate costs from usage metrics
   */
  calculateCosts(metrics: UsageMetrics[]): CostTracking {
    const totalComputeHours = metrics.reduce((sum, m) => sum + (m.metrics.sessionDuration / 3600), 0);
    const totalAITokens = metrics.reduce((sum, m) => sum + m.metrics.aiTokensUsed, 0);

    const computeCost = totalComputeHours * this.pricing.computePerHour;
    const aiCost = (totalAITokens / 1000) * this.pricing.aiPer1kTokens;

    return {
      timestamp: Date.now(),
      userId: metrics[0]?.userId || 'unknown',
      period: 'daily',
      costs: {
        compute: computeCost,
        storage: 0,
        network: 0,
        ai: aiCost,
        total: computeCost + aiCost,
      },
      currency: 'USD',
    };
  }

  /**
   * Generate analytics report
   */
  generateAnalyticsReport(period: 'daily' | 'weekly' | 'monthly'): AnalyticsReport {
    const now = Date.now();
    const startDate = period === 'daily' 
      ? now - 24 * 60 * 60 * 1000
      : period === 'weekly'
      ? now - 7 * 24 * 60 * 60 * 1000
      : now - 30 * 24 * 60 * 60 * 1000;

    const usageMetrics = this.getUsageMetrics({ startDate, endDate: now });
    const costTracking = this.getCostTracking({ startDate, endDate: now });

    const totalCost = costTracking.reduce((sum, c) => sum + c.costs.total, 0);
    const uniqueUsers = new Set(usageMetrics.map(m => m.userId));
    const uniqueWorkspaces = new Set(usageMetrics.map(m => m.workspaceId));

    return {
      period,
      summary: {
        totalUsers: uniqueUsers.size,
        activeWorkspaces: uniqueWorkspaces.size,
        totalSessions: usageMetrics.length,
        averageSessionDuration: usageMetrics.length > 0
          ? usageMetrics.reduce((sum, m) => sum + m.metrics.sessionDuration, 0) / usageMetrics.length
          : 0,
        totalCost,
      },
      topUsers: this.getTopUsers(usageMetrics, costTracking),
      trends: {
        userGrowth: this.calculateGrowth(uniqueUsers.size, period),
        costGrowth: this.calculateGrowth(totalCost, period),
        usageGrowth: this.calculateGrowth(usageMetrics.length, period),
      },
    };
  }

  /**
   * Get top users by usage and cost
   */
  private getTopUsers(usageMetrics: UsageMetrics[], costTracking: CostTracking[]): Array<{
    userId: string;
    usage: number;
    cost: number;
  }> {
    const userUsage = new Map<string, number>();
    const userCosts = new Map<string, number>();

    usageMetrics.forEach(m => {
      userUsage.set(m.userId, (userUsage.get(m.userId) || 0) + 1);
    });

    costTracking.forEach(c => {
      userCosts.set(c.userId, (userCosts.get(c.userId) || 0) + c.costs.total);
    });

    const users = Array.from(userUsage.keys()).map(userId => ({
      userId,
      usage: userUsage.get(userId) || 0,
      cost: userCosts.get(userId) || 0,
    }));

    return users.sort((a, b) => b.cost - a.cost).slice(0, 10);
  }

  /**
   * Calculate growth rate
   */
  private calculateGrowth(_current: number, _period: string): number {
    // Simplified growth calculation
    // In production, this would compare with previous period
    return 0;
  }

  /**
   * Set pricing configuration
   */
  setPricing(pricing: Partial<typeof this.pricing>): void {
    this.pricing = { ...this.pricing, ...pricing };
  }

  /**
   * Get pricing configuration
   */
  getPricing(): typeof this.pricing {
    return { ...this.pricing };
  }
}

/**
 * Analytics Store for React
 */
import { create } from 'zustand';

interface AnalyticsState {
  usageMetrics: UsageMetrics[];
  performanceMetrics: PerformanceMetrics[];
  costTracking: CostTracking[];
  currentReport: AnalyticsReport | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  loadUsageMetrics: (filters?: any) => Promise<void>;
  loadPerformanceMetrics: (filters?: any) => Promise<void>;
  loadCostTracking: (filters?: any) => Promise<void>;
  generateReport: (period: 'daily' | 'weekly' | 'monthly') => Promise<void>;
  setError: (error: string | null) => void;
}

const analyticsManager = new AnalyticsManager();

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  usageMetrics: [],
  performanceMetrics: [],
  costTracking: [],
  currentReport: null,
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

  loadUsageMetrics: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const metrics = analyticsManager.getUsageMetrics(filters);
      set({ usageMetrics: metrics, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load usage metrics',
        isLoading: false,
      });
    }
  },

  loadPerformanceMetrics: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const metrics = analyticsManager.getPerformanceMetrics(filters);
      set({ performanceMetrics: metrics, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load performance metrics',
        isLoading: false,
      });
    }
  },

  loadCostTracking: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const costs = analyticsManager.getCostTracking(filters);
      set({ costTracking: costs, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load cost tracking',
        isLoading: false,
      });
    }
  },

  generateReport: async (period) => {
    set({ isLoading: true, error: null });
    try {
      const report = analyticsManager.generateAnalyticsReport(period);
      set({ currentReport: report, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to generate report',
        isLoading: false,
      });
    }
  },
}));