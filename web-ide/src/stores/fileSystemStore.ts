import { create } from 'zustand';
import { webIdeApiUrl } from '../lib/api';

interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  content?: string;
  language?: string;
  children?: FileSystemItem[];
  lastModified?: number;
}

interface FileSystemState {
  root: FileSystemItem;
  currentPath: string[];
  isLoading: boolean;
  error: string | null;
  persistenceEnabled: boolean;

  // Actions
  createFile: (path: string, content: string, language?: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  deleteDirectory: (path: string) => Promise<void>;
  listFiles: (path: string) => Promise<FileSystemItem[]>;
  navigateTo: (path: string) => void;
  setError: (error: string | null) => void;
  downloadWorkspace: () => Promise<void>;
  /** Load filesystem state from localStorage (issue #53 persistence). */
  loadFromStorage: () => void;
  /** Save filesystem state to localStorage. */
  saveToStorage: () => void;
  /** Clear persisted state. */
  clearStorage: () => void;
}

/**
 * Build headers for filesystem API calls. The backend scopes the file system to
 * the authenticated user's personal workspace via the Bearer token, so every
 * request must carry it — otherwise all callers fall back to the shared
 * "workspace-123" workspace and clobber each other's files (issue #53).
 */
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ribix_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

/**
 * localStorage key for persisting filesystem state (issue #53).
 * Allows the web IDE to restore files after page refresh or reconnect.
 */
const STORAGE_KEY = 'ribix_filesystem_state';
const STORAGE_VERSION = 1;

interface PersistedState {
  version: number;
  root: FileSystemItem;
  currentPath: string[];
  savedAt: number;
}

const createInitialFileSystem = (): FileSystemItem => ({
  name: 'workspace',
  path: '/',
  type: 'directory',
  children: [
    {
      name: 'src',
      path: '/src',
      type: 'directory',
      children: [],
    },
    {
      name: 'tests',
      path: '/tests',
      type: 'directory',
      children: [],
    },
    {
      name: 'README.md',
      path: '/README.md',
      type: 'file',
      content: '# Project\n\nWelcome to the project.',
      language: 'markdown',
      lastModified: Date.now(),
    },
  ],
});

/**
 * Load filesystem state from localStorage.
 * Returns null if no state exists or if version is incompatible.
 */
function loadFromLocalStorage(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== STORAGE_VERSION) {
      // Version mismatch — discard old state
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Corrupted JSON — remove and return null
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Save filesystem state to localStorage.
 * Called after every mutation to ensure persistence.
 */
function saveToLocalStorage(root: FileSystemItem, currentPath: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const state: PersistedState = {
      version: STORAGE_VERSION,
      root,
      currentPath,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // localStorage might be full (quota exceeded) — log but don't throw
    console.warn('[fileSystemStore] Failed to persist filesystem state:', error);
  }
}

/**
 * Clear persisted filesystem state from localStorage.
 */
function clearLocalStorage(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  // Try to load from localStorage on init; fall back to initial filesystem
  root: (() => {
    const persisted = loadFromLocalStorage();
    return persisted?.root ?? createInitialFileSystem();
  })(),
  currentPath: (() => {
    const persisted = loadFromLocalStorage();
    return persisted?.currentPath ?? [];
  })(),
  isLoading: false,
  error: null,
  persistenceEnabled: true,

  setError: (error) => set({ error }),

  loadFromStorage: () => {
    const persisted = loadFromLocalStorage();
    if (persisted) {
      set({ root: persisted.root, currentPath: persisted.currentPath });
    }
  },

  saveToStorage: () => {
    const { root, currentPath } = get();
    saveToLocalStorage(root, currentPath);
  },

  clearStorage: () => {
    clearLocalStorage();
    set({ root: createInitialFileSystem(), currentPath: [] });
  },

  navigateTo: (path: string) => {
    const pathParts = path.split('/').filter(Boolean);
    set({ currentPath: pathParts });
    // Persist navigation state
    if (get().persistenceEnabled) {
      saveToLocalStorage(get().root, pathParts);
    }
  },

  createFile: async (path: string, content: string, language?: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/write'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path, content, language }),
      });

      if (!response.ok) {
        throw new Error('Failed to create file');
      }

      // Update local state
      const { root } = get();
      const newRoot = { ...root };
      const pathParts = path.split('/').filter(Boolean);
      const fileName = pathParts.pop()!;
      
      let current = newRoot;
      for (const part of pathParts) {
        const child = current.children?.find(c => c.name === part);
        if (child && child.type === 'directory') {
          current = child;
        }
      }

      if (!current.children) current.children = [];
      current.children.push({
        name: fileName,
        path,
        type: 'file',
        content,
        language,
        lastModified: Date.now(),
      });

      set({ root: newRoot, isLoading: false });
      if (get().persistenceEnabled) saveToLocalStorage(newRoot, get().currentPath);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create file',
        isLoading: false,
      });
      throw error;
    }
  },

  createDirectory: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/directory'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        throw new Error('Failed to create directory');
      }

      // Update local state
      const { root } = get();
      const newRoot = { ...root };
      const pathParts = path.split('/').filter(Boolean);
      const dirName = pathParts.pop()!;
      
      let current = newRoot;
      for (const part of pathParts) {
        const child = current.children?.find(c => c.name === part);
        if (child && child.type === 'directory') {
          current = child;
        }
      }

      if (!current.children) current.children = [];
      current.children.push({
        name: dirName,
        path,
        type: 'directory',
        children: [],
      });

      set({ root: newRoot, isLoading: false });
      if (get().persistenceEnabled) saveToLocalStorage(newRoot, get().currentPath);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to create directory',
        isLoading: false,
      });
      throw error;
    }
  },

  readFile: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/read'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        throw new Error('Failed to read file');
      }

      const data = await response.json();
      set({ isLoading: false });
      return data.content;
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to read file',
        isLoading: false,
      });
      throw error;
    }
  },

  writeFile: async (path: string, content: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/write'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path, content }),
      });

      if (!response.ok) {
        throw new Error('Failed to write file');
      }

      // Update local state
      const { root } = get();
      const newRoot = { ...root };
      const pathParts = path.split('/').filter(Boolean);
      const fileName = pathParts.pop()!;
      
      let current = newRoot;
      for (const part of pathParts) {
        const child = current.children?.find(c => c.name === part);
        if (child && child.type === 'directory') {
          current = child;
        }
      }

      const file = current.children?.find(c => c.name === fileName);
      if (file && file.type === 'file') {
        file.content = content;
        file.lastModified = Date.now();
      }

      set({ root: newRoot, isLoading: false });
      if (get().persistenceEnabled) saveToLocalStorage(newRoot, get().currentPath);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to write file',
        isLoading: false,
      });
      throw error;
    }
  },

  deleteFile: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/delete'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path, isDirectory: false }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      // Update local state
      const { root } = get();
      const newRoot = { ...root };
      const pathParts = path.split('/').filter(Boolean);
      const fileName = pathParts.pop()!;
      
      let current = newRoot;
      for (const part of pathParts) {
        const child = current.children?.find(c => c.name === part);
        if (child && child.type === 'directory') {
          current = child;
        }
      }

      if (current.children) {
        current.children = current.children.filter(c => c.name !== fileName);
      }

      set({ root: newRoot, isLoading: false });
      if (get().persistenceEnabled) saveToLocalStorage(newRoot, get().currentPath);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete file',
        isLoading: false,
      });
      throw error;
    }
  },

  deleteDirectory: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/delete'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path, isDirectory: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete directory');
      }

      // Update local state
      const { root } = get();
      const newRoot = { ...root };
      const pathParts = path.split('/').filter(Boolean);
      const dirName = pathParts.pop()!;
      
      let current = newRoot;
      for (const part of pathParts) {
        const child = current.children?.find(c => c.name === part);
        if (child && child.type === 'directory') {
          current = child;
        }
      }

      if (current.children) {
        current.children = current.children.filter(c => c.name !== dirName);
      }

      set({ root: newRoot, isLoading: false });
      if (get().persistenceEnabled) saveToLocalStorage(newRoot, get().currentPath);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete directory',
        isLoading: false,
      });
      throw error;
    }
  },

  listFiles: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${webIdeApiUrl('/filesystem/list')}?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to list files');
      }

      const data = await response.json();
      set({ isLoading: false });
      return data.files;
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to list files',
        isLoading: false,
      });
      throw error;
    }
  },

  downloadWorkspace: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(webIdeApiUrl('/filesystem/export.zip'), {
        headers: authHeaders(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to export workspace');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ribix-workspace.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to download workspace',
        isLoading: false,
      });
      throw error;
    }
  },
}));
