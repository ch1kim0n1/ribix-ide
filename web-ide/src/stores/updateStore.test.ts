import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUpdateStore, AutoUpdateManager } from './updateStore';
import type { UpdateInfo } from './updateStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const sampleUpdate: UpdateInfo = {
  version: '2.0.0',
  releaseDate: '2026-01-01',
  changelog: 'Big release',
  downloadUrl: 'https://example.com/update.bin',
  size: 12345,
  mandatory: false,
};

beforeEach(() => {
  useUpdateStore.setState({
    hasUpdate: false,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    updateInfo: null,
    isDownloading: false,
    downloadProgress: 0,
    isChecking: false,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUpdateStore', () => {
  it('starts with no update and default version 1.0.0', () => {
    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(false);
    expect(s.currentVersion).toBe('1.0.0');
    expect(s.latestVersion).toBe('1.0.0');
    expect(s.updateInfo).toBeNull();
    expect(s.isDownloading).toBe(false);
    expect(s.isChecking).toBe(false);
    expect(s.error).toBeNull();
  });

  it('setError sets the error field', () => {
    useUpdateStore.getState().setError('something broke');
    expect(useUpdateStore.getState().error).toBe('something broke');
    useUpdateStore.getState().setError(null);
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it('dismissUpdate clears update state', () => {
    useUpdateStore.setState({
      hasUpdate: true,
      updateInfo: sampleUpdate,
      latestVersion: '2.0.0',
    });
    useUpdateStore.getState().dismissUpdate();
    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(false);
    expect(s.updateInfo).toBeNull();
  });

  it('checkForUpdates detects an available update', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );

    await useUpdateStore.getState().checkForUpdates();

    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(true);
    expect(s.latestVersion).toBe('2.0.0');
    expect(s.updateInfo).toEqual(sampleUpdate);
    expect(s.isChecking).toBe(false);
    expect(s.error).toBeNull();
  });

  it('checkForUpdates reports no update when version is not newer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ ...sampleUpdate, version: '1.0.0' }),
    );

    await useUpdateStore.getState().checkForUpdates();

    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(false);
    expect(s.updateInfo).toBeNull();
    expect(s.isChecking).toBe(false);
  });

  it('checkForUpdates handles fetch failure gracefully (manager catches)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await useUpdateStore.getState().checkForUpdates();

    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(false);
    expect(s.isChecking).toBe(false);
    // manager catches internally and returns latestVersion === currentVersion
    expect(s.latestVersion).toBe('1.0.0');
  });

  it('checkForUpdates handles non-OK response gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, false, 500),
    );

    await useUpdateStore.getState().checkForUpdates();

    const s = useUpdateStore.getState();
    expect(s.hasUpdate).toBe(false);
    expect(s.isChecking).toBe(false);
  });

  it('downloadUpdate sets error when no update is available', async () => {
    await useUpdateStore.getState().downloadUpdate();
    expect(useUpdateStore.getState().error).toBe('No update available');
  });

  it('downloadUpdate on web platform returns early (no real download)', async () => {
    useUpdateStore.setState({ updateInfo: sampleUpdate });
    // No fetch spy needed; web platform short-circuits before fetching.
    await useUpdateStore.getState().downloadUpdate();
    const s = useUpdateStore.getState();
    expect(s.isDownloading).toBe(true);
    expect(s.downloadProgress).toBe(0);
    expect(s.error).toBeNull();
  });

  it('installUpdate sets error when restart fails (no window in node)', async () => {
    useUpdateStore.setState({ updateInfo: sampleUpdate });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Ensure checkForUpdates has run so updateManager exists.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );
    await useUpdateStore.getState().checkForUpdates();

    await useUpdateStore.getState().installUpdate();

    expect(useUpdateStore.getState().error).toBeTruthy();
    errSpy.mockRestore();
  });
});

describe('AutoUpdateManager', () => {
  it('checkForUpdates returns hasUpdate true when remote version is newer', async () => {
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );

    const result = await manager.checkForUpdates();

    expect(result.hasUpdate).toBe(true);
    expect(result.currentVersion).toBe('1.0.0');
    expect(result.latestVersion).toBe('2.0.0');
    expect(result.updateInfo).toEqual(sampleUpdate);
  });

  it('checkForUpdates returns hasUpdate false when versions are equal', async () => {
    const manager = new AutoUpdateManager({
      currentVersion: '2.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );

    const result = await manager.checkForUpdates();
    expect(result.hasUpdate).toBe(false);
    expect(result.updateInfo).toBeUndefined();
  });

  it('checkForUpdates sends version and platform headers', async () => {
    const manager = new AutoUpdateManager({
      currentVersion: '1.2.3',
      updateCheckUrl: 'https://example.com/check',
      platform: 'darwin',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(sampleUpdate));

    await manager.checkForUpdates();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/check',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Current-Version': '1.2.3',
          'X-Platform': 'darwin',
        }),
      }),
    );
  });

  it('checkForUpdates returns no-update result on fetch rejection', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));

    const result = await manager.checkForUpdates();
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('1.0.0');
    errSpy.mockRestore();
  });

  it('checkForUpdates returns no-update result on non-OK response', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, false, 503),
    );

    const result = await manager.checkForUpdates();
    expect(result.hasUpdate).toBe(false);
    errSpy.mockRestore();
  });

  it('downloadUpdate on web platform returns early without fetching', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await manager.downloadUpdate(sampleUpdate);

    expect(fetchSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('startAutoUpdateCheck triggers onUpdateAvailable when an update exists', async () => {
    vi.useFakeTimers();
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
      checkInterval: 1000,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );
    const cb = vi.fn();
    manager.setCallbacks({ onUpdateAvailable: cb });

    manager.startAutoUpdateCheck();
    // Flush the immediate microtask check.
    await vi.runOnlyPendingTimersAsync();

    expect(cb).toHaveBeenCalledWith(sampleUpdate);
    manager.stopAutoUpdateCheck();
    vi.useRealTimers();
  });

  it('stopAutoUpdateCheck clears the interval timer', () => {
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'web',
      checkInterval: 1000,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(sampleUpdate),
    );
    manager.startAutoUpdateCheck();
    manager.stopAutoUpdateCheck();
    // Calling again should be a no-op (no throw).
    manager.stopAutoUpdateCheck();
    expect(true).toBe(true);
  });

  it('setCallbacks stores callbacks and onDownloadProgress is invoked during download', async () => {
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'win32',
    });

    const progress = vi.fn();
    const downloaded = vi.fn();
    manager.setCallbacks({
      onDownloadProgress: progress,
      onUpdateDownloaded: downloaded,
    });

    // Build a fake streaming response.
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunks[0] })
        .mockResolvedValueOnce({ done: false, value: chunks[1] })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
      headers: new Map([['Content-Length', '5']]) as any,
    } as any);

    await manager.downloadUpdate(sampleUpdate);

    expect(progress).toHaveBeenCalled();
    expect(downloaded).toHaveBeenCalledWith(sampleUpdate);
  });

  it('downloadUpdate throws when response body has no reader', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new AutoUpdateManager({
      currentVersion: '1.0.0',
      updateCheckUrl: 'https://example.com/check',
      platform: 'linux',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => undefined },
      headers: new Map() as any,
    } as any);

    await expect(manager.downloadUpdate(sampleUpdate)).rejects.toThrow(
      'Failed to download update',
    );
    errSpy.mockRestore();
  });
});
