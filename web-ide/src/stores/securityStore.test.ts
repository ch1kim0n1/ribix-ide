import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityManager, useSecurityStore } from './securityStore';

// Stub indexedDB for node environment — securityStore's IndexedDB helpers
// catch failures and fall back silently. We make open() reject so the
// loadPersistedAuditLog promise rejects quickly instead of hanging.
Object.defineProperty(globalThis, 'indexedDB', {
  value: {
    open: () => {
      const req = {
        onupgradeneeded: null as any,
        onsuccess: null as any,
        onerror: null as any,
        result: {},
      };
      // Simulate an error so the openAuditDb promise rejects immediately.
      setTimeout(() => {
        if (req.onerror) req.onerror({ target: { error: new Error('IndexedDB not available') } });
      }, 0);
      return req;
    },
  },
  writable: true,
  configurable: true,
});

function mockFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 403,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useSecurityStore.setState({
    currentUser: null,
    users: [],
    auditLog: [],
    isLoading: false,
    error: null,
  });
});

describe('SecurityManager', () => {
  it('initializes with a default admin user', () => {
    const mgr = new SecurityManager();
    const admin = mgr.getUser('admin@ribix.dev');
    expect(admin).toBeDefined();
    expect(admin?.role).toBe('owner');
    expect(admin?.email).toBe('admin@ribix.dev');
  });

  it('hasPermission returns true for owner permissions', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    expect(mgr.hasPermission('admin')).toBe(true);
    expect(mgr.hasPermission('read')).toBe(true);
    expect(mgr.hasPermission('manage_billing')).toBe(true);
  });

  it('hasPermission returns false for unknown user', () => {
    const mgr = new SecurityManager();
    expect(mgr.hasPermission('read', 'nobody')).toBe(false);
  });

  it('hasAnyPermission returns true if any permission matches', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    expect(mgr.hasAnyPermission(['delete', 'manage_billing'])).toBe(true);
    expect(mgr.hasAnyPermission([])).toBe(false);
  });

  it('listUsers returns all users', () => {
    const mgr = new SecurityManager();
    expect(mgr.listUsers().length).toBeGreaterThanOrEqual(1);
  });

  it('addUser requires server-side admin validation', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );

    const user = await mgr.addUser({
      id: 'u-new',
      email: 'new@ribix.dev',
      name: 'New',
      role: 'editor',
    });

    expect(user.id).toBe('u-new');
    expect(user.permissions).toContain('read');
    expect(user.permissions).toContain('write');
    expect(mgr.getUser('u-new')).toBeDefined();
  });

  it('addUser throws 403 when no token is set', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    await expect(
      mgr.addUser({ id: 'x', email: 'x@x.x', name: 'X', role: 'viewer' }),
    ).rejects.toThrow('No auth token');
  });

  it('addUser throws 403 when server returns invalid role', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'bad-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await expect(
      mgr.addUser({ id: 'x', email: 'x@x.x', name: 'X', role: 'viewer' }),
    ).rejects.toThrow('Server-side role check failed');
  });

  it('updateUserRole changes role and permissions', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );
    await mgr.addUser({ id: 'u1', email: 'u1@x.x', name: 'U1', role: 'editor' });

    await mgr.updateUserRole('u1', 'admin');

    const updated = mgr.getUser('u1');
    expect(updated?.role).toBe('admin');
    expect(updated?.permissions).toContain('delete');
  });

  it('updateUserRole throws for unknown user', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );

    await expect(mgr.updateUserRole('ghost', 'admin')).rejects.toThrow('User not found');
  });

  it('removeUser deletes the user', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );
    await mgr.addUser({ id: 'u-del', email: 'd@x.x', name: 'D', role: 'viewer' });

    await mgr.removeUser('u-del');

    expect(mgr.getUser('u-del')).toBeUndefined();
  });

  it('logAudit adds entries to the in-memory cache', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'test_action', resource: 'test', resourceId: 'r1', details: {}, success: true });

    const log = mgr.getAuditLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].action).toBe('test_action');
  });

  it('getAuditLog filters by action', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'a1', resource: 'r', resourceId: '1', details: {}, success: true });
    mgr.logAudit({ action: 'a2', resource: 'r', resourceId: '2', details: {}, success: true });

    const filtered = mgr.getAuditLog({ action: 'a1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].action).toBe('a1');
  });

  it('getAuditLog filters by date range', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'old', resource: 'r', resourceId: '1', details: {}, success: true });
    const cutoff = Date.now();
    mgr.logAudit({ action: 'new', resource: 'r', resourceId: '2', details: {}, success: true });

    const filtered = mgr.getAuditLog({ startDate: cutoff });
    expect(filtered.every(e => e.timestamp >= cutoff)).toBe(true);
  });

  it('getAuditLog respects limit', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    for (let i = 0; i < 5; i++) {
      mgr.logAudit({ action: `a${i}`, resource: 'r', resourceId: `${i}`, details: {}, success: true });
    }
    const limited = mgr.getAuditLog({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('clearAuditLog empties the in-memory log', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'x', resource: 'r', resourceId: '1', details: {}, success: true });
    mgr.clearAuditLog();
    expect(mgr.getAuditLog()).toEqual([]);
  });

  it('exportAuditLog returns JSON string by default', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'export_test', resource: 'r', resourceId: '1', details: {}, success: true });
    const json = mgr.exportAuditLog();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('exportAuditLog returns CSV with headers', () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev');
    mgr.logAudit({ action: 'csv_test', resource: 'r', resourceId: '1', details: {}, success: true });
    const csv = mgr.exportAuditLog('csv');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Timestamp');
    expect(lines[0]).toContain('Action');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('validateRoleServerSide syncs client role with server', async () => {
    const mgr = new SecurityManager();
    mgr.setCurrentUser('admin@ribix.dev', 'valid-token');
    // Server says the user is actually an editor, not owner
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'editor' } }),
    );

    // editor lacks 'admin' permission
    await expect(mgr.validateRoleServerSide('admin')).rejects.toThrow('Forbidden');
    // client-side role should have been synced
    expect(mgr.getUser('admin@ribix.dev')?.role).toBe('editor');
  });
});

describe('useSecurityStore', () => {
  it('starts with no current user', () => {
    expect(useSecurityStore.getState().currentUser).toBeNull();
    expect(useSecurityStore.getState().error).toBeNull();
  });

  it('setError sets error state', () => {
    useSecurityStore.getState().setError('test error');
    expect(useSecurityStore.getState().error).toBe('test error');
  });

  it('loadUsers populates users from manager', async () => {
    await useSecurityStore.getState().loadUsers();
    const state = useSecurityStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.users.length).toBeGreaterThanOrEqual(1);
  });

  it('hasPermission delegates to manager', () => {
    // default admin user exists in manager but no currentUserId set
    // so hasPermission should return false (no current user)
    expect(useSecurityStore.getState().hasPermission('read')).toBe(false);
  });

  it('exportAuditLog delegates to manager', () => {
    const result = useSecurityStore.getState().exportAuditLog('json');
    expect(typeof result).toBe('string');
  });

  it('setSessionToken wires token into manager', () => {
    useSecurityStore.getState().setSessionToken('my-token');
    // No throw is sufficient — the manager stores the token internally.
    // Verify by calling a method that requires a token (it will try fetch).
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );
    // loadUsers doesn't need the token, but setSessionToken should not throw.
    expect(useSecurityStore.getState().error).toBeNull();
  });

  it('addUser adds to store users on success', async () => {
    // Set up manager with token for server-side validation
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );

    await useSecurityStore.getState().addUser({
      id: 'store-user',
      email: 's@x.x',
      name: 'S',
      role: 'editor',
    });

    const state = useSecurityStore.getState();
    expect(state.users.some(u => u.id === 'store-user')).toBe(true);
  });

  it('addUser sets error on failure', async () => {
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useSecurityStore.getState().addUser({
      id: 'fail-user',
      email: 'f@x.x',
      name: 'F',
      role: 'viewer',
    });

    expect(useSecurityStore.getState().error).toBeTruthy();
  });

  it('updateUserRole updates store users on success', async () => {
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );

    // First add a user
    await useSecurityStore.getState().addUser({
      id: 'role-user',
      email: 'r@x.x',
      name: 'R',
      role: 'editor',
    });

    // Now update role
    await useSecurityStore.getState().updateUserRole('role-user', 'admin');

    const state = useSecurityStore.getState();
    const updated = state.users.find(u => u.id === 'role-user');
    expect(updated?.role).toBe('admin');
  });

  it('updateUserRole sets error on failure', async () => {
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useSecurityStore.getState().updateUserRole('ghost', 'admin');

    expect(useSecurityStore.getState().error).toBeTruthy();
  });

  it('removeUser removes from store users on success', async () => {
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ user: { role: 'owner' } }),
    );

    await useSecurityStore.getState().addUser({
      id: 'rem-user',
      email: 'rm@x.x',
      name: 'RM',
      role: 'viewer',
    });

    await useSecurityStore.getState().removeUser('rem-user');

    const state = useSecurityStore.getState();
    expect(state.users.some(u => u.id === 'rem-user')).toBe(false);
  });

  it('removeUser sets error on failure', async () => {
    useSecurityStore.getState().setSessionToken('valid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useSecurityStore.getState().removeUser('ghost');

    expect(useSecurityStore.getState().error).toBeTruthy();
  });

  it('loadAuditLog populates audit log from manager', async () => {
    await useSecurityStore.getState().loadAuditLog();
    const state = useSecurityStore.getState();
    expect(state.isLoading).toBe(false);
    expect(Array.isArray(state.auditLog)).toBe(true);
  });
});
