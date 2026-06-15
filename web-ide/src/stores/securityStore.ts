/**
 * Advanced Security Features
 * RBAC (Role-Based Access Control) and Audit Logging
 */

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
  private auditLog: AuditLogEntry[] = [];
  private currentUserId: string | null = null;

  constructor() {
    // Initialize with default admin user
    this.users.set('admin@ribix.dev', {
      id: 'admin',
      email: 'admin@ribix.dev',
      name: 'Admin',
      role: 'owner',
      permissions: ROLE_PERMISSIONS.owner,
    });
  }

  /**
   * Set current user
   */
  setCurrentUser(userId: string): void {
    this.currentUserId = userId;
  }

  /**
   * Check if user has permission
   */
  hasPermission(permission: Permission, userId?: string): boolean {
    const user = this.users.get(userId || this.currentUserId || '');
    if (!user) return false;
    return user.permissions.includes(permission);
  }

  /**
   * Check if user has any of the specified permissions
   */
  hasAnyPermission(permissions: Permission[], userId?: string): boolean {
    const user = this.users.get(userId || this.currentUserId || '');
    if (!user) return false;
    return permissions.some(p => user.permissions.includes(p));
  }

  /**
   * Add user
   */
  addUser(user: Omit<User, 'permissions'>): User {
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
   * Update user role
   */
  updateUserRole(userId: string, newRole: Role): void {
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
   * Remove user
   */
  removeUser(userId: string): void {
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
   * Log audit entry
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
    this.auditLog.push(auditEntry);
  }

  /**
   * Get audit log
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
      log = log.filter(entry => entry.timestamp >= filters.startDate);
    }
    if (filters?.endDate) {
      log = log.filter(entry => entry.timestamp <= filters.endDate);
    }

    log = log.sort((a, b) => b.timestamp - a.timestamp);

    if (filters?.limit) {
      log = log.slice(0, filters.limit);
    }

    return log;
  }

  /**
   * Clear audit log
   */
  clearAuditLog(olderThan?: number): void {
    if (olderThan) {
      this.auditLog = this.auditLog.filter(entry => entry.timestamp > olderThan);
    } else {
      this.auditLog = [];
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
  addUser: (user: Omit<User, 'permissions'>) => void;
  updateUserRole: (userId: string, role: Role) => void;
  removeUser: (userId: string) => void;
  hasPermission: (permission: Permission) => boolean;
  exportAuditLog: (format: 'json' | 'csv') => void;
  setError: (error: string | null) => void;
}

const securityManager = new SecurityManager();

export const useSecurityStore = create<SecurityState>((set) => ({
  currentUser: null,
  users: [],
  auditLog: [],
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

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
      const auditLog = securityManager.getAuditLog(filters);
      set({ auditLog, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load audit log',
        isLoading: false,
      });
    }
  },

  addUser: (user) => {
    try {
      securityManager.addUser(user);
      set((state) => ({
        users: [...state.users, securityManager.getUser(user.id)!],
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to add user',
      });
    }
  },

  updateUserRole: (userId, role) => {
    try {
      securityManager.updateUserRole(userId, role);
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

  removeUser: (userId) => {
    try {
      securityManager.removeUser(userId);
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