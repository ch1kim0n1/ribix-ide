/**
 * Cloud Workspace Management API
 * Manages cloud development environments (Kubernetes pods/containers)
 */

import { create } from 'zustand';
import { apiUrl } from '../lib/api';

export interface WorkspaceConfig {
  id: string;
  name: string;
  userId: string;
  repository?: string;
  branch?: string;
  environment: {
    cpu: string;
    memory: string;
    storage: string;
  };
  status: 'creating' | 'running' | 'stopped' | 'error';
  createdAt: number;
  lastAccessed: number;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultResources: {
    cpu: string;
    memory: string;
    storage: string;
  };
  tools: string[];
}

export class WorkspaceManager {
  private apiBase: string;

  constructor(apiBase: string = apiUrl()) {
    this.apiBase = apiBase;
  }

  /**
   * List all workspaces for current user
   */
  async listWorkspaces(): Promise<WorkspaceConfig[]> {
    const response = await fetch(`${this.apiBase}/workspaces`);
    if (!response.ok) throw new Error('Failed to list workspaces');
    return response.json();
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(id: string): Promise<WorkspaceConfig> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}`);
    if (!response.ok) throw new Error('Failed to get workspace');
    return response.json();
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(config: {
    name: string;
    repository?: string;
    branch?: string;
    template?: string;
    environment?: {
      cpu: string;
      memory: string;
      storage: string;
    };
  }): Promise<WorkspaceConfig> {
    const response = await fetch(`${this.apiBase}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error('Failed to create workspace');
    return response.json();
  }

  /**
   * Start a workspace
   */
  async startWorkspace(id: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}/start`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to start workspace');
  }

  /**
   * Stop a workspace
   */
  async stopWorkspace(id: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}/stop`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to stop workspace');
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(id: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete workspace');
  }

  /**
   * Get workspace logs
   */
  async getWorkspaceLogs(id: string, tail?: number): Promise<string> {
    const url = tail 
      ? `${this.apiBase}/workspaces/${id}/logs?tail=${tail}`
      : `${this.apiBase}/workspaces/${id}/logs`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to get workspace logs');
    const data = await response.json();
    return data.logs;
  }

  /**
   * Execute command in workspace
   */
  async executeCommand(id: string, command: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    if (!response.ok) throw new Error('Failed to execute command');
    return response.json();
  }

  /**
   * Get available workspace templates
   */
  async getTemplates(): Promise<WorkspaceTemplate[]> {
    const response = await fetch(`${this.apiBase}/workspaces/templates`);
    if (!response.ok) throw new Error('Failed to get templates');
    return response.json();
  }

  /**
   * Get workspace metrics
   */
  async getMetrics(id: string): Promise<{
    cpu: number;
    memory: number;
    storage: number;
    network: {
      bytesIn: number;
      bytesOut: number;
    };
  }> {
    const response = await fetch(`${this.apiBase}/workspaces/${id}/metrics`);
    if (!response.ok) throw new Error('Failed to get metrics');
    return response.json();
  }
}

/**
 * Workspace Store for React
 */

interface WorkspaceState {
  workspaces: WorkspaceConfig[];
  templates: WorkspaceTemplate[];
  currentWorkspace: WorkspaceConfig | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  loadWorkspaces: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  createWorkspace: (config: any) => Promise<void>;
  startWorkspace: (id: string) => Promise<void>;
  stopWorkspace: (id: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  setCurrentWorkspace: (workspace: WorkspaceConfig | null) => void;
  setError: (error: string | null) => void;
}

const workspaceManager = new WorkspaceManager();

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  templates: [],
  currentWorkspace: null,
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

  loadWorkspaces: async () => {
    set({ isLoading: true, error: null });
    try {
      const workspaces = await workspaceManager.listWorkspaces();
      set({ workspaces, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load workspaces',
        isLoading: false,
      });
    }
  },

  loadTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const templates = await workspaceManager.getTemplates();
      set({ templates, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load templates',
        isLoading: false,
      });
    }
  },

  createWorkspace: async (config) => {
    set({ isLoading: true, error: null });
    try {
      const workspace = await workspaceManager.createWorkspace(config);
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        isLoading: false,
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to create workspace',
        isLoading: false,
      });
      throw error;
    }
  },

  startWorkspace: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await workspaceManager.startWorkspace(id);
      set((state) => ({
        workspaces: state.workspaces.map(w => 
          w.id === id ? { ...w, status: 'running' as const } : w
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to start workspace',
        isLoading: false,
      });
      throw error;
    }
  },

  stopWorkspace: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await workspaceManager.stopWorkspace(id);
      set((state) => ({
        workspaces: state.workspaces.map(w => 
          w.id === id ? { ...w, status: 'stopped' as const } : w
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to stop workspace',
        isLoading: false,
      });
      throw error;
    }
  },

  deleteWorkspace: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await workspaceManager.deleteWorkspace(id);
      set((state) => ({
        workspaces: state.workspaces.filter(w => w.id !== id),
        currentWorkspace: state.currentWorkspace?.id === id ? null : state.currentWorkspace,
        isLoading: false,
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete workspace',
        isLoading: false,
      });
      throw error;
    }
  },

  setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
}));
