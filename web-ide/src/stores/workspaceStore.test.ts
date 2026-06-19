import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkspaceStore, WorkspaceManager } from './workspaceStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const sampleWorkspace = {
  id: 'ws-1',
  name: 'My Workspace',
  userId: 'u-1',
  environment: { cpu: '1', memory: '2Gi', storage: '10Gi' },
  status: 'running' as const,
  createdAt: 1,
  lastAccessed: 2,
};

const sampleTemplate = {
  id: 'tpl-1',
  name: 'Node',
  description: 'Node.js template',
  image: 'node:18',
  defaultResources: { cpu: '1', memory: '2Gi', storage: '10Gi' },
  tools: ['node', 'npm'],
};

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [],
    templates: [],
    currentWorkspace: null,
    isLoading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkspaceManager', () => {
  it('listWorkspaces returns workspaces on OK response', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse([sampleWorkspace]));

    const mgr = new WorkspaceManager();
    const result = await mgr.listWorkspaces();

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ws-1');
  });

  it('listWorkspaces throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([], false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.listWorkspaces()).rejects.toThrow('Failed to list workspaces');
  });

  it('getWorkspace returns a workspace by id', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(sampleWorkspace));

    const mgr = new WorkspaceManager();
    const result = await mgr.getWorkspace('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1');
    expect(result.id).toBe('ws-1');
  });

  it('getWorkspace throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 404));
    const mgr = new WorkspaceManager();
    await expect(mgr.getWorkspace('missing')).rejects.toThrow('Failed to get workspace');
  });

  it('createWorkspace posts config and returns workspace', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(sampleWorkspace));

    const mgr = new WorkspaceManager();
    const result = await mgr.createWorkspace({ name: 'My Workspace' });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'My Workspace' }),
      }),
    );
    expect(result.id).toBe('ws-1');
  });

  it('createWorkspace throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 400));
    const mgr = new WorkspaceManager();
    await expect(mgr.createWorkspace({ name: 'x' })).rejects.toThrow('Failed to create workspace');
  });

  it('startWorkspace posts to start endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({}));

    const mgr = new WorkspaceManager();
    await mgr.startWorkspace('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1/start', { method: 'POST' });
  });

  it('startWorkspace throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.startWorkspace('ws-1')).rejects.toThrow('Failed to start workspace');
  });

  it('stopWorkspace posts to stop endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({}));

    const mgr = new WorkspaceManager();
    await mgr.stopWorkspace('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1/stop', { method: 'POST' });
  });

  it('stopWorkspace throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.stopWorkspace('ws-1')).rejects.toThrow('Failed to stop workspace');
  });

  it('deleteWorkspace sends DELETE request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({}));

    const mgr = new WorkspaceManager();
    await mgr.deleteWorkspace('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1', { method: 'DELETE' });
  });

  it('deleteWorkspace throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.deleteWorkspace('ws-1')).rejects.toThrow('Failed to delete workspace');
  });

  it('getWorkspaceLogs returns logs string', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ logs: 'line1\nline2' }));

    const mgr = new WorkspaceManager();
    const logs = await mgr.getWorkspaceLogs('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1/logs');
    expect(logs).toBe('line1\nline2');
  });

  it('getWorkspaceLogs appends tail query when provided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ logs: 'x' }));

    const mgr = new WorkspaceManager();
    await mgr.getWorkspaceLogs('ws-1', 50);

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1/logs?tail=50');
  });

  it('getWorkspaceLogs throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.getWorkspaceLogs('ws-1')).rejects.toThrow('Failed to get workspace logs');
  });

  it('executeCommand posts command and returns result', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ exitCode: 0, stdout: 'ok', stderr: '' }));

    const mgr = new WorkspaceManager();
    const result = await mgr.executeCommand('ws-1', 'ls');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/exec',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ command: 'ls' }),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('executeCommand throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.executeCommand('ws-1', 'ls')).rejects.toThrow('Failed to execute command');
  });

  it('getTemplates returns templates array', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse([sampleTemplate]));

    const mgr = new WorkspaceManager();
    const result = await mgr.getTemplates();

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/templates');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tpl-1');
  });

  it('getTemplates throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([], false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.getTemplates()).rejects.toThrow('Failed to get templates');
  });

  it('getMetrics returns metrics object', async () => {
    const metrics = {
      cpu: 50,
      memory: 60,
      storage: 70,
      network: { bytesIn: 100, bytesOut: 200 },
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(metrics));

    const mgr = new WorkspaceManager();
    const result = await mgr.getMetrics('ws-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/workspaces/ws-1/metrics');
    expect(result.cpu).toBe(50);
    expect(result.network.bytesIn).toBe(100);
  });

  it('getMetrics throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const mgr = new WorkspaceManager();
    await expect(mgr.getMetrics('ws-1')).rejects.toThrow('Failed to get metrics');
  });

  it('uses a custom apiBase when provided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse([]));

    const mgr = new WorkspaceManager('https://custom.example.com');
    await mgr.listWorkspaces();

    expect(fetchSpy).toHaveBeenCalledWith('https://custom.example.com/workspaces');
  });
});

describe('useWorkspaceStore', () => {
  it('starts with empty state', () => {
    const s = useWorkspaceStore.getState();
    expect(s.workspaces).toEqual([]);
    expect(s.templates).toEqual([]);
    expect(s.currentWorkspace).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('setError sets and clears error', () => {
    useWorkspaceStore.getState().setError('oops');
    expect(useWorkspaceStore.getState().error).toBe('oops');
    useWorkspaceStore.getState().setError(null);
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it('setCurrentWorkspace sets the current workspace', () => {
    useWorkspaceStore.getState().setCurrentWorkspace(sampleWorkspace);
    expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1');
  });

  it('loadWorkspaces populates workspaces on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([sampleWorkspace]));

    await useWorkspaceStore.getState().loadWorkspaces();

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it('loadWorkspaces sets error on failure (does not rethrow)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([], false, 500));

    await useWorkspaceStore.getState().loadWorkspaces();

    expect(useWorkspaceStore.getState().error).toBe('Failed to list workspaces');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
  });

  it('loadTemplates populates templates on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([sampleTemplate]));

    await useWorkspaceStore.getState().loadTemplates();

    expect(useWorkspaceStore.getState().templates).toHaveLength(1);
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('loadTemplates sets error on failure (does not rethrow)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([], false, 500));

    await useWorkspaceStore.getState().loadTemplates();

    expect(useWorkspaceStore.getState().error).toBe('Failed to get templates');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('createWorkspace adds workspace to list on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(sampleWorkspace));

    await useWorkspaceStore.getState().createWorkspace({ name: 'My Workspace' });

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('createWorkspace sets error and rethrows on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 400));

    await expect(
      useWorkspaceStore.getState().createWorkspace({ name: 'x' }),
    ).rejects.toThrow('Failed to create workspace');
    expect(useWorkspaceStore.getState().error).toBe('Failed to create workspace');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('startWorkspace updates status to running on success', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ ...sampleWorkspace, status: 'stopped' }],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    await useWorkspaceStore.getState().startWorkspace('ws-1');

    expect(useWorkspaceStore.getState().workspaces[0].status).toBe('running');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('startWorkspace sets error and rethrows on failure', async () => {
    useWorkspaceStore.setState({ workspaces: [sampleWorkspace] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useWorkspaceStore.getState().startWorkspace('ws-1'),
    ).rejects.toThrow('Failed to start workspace');
    expect(useWorkspaceStore.getState().error).toBe('Failed to start workspace');
  });

  it('stopWorkspace updates status to stopped on success', async () => {
    useWorkspaceStore.setState({ workspaces: [sampleWorkspace] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    await useWorkspaceStore.getState().stopWorkspace('ws-1');

    expect(useWorkspaceStore.getState().workspaces[0].status).toBe('stopped');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('stopWorkspace sets error and rethrows on failure', async () => {
    useWorkspaceStore.setState({ workspaces: [sampleWorkspace] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useWorkspaceStore.getState().stopWorkspace('ws-1'),
    ).rejects.toThrow('Failed to stop workspace');
    expect(useWorkspaceStore.getState().error).toBe('Failed to stop workspace');
  });

  it('deleteWorkspace removes workspace from list on success', async () => {
    useWorkspaceStore.setState({ workspaces: [sampleWorkspace] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    await useWorkspaceStore.getState().deleteWorkspace('ws-1');

    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it('deleteWorkspace clears currentWorkspace when it is the deleted one', async () => {
    useWorkspaceStore.setState({
      workspaces: [sampleWorkspace],
      currentWorkspace: sampleWorkspace,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    await useWorkspaceStore.getState().deleteWorkspace('ws-1');

    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
  });

  it('deleteWorkspace keeps currentWorkspace when deleting a different one', async () => {
    useWorkspaceStore.setState({
      workspaces: [sampleWorkspace],
      currentWorkspace: sampleWorkspace,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    await useWorkspaceStore.getState().deleteWorkspace('other-id');

    expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1');
  });

  it('deleteWorkspace sets error and rethrows on failure', async () => {
    useWorkspaceStore.setState({ workspaces: [sampleWorkspace] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useWorkspaceStore.getState().deleteWorkspace('ws-1'),
    ).rejects.toThrow('Failed to delete workspace');
    expect(useWorkspaceStore.getState().error).toBe('Failed to delete workspace');
  });
});
