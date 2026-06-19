import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from './authStore';

// Minimal localStorage stub for node environment (authStore uses localStorage).
const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  writable: true,
  configurable: true,
});

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    token: null,
    workspace: null,
    isLoading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAuthStore', () => {
  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
  });

  it('setToken stores token and sets authenticated', () => {
    useAuthStore.getState().setToken('abc123');
    const state = useAuthStore.getState();
    expect(state.token).toBe('abc123');
    expect(state.isAuthenticated).toBe(true);
    expect(localStorage.getItem('ribix_token')).toBe('abc123');
  });

  it('clearAuth removes token and resets state', () => {
    useAuthStore.getState().setToken('abc123');
    useAuthStore.getState().clearAuth();
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(localStorage.getItem('ribix_token')).toBeNull();
  });

  it('setLoading and setError update state', () => {
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
    useAuthStore.getState().setError('oops');
    expect(useAuthStore.getState().error).toBe('oops');
  });

  it('login succeeds and stores user/token/workspace', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockFetchResponse({
          token: 'tok-1',
          user: { id: 'u1', email: 'a@b.c', name: 'A' },
          workspace: { id: 'ws1', name: 'WS', role: 'owner' },
        }),
      );

    await useAuthStore.getState().login('a@b.c', 'password');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('tok-1');
    expect(state.user?.email).toBe('a@b.c');
    expect(state.workspace?.id).toBe('ws1');
    expect(state.isLoading).toBe(false);
  });

  it('login sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: 'bad creds' }, false, 401),
    );

    await expect(useAuthStore.getState().login('a@b.c', 'wrong')).rejects.toThrow('bad creds');
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBe('bad creds');
    expect(state.isLoading).toBe(false);
  });

  it('register succeeds and stores session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        token: 'tok-2',
        user: { id: 'u2', email: 'x@y.z', name: 'X' },
        workspace: { id: 'ws2', name: 'WS2', role: 'owner' },
      }),
    );

    await useAuthStore.getState().register('x@y.z', 'password', 'X');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('tok-2');
  });

  it('register sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: 'email taken' }, false, 400),
    );

    await expect(
      useAuthStore.getState().register('x@y.z', 'password', 'X'),
    ).rejects.toThrow('email taken');
    expect(useAuthStore.getState().error).toBe('email taken');
  });

  it('logout clears auth even if server call fails', async () => {
    useAuthStore.getState().setToken('tok-3');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('logout calls server with token then clears', async () => {
    useAuthStore.getState().setToken('tok-4');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useAuthStore.getState().logout();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-4' }),
      }),
    );
    expect(useAuthStore.getState().token).toBeNull();
  });
});
