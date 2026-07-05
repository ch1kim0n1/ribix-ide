import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFileSystemStore } from './fileSystemStore';

// Minimal localStorage stub for node environment (fileSystemStore uses localStorage
// for filesystem persistence; the auth token now lives in sessionStorage — C3).
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

// sessionStorage stub for the auth token (C3).
const sessionStore: Record<string, string> = {};
const sessionStorageStub = {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => { sessionStore[key] = value; },
  removeItem: (key: string) => { delete sessionStore[key]; },
  clear: () => { for (const k of Object.keys(sessionStore)) delete sessionStore[k]; },
};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageStub,
  writable: true,
  configurable: true,
});

// fileSystemStore guards localStorage access with `typeof window === 'undefined'`,
// so expose a minimal window object in the node environment.
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageStub, sessionStorage: sessionStorageStub },
  writable: true,
  configurable: true,
});

// Minimal document/URL stubs for downloadWorkspace (node environment has no DOM).
const createdElements: any[] = [];
Object.defineProperty(globalThis, 'document', {
  value: {
    createElement: (_tag: string) => {
      const el: any = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
      createdElements.push(el);
      return el;
    },
    body: { appendChild: vi.fn() },
  },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'URL', {
  value: {
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  },
  writable: true,
  configurable: true,
});

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(['zip'])),
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createdElements.length = 0;
  (URL.createObjectURL as any).mockClear?.();
  (URL.revokeObjectURL as any).mockClear?.();
  useFileSystemStore.setState({
    root: {
      name: 'workspace',
      path: '/',
      type: 'directory',
      children: [
        { name: 'src', path: '/src', type: 'directory', children: [] },
        { name: 'tests', path: '/tests', type: 'directory', children: [] },
        {
          name: 'README.md',
          path: '/README.md',
          type: 'file',
          content: '# Project',
          language: 'markdown',
          lastModified: 1,
        },
      ],
    },
    currentPath: [],
    isLoading: false,
    error: null,
    persistenceEnabled: true,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFileSystemStore', () => {
  it('starts with a root directory and no error', () => {
    const s = useFileSystemStore.getState();
    expect(s.root.type).toBe('directory');
    expect(s.root.name).toBe('workspace');
    expect(s.error).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.persistenceEnabled).toBe(true);
  });

  it('setError sets and clears error state', () => {
    useFileSystemStore.getState().setError('boom');
    expect(useFileSystemStore.getState().error).toBe('boom');
    useFileSystemStore.getState().setError(null);
    expect(useFileSystemStore.getState().error).toBeNull();
  });

  it('navigateTo sets currentPath from a path string', () => {
    useFileSystemStore.getState().navigateTo('/src/sub');
    expect(useFileSystemStore.getState().currentPath).toEqual(['src', 'sub']);
  });

  it('navigateTo persists to localStorage when persistence is enabled', () => {
    useFileSystemStore.getState().navigateTo('/src');
    expect(localStorage.getItem('ribix_filesystem_state')).toBeTruthy();
  });

  it('navigateTo does not persist when persistence is disabled', () => {
    useFileSystemStore.setState({ persistenceEnabled: false });
    localStorage.clear();
    useFileSystemStore.getState().navigateTo('/src');
    expect(localStorage.getItem('ribix_filesystem_state')).toBeNull();
  });

  it('saveToStorage writes state to localStorage', () => {
    localStorage.clear();
    useFileSystemStore.getState().saveToStorage();
    const raw = localStorage.getItem('ribix_filesystem_state');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.root).toBeDefined();
    expect(parsed.currentPath).toEqual([]);
  });

  it('loadFromStorage restores root and currentPath from localStorage', () => {
    const persisted = {
      version: 1,
      root: { name: 'restored', path: '/', type: 'directory', children: [] },
      currentPath: ['src'],
      savedAt: Date.now(),
    };
    localStorage.setItem('ribix_filesystem_state', JSON.stringify(persisted));

    useFileSystemStore.getState().loadFromStorage();
    const s = useFileSystemStore.getState();
    expect(s.root.name).toBe('restored');
    expect(s.currentPath).toEqual(['src']);
  });

  it('loadFromStorage is a no-op when nothing is persisted', () => {
    localStorage.clear();
    const before = useFileSystemStore.getState().root;
    useFileSystemStore.getState().loadFromStorage();
    expect(useFileSystemStore.getState().root).toBe(before);
  });

  it('clearStorage removes persisted state and resets root', () => {
    localStorage.setItem('ribix_filesystem_state', '{ "version": 1 }');
    useFileSystemStore.getState().clearStorage();
    expect(localStorage.getItem('ribix_filesystem_state')).toBeNull();
    expect(useFileSystemStore.getState().root.name).toBe('workspace');
    expect(useFileSystemStore.getState().currentPath).toEqual([]);
  });

  it('createFile calls API and adds file to the tree', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().createFile('/src/index.ts', 'console.log(1)', 'typescript');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/filesystem/write',
      expect.objectContaining({ method: 'POST' }),
    );
    const srcDir = useFileSystemStore.getState().root.children!.find(c => c.name === 'src');
    const file = srcDir?.children?.find(c => c.name === 'index.ts');
    expect(file).toBeDefined();
    expect(file?.type).toBe('file');
    expect(file?.content).toBe('console.log(1)');
    expect(file?.language).toBe('typescript');
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('createFile sends Authorization header (from sessionStorage) and credentials:include when token is present', async () => {
    // C3: token now lives in sessionStorage, not localStorage.
    sessionStorage.setItem('ribix_token', 'tok-xyz');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().createFile('/a.txt', 'hi');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-xyz' }),
        credentials: 'include',
      }),
    );
  });

  it('createFile sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().createFile('/bad.txt', 'x'),
    ).rejects.toThrow('Failed to create file');
    expect(useFileSystemStore.getState().error).toBe('Failed to create file');
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('createFile sets error on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      useFileSystemStore.getState().createFile('/bad.txt', 'x'),
    ).rejects.toThrow('network down');
    expect(useFileSystemStore.getState().error).toBe('network down');
  });

  it('createDirectory calls API and adds directory to the tree', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().createDirectory('/src/components');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/filesystem/directory',
      expect.objectContaining({ method: 'POST' }),
    );
    const srcDir = useFileSystemStore.getState().root.children!.find(c => c.name === 'src');
    const dir = srcDir?.children?.find(c => c.name === 'components');
    expect(dir).toBeDefined();
    expect(dir?.type).toBe('directory');
    expect(dir?.children).toEqual([]);
  });

  it('createDirectory sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().createDirectory('/bad'),
    ).rejects.toThrow('Failed to create directory');
    expect(useFileSystemStore.getState().error).toBe('Failed to create directory');
  });

  it('readFile returns content from API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ content: 'file contents' }),
    );

    const content = await useFileSystemStore.getState().readFile('/README.md');
    expect(content).toBe('file contents');
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('readFile sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 404));

    await expect(
      useFileSystemStore.getState().readFile('/missing.txt'),
    ).rejects.toThrow('Failed to read file');
    expect(useFileSystemStore.getState().error).toBe('Failed to read file');
  });

  it('readFile sets error on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(
      useFileSystemStore.getState().readFile('/x.txt'),
    ).rejects.toThrow('offline');
    expect(useFileSystemStore.getState().error).toBe('offline');
  });

  it('writeFile calls API and updates existing file content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().writeFile('/README.md', 'new content');

    const file = useFileSystemStore.getState().root.children!.find(c => c.name === 'README.md');
    expect(file?.content).toBe('new content');
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('writeFile sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().writeFile('/README.md', 'x'),
    ).rejects.toThrow('Failed to write file');
    expect(useFileSystemStore.getState().error).toBe('Failed to write file');
  });

  it('deleteFile calls API and removes file from the tree', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().deleteFile('/README.md');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/filesystem/delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/README.md', isDirectory: false }),
      }),
    );
    const file = useFileSystemStore.getState().root.children!.find(c => c.name === 'README.md');
    expect(file).toBeUndefined();
  });

  it('deleteFile sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().deleteFile('/README.md'),
    ).rejects.toThrow('Failed to delete file');
    expect(useFileSystemStore.getState().error).toBe('Failed to delete file');
  });

  it('deleteDirectory calls API and removes directory from the tree', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ success: true }));

    await useFileSystemStore.getState().deleteDirectory('/src');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/filesystem/delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/src', isDirectory: true }),
      }),
    );
    const dir = useFileSystemStore.getState().root.children!.find(c => c.name === 'src');
    expect(dir).toBeUndefined();
  });

  it('deleteDirectory sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().deleteDirectory('/src'),
    ).rejects.toThrow('Failed to delete directory');
    expect(useFileSystemStore.getState().error).toBe('Failed to delete directory');
  });

  it('listFiles calls API with query path and returns files', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ files: [{ name: 'a.ts', path: '/a.ts', type: 'file' }] }),
    );

    const files = await useFileSystemStore.getState().listFiles('/src');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/filesystem/list?path=%2Fsrc',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('a.ts');
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('listFiles sets error and rethrows on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await expect(
      useFileSystemStore.getState().listFiles('/src'),
    ).rejects.toThrow('Failed to list files');
    expect(useFileSystemStore.getState().error).toBe('Failed to list files');
  });

  it('downloadWorkspace triggers a download on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(new Blob(['zip'])));

    await useFileSystemStore.getState().downloadWorkspace();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(createdElements).toHaveLength(1);
    expect(createdElements[0].download).toBe('ribix-workspace.zip');
    expect(createdElements[0].click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(useFileSystemStore.getState().isLoading).toBe(false);
  });

  it('downloadWorkspace throws with server error message on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: 'zip failed' }, false, 500),
    );

    await expect(
      useFileSystemStore.getState().downloadWorkspace(),
    ).rejects.toThrow('zip failed');
    expect(useFileSystemStore.getState().error).toBe('zip failed');
  });

  it('downloadWorkspace falls back to default message when body has no error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, false, 500),
    );

    await expect(
      useFileSystemStore.getState().downloadWorkspace(),
    ).rejects.toThrow('Failed to export workspace');
    expect(useFileSystemStore.getState().error).toBe('Failed to export workspace');
  });

  it('downloadWorkspace sets error on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(
      useFileSystemStore.getState().downloadWorkspace(),
    ).rejects.toThrow('offline');
    expect(useFileSystemStore.getState().error).toBe('offline');
  });
});
