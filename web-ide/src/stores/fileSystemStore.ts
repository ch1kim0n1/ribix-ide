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

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  root: createInitialFileSystem(),
  currentPath: [],
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

  navigateTo: (path: string) => {
    const pathParts = path.split('/').filter(Boolean);
    set({ currentPath: pathParts });
  },

  createFile: async (path: string, content: string, language?: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(webIdeApiUrl('/filesystem/write'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`${webIdeApiUrl('/filesystem/list')}?path=${encodeURIComponent(path)}`);

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
}));
