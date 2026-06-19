/**
 * Advanced Security Features
 * RBAC (Role-Based Access Control) and Audit Logging
 *
 * Persistence: audit log entries are written to IndexedDB so they survive page
 * reloads and do not live only in JavaScript heap memory.
 *
 * Server-side RBAC: before any permission-gated action is accepted the current
 * user's role is validated against the backend `/web-ide/auth/me` endpoint so
 * that a client-side role mutation cannot grant elevated access.
 */

// ---------------------------------------------------------------------------
// IndexedDB helpers for audit log persistence
// ---------------------------------------------------------------------------

const AUDIT_DB_NAME = 'ribix-security';
const AUDIT_DB_VERSION = 1;
const AUDIT_STORE_NAME = 'audit-log';

function openAuditDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIT_DB_NAME, AUDIT_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AUDIT_STORE_NAME)) {
        const store = db.createObjectStore(AUDIT_STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
        store.createIndex('by_userId', 'userId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistAuditEntry(entry: AuditLogEntry): Promise<void> {
  try {
    const db = await openAuditDb();
    const tx = db.transaction(AUDIT_STORE_NAME, 'readwrite');
    tx.objectStore(AUDIT_STORE_NAME).put(entry);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable (SSR, test env, private browsing with storage blocked)
    // fall back silently; the in-memory copy remains available.
  }
}

async function clearPersistedAuditLog(): Promise<void> {
  const db = await openAuditDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORE_NAME, 'readwrite');
    tx.objectStore(AUDIT_STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadPersistedAuditLog(): Promise<AuditLogEntry[]> {
  try {
    const db = await openAuditDb();
    const tx = db.transaction(AUDIT_STORE_NAME, 'readonly');
    const req = tx.objectStore(AUDIT_STORE_NAME).getAll();
    const entries = await new Promise<AuditLogEntry[]>((res, rej) => {
      req.onsuccess = () => res(req.result as AuditLogEntry[]);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Server-side RBAC validation
// ---------------------------------------------------------------------------

/** Returns the user's role as recorded on the backend, or null on failure. */
async function fetchServerRole(token: string): Promise<Role | null> {
  try {
    const webIdeBase =
      (typeof import.meta !== 'undefined' &&
        (import.meta as any).env?.VITE_WEB_IDE_API_BASE_URL) ||
      '/web-ide';
    const resp = await fetch(`${webIdeBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { user?: { role?: string } };
    const role = data?.user?.role as Role | undefined;
    return role ?? null;
  } catch {
    return null;
  }
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer' | 'guest';

export type Permission = 
  | 'read'
  | 'write'
  | 'delete'
  | 'admin'
  | 'invite'
  | 'manage_settings'
  | 'manage_billing';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, any>;
  ip?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export interface RolePermissions {
  [key: string]: Permission[];
}

const ROLE_PERMISSIONS: RolePermissions = {
  owner: ['read', 'write', 'delete', 'admin', 'invite', 'manage_settings', 'manage_billing'],
  admin: ['read', 'write', 'delete', 'admin', 'invite', 'manage_settings'],
  editor: ['read', 'write'],
  viewer: ['read'],
  guest: ['read'],
};

export class SecurityManager {
  private users: Map<string, User> = new Map();
  /** In-memory cache; IndexedDB is the durable store. */
  private auditLog: AuditLogEntry[] = [];
  private currentUserId: string | null = null;
  /** JWT for the current session, used by server-side RBAC validation. */
  private currentToken: string | null = null;

  constructor() {
    // Initialize with default admin user
    this.users.set('admin@ribix.dev', {
      id: 'admin',
      email: 'admin@ribix.dev',
      name: 'Admin',
      role: 'owner',
      permissions: ROLE_PERMISSIONS.owner,
    });

    // Restore persisted audit log from IndexedDB on construction.
    // Replace the in-memory array entirely so there are no duplicate entries
    // even if logAudit() fires synchronously before the Promise resolves.
    loadPersistedAuditLog().then(entries => {
      this.auditLog = entries;
    }).catch(() => { /* silent – in-memory fallback */ });
  }

  /** Read-only accessor so the store can retrieve the current user id without bracket access. */
  get userId(): string | null {
    return this.currentUserId;
  }

  /**
   * Set current user and the JWT token for server-side validation.
   */
  setCurrentUser(userId: string, token?: string): void {
    this.currentUserId = userId;
    if (token !== undefined) {
      this.currentToken = token;
    }
  }

  /**
   * Validate the current user's role against the backend.
   * Throws an Error with code 403 if the server disagrees or the token is
   * invalid/missing.  Guards all mutating operations.
   */
  async validateRoleServerSide(requiredPermission: Permission): Promise<void> {
    if (!this.currentToken) {
      throw Object.assign(new Error('No auth token — cannot validate role server-side'), { code: 403 });
    }
    const serverRole = await fetchServerRole(this.currentToken);
    if (!serverRole) {
      throw Object.assign(new Error('Server-side role check failed — token may be invalid'), { code: 403 });
    }
    const serverPermissions = ROLE_PERMISSIONS[serverRole] ?? [];
    // Keep client-side user record in sync with authoritative server role
    // before the permission check so the client always reflects the server
    // even when the check subsequently fails.
    if (this.currentUserId) {
      const user = this.users.get(this.currentUserId);
      if (user && user.role !== serverRole) {
        user.role = serverRole;
        user.permissions = serverPermissions;
      }
    }
    if (!serverPermissions.includes(requiredPermission)) {
      throw Object.assign(
        new Error(`Forbidden: server role '${serverRole}' lacks permission '${requiredPermission}'`),
        { code: 403 },
      );
    }
  }

  /**
   * Check if user has permission (client-side, synchronous).
   */
  hasPermission(permission: Permission, userId?: string): boolean {
    const user = this.users.get(userId || this.currentUserId || '');
    if (!user) return false;
    return user.permissions.includes(permission);
  }

  /**
   * Check if user has any of the specified permissions (client-side).
   */
  hasAnyPermission(permissions: Permission[], userId?: string): boolean {
    const user = this.users.get(userId || this.currentUserId || '');
    if (!user) return false;
    return permissions.some(p => user.permissions.includes(p));
  }

  /**
   * Add user — requires 'admin' permission validated server-side.
   */
  async addUser(user: Omit<User, 'permissions'>): Promise<User> {
    await this.validateRoleServerSide('admin');
    const permissions = ROLE_PERMISSIONS[user.role];
    const newUser: User = {
      ...user,
      permissions,
    };
    this.users.set(user.id, newUser);
    this.logAudit({
      action: 'user_created',
      resource: 'user',
      resourceId: user.id,
      details: { role: user.role },
      success: true,
    });
    return newUser;
  }

  /**
   * Update user role — requires 'admin' permission validated server-side.
   */
  async updateUserRole(userId: string, newRole: Role): Promise<void> {
    await this.validateRoleServerSide('admin');
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    user.role = newRole;
    user.permissions = ROLE_PERMISSIONS[newRole];

    this.logAudit({
      action: 'role_updated',
      resource: 'user',
      resourceId: userId,
      details: { newRole },
      success: true,
    });
  }

  /**
   * Remove user — requires 'admin' permission validated server-side.
   */
  async removeUser(userId: string): Promise<void> {
    await this.validateRoleServerSide('admin');
    this.users.delete(userId);
    this.logAudit({
      action: 'user_deleted',
      resource: 'user',
      resourceId: userId,
      details: {},
      success: true,
    });
  }

  /**
   * Get user
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * List users
   */
  listUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Log audit entry — persists to IndexedDB so entries survive page reload.
   */
  logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'userId' | 'userEmail'>): void {
    const user = this.users.get(this.currentUserId || '');
    const auditEntry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      userId: this.currentUserId || 'system',
      userEmail: user?.email || 'system',
      ...entry,
    };
    // Keep in-memory cache up to date
    this.auditLog.push(auditEntry);
    // Fire-and-forget persistence to IndexedDB
    persistAuditEntry(auditEntry);
  }

  /**
   * Get audit log (from in-memory cache; call loadPersistedAuditLog() first
   * if you need entries from before the current session).
   */
  getAuditLog(filters?: {
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): AuditLogEntry[] {
    let log = [...this.auditLog];

    if (filters?.userId) {
      log = log.filter(entry => entry.userId === filters.userId);
    }
    if (filters?.action) {
      log = log.filter(entry => entry.action === filters.action);
    }
    if (filters?.resource) {
      log = log.filter(entry => entry.resource === filters.resource);
    }
    if (filters?.startDate) {
      log = log.filter(entry => entry.timestamp >= (filters.startDate as number));
    }
    if (filters?.endDate) {
      log = log.filter(entry => entry.timestamp <= (filters.endDate as number));
    }

    log = log.sort((a, b) => b.timestamp - a.timestamp);

    if (filters?.limit) {
      log = log.slice(0, filters.limit);
    }

    return log;
  }

  /**
   * Clear audit log (in-memory + IndexedDB).
   */
  clearAuditLog(olderThan?: number): void {
    if (olderThan) {
      this.auditLog = this.auditLog.filter(entry => entry.timestamp > olderThan);
    } else {
      this.auditLog = [];
    }
    // Best-effort clear in IndexedDB
    if (!olderThan) {
      // Full clear: use the atomic store.clear() helper (no cursor race)
      clearPersistedAuditLog().catch(() => { /* silent */ });
    } else {
      // Partial clear: rebuild the DB from the surviving in-memory entries
      // (avoids cursor-iteration race with tx.oncomplete)
      openAuditDb().then(db => {
        const tx = db.transaction(AUDIT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(AUDIT_STORE_NAME);
        store.clear();
        for (const entry of this.auditLog) {
          store.put(entry);
        }
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      }).catch(() => { /* silent */ });
    }
  }

  /**
   * Export audit log
   */
  exportAuditLog(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.auditLog, null, 2);
    } else {
      const headers = ['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Success', 'Error'];
      const rows = this.auditLog.map(entry => [
        new Date(entry.timestamp).toISOString(),
        entry.userEmail,
        entry.action,
        entry.resource,
        entry.resourceId,
        entry.success.toString(),
        entry.errorMessage || '',
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }
  }
}

/**
 * Security Store for React
 */
import { create } from 'zustand';

interface SecurityState {
  currentUser: User | null;
  users: User[];
  auditLog: AuditLogEntry[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadUsers: () => Promise<void>;
  loadAuditLog: (filters?: any) => Promise<void>;
  addUser: (user: Omit<User, 'permissions'>) => Promise<void>;
  updateUserRole: (userId: string, role: Role) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  exportAuditLog: (format: 'json' | 'csv') => void;
  setError: (error: string | null) => void;
  /** Wire the current session token into the manager so server-side checks work. */
  setSessionToken: (token: string) => void;
}

const securityManager = new SecurityManager();

export const useSecurityStore = create<SecurityState>((set) => ({
  currentUser: null,
  users: [],
  auditLog: [],
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

  setSessionToken: (token: string) => {
    // Persist token in manager without changing the current user id
    securityManager.setCurrentUser(securityManager.userId || '', token);
  },

  loadUsers: async () => {
    set({ isLoading: true, error: null });
    try {
      const users = securityManager.listUsers();
      set({ users, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load users',
        isLoading: false,
      });
    }
  },

  loadAuditLog: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      // Pull persisted entries from IndexedDB first so new sessions see old log
      const persisted = await loadPersistedAuditLog();
      // Merge into manager's in-memory cache
      const existingIds = new Set(securityManager.getAuditLog().map(e => e.id));
      for (const e of persisted) {
        if (!existingIds.has(e.id)) {
          // Push directly into cache (avoid re-persisting already-stored entries)
          (securityManager as any).auditLog.push(e);
        }
      }
      const auditLog = securityManager.getAuditLog(filters);
      set({ auditLog, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load audit log',
        isLoading: false,
      });
    }
  },

  addUser: async (user) => {
    try {
      const newUser = await securityManager.addUser(user);
      set((state) => ({
        users: [...state.users, newUser],
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to add user',
      });
    }
  },

  updateUserRole: async (userId, role) => {
    try {
      await securityManager.updateUserRole(userId, role);
      set((state) => ({
        users: state.users.map(u =>
          u.id === userId ? { ...u, role, permissions: ROLE_PERMISSIONS[role] } : u
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update role',
      });
    }
  },

  removeUser: async (userId) => {
    try {
      await securityManager.removeUser(userId);
      set((state) => ({
        users: state.users.filter(u => u.id !== userId),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to remove user',
      });
    }
  },

  hasPermission: (permission) => {
    return securityManager.hasPermission(permission);
  },

  exportAuditLog: (format) => {
    return securityManager.exportAuditLog(format);
  },
}));