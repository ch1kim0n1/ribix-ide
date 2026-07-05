/**
 * Data persistence tests (issue #83 — "Verify user files survive restart").
 *
 * These tests verify that the fileSystemStore and authStore
 * correctly persist state to localStorage and restore it on "restart"
 * (simulated by clearing the in-memory store and re-loading from storage).
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Minimal localStorage stub — simulates a browser localStorage that
// survives across page reloads (the key behavior we're testing).
const storage: Record<string, string> = {};
const localStorageStub = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  writable: true,
  configurable: true,
});

// sessionStorage stub for the auth token (C3). sessionStorage is tab-scoped
// and cleared when the tab closes, so it does NOT survive a full browser
// restart — only an in-tab reload.
const session: Record<string, string> = {};
const sessionStorageStub = {
  getItem: (key: string) => session[key] ?? null,
  setItem: (key: string, value: string) => { session[key] = value; },
  removeItem: (key: string) => { delete session[key]; },
  clear: () => { for (const k of Object.keys(session)) delete session[k]; },
};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageStub,
  writable: true,
  configurable: true,
});

// Stub window so stores that guard on `typeof window` will persist.
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageStub, sessionStorage: sessionStorageStub },
  writable: true,
  configurable: true,
});

describe('Data Persistence Across Restart', () => {
  beforeEach(() => {
    localStorageStub.clear();
    sessionStorageStub.clear();
  });

  it('fileSystemStore persists root files to localStorage and restores them', async () => {
    const { useFileSystemStore } = await import('./fileSystemStore');

    // Simulate initial session: create a file structure
    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        type: 'directory',
        path: '/',
        children: [
          { name: 'main.ts', type: 'file', content: 'console.log("hello");', path: '/main.ts' },
          { name: 'README.md', type: 'file', content: '# My Project', path: '/README.md' },
        ],
      },
      currentPath: [],
    });

    // Save to storage
    useFileSystemStore.getState().saveToStorage();

    // Verify it was written
    const raw = localStorageStub.getItem('ribix_filesystem_state');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.root.children).toHaveLength(2);
    expect(parsed.root.children[0].name).toBe('main.ts');

    // Simulate restart: reset in-memory state to empty
    useFileSystemStore.setState({
      root: { name: '', type: 'directory', path: '', children: [] },
      currentPath: [],
    });

    // Load from storage
    useFileSystemStore.getState().loadFromStorage();

    // Verify state was restored
    const restored = useFileSystemStore.getState();
    expect(restored.root.name).toBe('workspace');
    expect(restored.root.children).toHaveLength(2);
    expect(restored.root.children?.[0].name).toBe('main.ts');
    expect(restored.root.children?.[0].content).toBe('console.log("hello");');
  });

  it('fileSystemStore survives multiple save/load cycles without data loss', async () => {
    const { useFileSystemStore } = await import('./fileSystemStore');

    // Cycle 1
    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        type: 'directory',
        path: '/',
        children: [{ name: 'a.ts', type: 'file', content: 'a', path: '/a.ts' }],
      },
      currentPath: [],
    });
    useFileSystemStore.getState().saveToStorage();

    // Cycle 2 — add more files
    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        type: 'directory',
        path: '/',
        children: [
          { name: 'a.ts', type: 'file', content: 'a', path: '/a.ts' },
          { name: 'b.ts', type: 'file', content: 'b', path: '/b.ts' },
        ],
      },
      currentPath: [],
    });
    useFileSystemStore.getState().saveToStorage();

    // Cycle 3 — restart and load
    useFileSystemStore.setState({
      root: { name: '', type: 'directory', path: '', children: [] },
      currentPath: [],
    });
    useFileSystemStore.getState().loadFromStorage();

    const restored = useFileSystemStore.getState();
    expect(restored.root.children).toHaveLength(2);
    expect(restored.root.children?.[1].name).toBe('b.ts');
  });

  it('fileSystemStore handles corrupted localStorage gracefully', async () => {
    const { useFileSystemStore } = await import('./fileSystemStore');

    // Clear in-memory state first
    useFileSystemStore.setState({
      root: { name: '', type: 'directory', path: '', children: [] },
      currentPath: [],
      error: null,
    });

    // Write corrupted data
    localStorageStub.setItem('ribix_filesystem_state', '{invalid json}');

    // Should not throw — the store catches parse errors internally
    expect(() => useFileSystemStore.getState().loadFromStorage()).not.toThrow();

    // State should remain empty, not crashed
    const state = useFileSystemStore.getState();
    expect(state.root.name).toBe('');
  });

  it('fileSystemStore clearStorage removes persisted state', async () => {
    const { useFileSystemStore } = await import('./fileSystemStore');

    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        type: 'directory',
        path: '/',
        children: [],
      },
      currentPath: [],
    });
    useFileSystemStore.getState().saveToStorage();
    expect(localStorageStub.getItem('ribix_filesystem_state')).not.toBeNull();

    useFileSystemStore.getState().clearStorage();
    expect(localStorageStub.getItem('ribix_filesystem_state')).toBeNull();
  });

  it('authStore token persists in sessionStorage across in-tab reload (C3)', async () => {
    const { useAuthStore } = await import('./authStore');

    // Simulate login
    useAuthStore.getState().setToken('my-jwt-token-12345');
    useAuthStore.setState({
      user: { id: 'u1', email: 'test@ribix.dev', name: 'Test' },
      isAuthenticated: true,
    });

    // C3: token is persisted to sessionStorage (NOT localStorage).
    expect(sessionStorageStub.getItem('ribix_token')).toBe('my-jwt-token-12345');
    expect(localStorageStub.getItem('ribix_token')).toBeNull();
    // Non-sensitive authenticated flag remains in localStorage.
    expect(localStorageStub.getItem('ribix_authenticated')).toBe('1');

    // Simulate in-tab reload: clear in-memory state only (storage persists).
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });

    // The token should still be in sessionStorage (survives reload within tab).
    expect(sessionStorageStub.getItem('ribix_token')).toBe('my-jwt-token-12345');
  });

  it('authStore clearAuth removes token from sessionStorage (C3)', async () => {
    const { useAuthStore } = await import('./authStore');

    useAuthStore.getState().setToken('temp-token');
    expect(sessionStorageStub.getItem('ribix_token')).toBe('temp-token');
    expect(localStorageStub.getItem('ribix_token')).toBeNull();

    useAuthStore.getState().clearAuth();
    expect(sessionStorageStub.getItem('ribix_token')).toBeNull();
    expect(localStorageStub.getItem('ribix_token')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
