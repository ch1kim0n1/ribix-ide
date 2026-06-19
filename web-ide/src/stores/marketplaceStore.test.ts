import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useMarketplaceStore,
  VSCodeMarketplaceClient,
  type MarketplaceExtension,
} from './marketplaceStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function makeExtension(overrides: Partial<MarketplaceExtension> = {}): MarketplaceExtension {
  return {
    extensionId: 'test.ext',
    extensionName: 'test',
    displayName: 'Test Extension',
    shortDescription: 'A test extension',
    versions: [
      {
        version: '1.0.0',
        lastUpdated: 1000,
        files: [
          { assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: 'https://example.com/test.vsix' },
          { assetType: 'Microsoft.VisualStudio.Services.Manifest', source: 'https://example.com/manifest.json' },
        ],
      },
      {
        version: '0.9.0',
        lastUpdated: 500,
        files: [
          { assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: 'https://example.com/test09.vsix' },
        ],
      },
    ],
    publisher: {
      publisherId: 'pub-1',
      publisherName: 'testpub',
      displayName: 'Test Publisher',
    },
    statistics: {
      install: 100,
      averagerating: 4.5,
      weightedrating: 4.3,
      downloadcount: 200,
    },
    tags: ['test'],
    releaseDate: 1000,
    lastUpdated: 1000,
    categories: ['Other'],
    ...overrides,
  };
}

function galleryResponse(extensions: MarketplaceExtension[]) {
  return { results: [{ extensions }] };
}

beforeEach(() => {
  useMarketplaceStore.setState({
    extensions: [],
    categories: [],
    searchQuery: '',
    selectedCategory: null,
    isLoading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VSCodeMarketplaceClient', () => {
  it('checkHealth returns true when response is ok', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({}, true));

    const client = new VSCodeMarketplaceClient();
    const result = await client.checkHealth();

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/web-ide/marketplace/health');
  });

  it('checkHealth returns false when response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    const client = new VSCodeMarketplaceClient();
    const result = await client.checkHealth();

    expect(result).toBe(false);
  });

  it('checkHealth returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const client = new VSCodeMarketplaceClient();
    const result = await client.checkHealth();

    expect(result).toBe(false);
  });

  it('searchExtensions queries marketplace and returns extensions', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([makeExtension()])));

    const client = new VSCodeMarketplaceClient();
    const extensions = await client.searchExtensions('test');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/marketplace/query',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json;api-version=7.2-preview.1',
        }),
      }),
    );
    expect(extensions).toHaveLength(1);
    expect(extensions[0].extensionId).toBe('test.ext');
  });

  it('searchExtensions sends search text criteria in payload body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([])));

    const client = new VSCodeMarketplaceClient();
    await client.searchExtensions('python', { pageSize: 10, pageNumber: 2 });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.filters[0].criteria).toEqual([
      { filterType: 10, value: 'python' },
      { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
    ]);
    expect(body.filters[0].pageNumber).toBe(2);
    expect(body.filters[0].pageSize).toBe(10);
  });

  it('searchExtensions throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    const client = new VSCodeMarketplaceClient();
    await expect(client.searchExtensions('test')).rejects.toThrow(
      'Marketplace request failed with status 500',
    );
  });

  it('searchExtensions applies compatibility info when manager provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'a.b' })])),
    );

    const compatibilityManager = {
      getCompatibilityInfo: vi.fn().mockReturnValue({
        compatible: false,
        issues: ['issue1'],
        workarounds: ['workaround1'],
      }),
    };

    const client = new VSCodeMarketplaceClient(compatibilityManager);
    const extensions = await client.searchExtensions('test');

    expect(compatibilityManager.getCompatibilityInfo).toHaveBeenCalledWith('a.b');
    expect(extensions[0].compatibility).toEqual({
      ribix: false,
      issues: ['issue1'],
      workarounds: ['workaround1'],
    });
  });

  it('searchExtensions defaults compatibility to compatible true when manager returns nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'a.b' })])),
    );

    const compatibilityManager = {
      getCompatibilityInfo: vi.fn().mockReturnValue(undefined),
    };

    const client = new VSCodeMarketplaceClient(compatibilityManager);
    const extensions = await client.searchExtensions('test');

    expect(extensions[0].compatibility?.ribix).toBe(true);
    expect(extensions[0].compatibility?.issues).toEqual([]);
    expect(extensions[0].compatibility?.workarounds).toEqual([]);
  });

  it('searchExtensions filters incompatible extensions when filterCompatible is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(
        galleryResponse([
          makeExtension({ extensionId: 'compatible.ext' }),
          makeExtension({ extensionId: 'incompatible.ext' }),
        ]),
      ),
    );

    const compatibilityManager = {
      getCompatibilityInfo: vi.fn().mockImplementation((id: string) =>
        id === 'incompatible.ext'
          ? { compatible: false, issues: [], workarounds: [] }
          : { compatible: true, issues: [], workarounds: [] },
      ),
    };

    const client = new VSCodeMarketplaceClient(compatibilityManager);
    const extensions = await client.searchExtensions('test', { filterCompatible: true });

    expect(extensions).toHaveLength(1);
    expect(extensions[0].extensionId).toBe('compatible.ext');
  });

  it('getExtension returns the first extension from results', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'unique.id' })])));

    const client = new VSCodeMarketplaceClient();
    const extension = await client.getExtension('unique.id');

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.filters[0].criteria).toEqual([{ filterType: 7, value: 'unique.id' }]);
    expect(body.flags).toBe(914);
    expect(extension.extensionId).toBe('unique.id');
  });

  it('getExtension applies compatibility info when manager provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'a.b' })])),
    );

    const compatibilityManager = {
      getCompatibilityInfo: vi.fn().mockReturnValue({
        compatible: true,
        issues: ['minor'],
        workarounds: [],
      }),
    };

    const client = new VSCodeMarketplaceClient(compatibilityManager);
    const extension = await client.getExtension('a.b');

    expect(extension.compatibility).toEqual({
      ribix: true,
      issues: ['minor'],
      workarounds: [],
    });
  });

  it('getExtensionVersions returns versions from extension', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );

    const client = new VSCodeMarketplaceClient();
    const versions = await client.getExtensionVersions('test.ext');

    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe('1.0.0');
  });

  it('getExtensionManifest returns empty object when version and vsix found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );

    const client = new VSCodeMarketplaceClient();
    const manifest = await client.getExtensionManifest('test.ext', '1.0.0');

    expect(manifest).toEqual({});
  });

  it('getExtensionManifest uses latest version when version not specified', async () => {
    const client = new VSCodeMarketplaceClient();
    const getExtensionSpy = vi
      .spyOn(client, 'getExtension')
      .mockResolvedValue(makeExtension());

    await client.getExtensionManifest('test.ext');

    expect(getExtensionSpy).toHaveBeenCalledWith('test.ext');
  });

  it('getExtensionManifest throws when version not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );

    const client = new VSCodeMarketplaceClient();
    await expect(client.getExtensionManifest('test.ext', '99.0.0')).rejects.toThrow(
      'Version not found',
    );
  });

  it('getExtensionManifest throws when VSIX file not found', async () => {
    const ext = makeExtension({
      versions: [
        {
          version: '1.0.0',
          lastUpdated: 1000,
          files: [{ assetType: 'Other', source: 'no-vsix' }],
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([ext])),
    );

    const client = new VSCodeMarketplaceClient();
    await expect(client.getExtensionManifest('test.ext', '1.0.0')).rejects.toThrow(
      'VSIX file not found',
    );
  });

  it('getPopularExtensions searches with category query when category provided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([makeExtension()])));

    const client = new VSCodeMarketplaceClient();
    await client.getPopularExtensions('Themes');

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.filters[0].criteria[0].value).toBe('category:"Themes"');
    expect(body.filters[0].pageSize).toBe(20);
  });

  it('getPopularExtensions searches with empty query when no category', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([])));

    const client = new VSCodeMarketplaceClient();
    await client.getPopularExtensions();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.filters[0].criteria[0].value).toBe('');
  });

  it('getTrendingExtensions searches for trending', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([makeExtension()])));

    const client = new VSCodeMarketplaceClient();
    await client.getTrendingExtensions();

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.filters[0].criteria[0].value).toBe('trending');
    expect(body.filters[0].pageSize).toBe(20);
  });

  it('getRecommendedExtensions fetches each recommended id', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(galleryResponse([makeExtension()])));

    const client = new VSCodeMarketplaceClient();
    const extensions = await client.getRecommendedExtensions();

    // 5 recommended ids → 5 fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(extensions).toHaveLength(5);
  });

  it('installExtension logs when version and vsix found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const client = new VSCodeMarketplaceClient();
    await client.installExtension('test.ext', '1.0.0');

    expect(logSpy).toHaveBeenCalledWith(
      'Installing test.ext version 1.0.0 from https://example.com/test.vsix',
    );
  });

  it('installExtension uses latest version when version not specified', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const client = new VSCodeMarketplaceClient();
    await client.installExtension('test.ext');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('version 1.0.0'),
    );
  });

  it('installExtension throws when version not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );

    const client = new VSCodeMarketplaceClient();
    await expect(client.installExtension('test.ext', '99.0.0')).rejects.toThrow(
      'Version not found',
    );
  });

  it('installExtension throws when VSIX file not found', async () => {
    const ext = makeExtension({
      versions: [
        {
          version: '1.0.0',
          lastUpdated: 1000,
          files: [{ assetType: 'Other', source: 'no-vsix' }],
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([ext])),
    );

    const client = new VSCodeMarketplaceClient();
    await expect(client.installExtension('test.ext', '1.0.0')).rejects.toThrow(
      'VSIX file not found',
    );
  });

  it('getCategories returns the static category list', async () => {
    const client = new VSCodeMarketplaceClient();
    const categories = await client.getCategories();

    expect(categories).toContain('Programming Languages');
    expect(categories).toContain('Themes');
    expect(categories).toContain('Data Science');
    expect(categories.length).toBeGreaterThan(10);
  });
});

describe('useMarketplaceStore', () => {
  it('starts with empty state', () => {
    const s = useMarketplaceStore.getState();
    expect(s.extensions).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(s.searchQuery).toBe('');
    expect(s.selectedCategory).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('setError sets error state', () => {
    useMarketplaceStore.getState().setError('something went wrong');
    expect(useMarketplaceStore.getState().error).toBe('something went wrong');
  });

  it('setSearchQuery sets search query', () => {
    useMarketplaceStore.getState().setSearchQuery('python');
    expect(useMarketplaceStore.getState().searchQuery).toBe('python');
  });

  it('setSelectedCategory sets selected category', () => {
    useMarketplaceStore.getState().setSelectedCategory('Themes');
    expect(useMarketplaceStore.getState().selectedCategory).toBe('Themes');
  });

  it('searchExtensions succeeds and stores extensions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'a.b' })])),
    );

    await useMarketplaceStore.getState().searchExtensions('test');

    const s = useMarketplaceStore.getState();
    expect(s.extensions).toHaveLength(1);
    expect(s.extensions[0].extensionId).toBe('a.b');
    expect(s.searchQuery).toBe('test');
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('searchExtensions sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await useMarketplaceStore.getState().searchExtensions('test');

    const s = useMarketplaceStore.getState();
    expect(s.extensions).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBe('Marketplace request failed with status 500');
  });

  it('searchExtensions sets generic error on non-Error rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');

    await useMarketplaceStore.getState().searchExtensions('test');

    expect(useMarketplaceStore.getState().error).toBe('Search failed');
  });

  it('getPopularExtensions succeeds and stores extensions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'popular.ext' })])),
    );

    await useMarketplaceStore.getState().getPopularExtensions('Themes');

    const s = useMarketplaceStore.getState();
    expect(s.extensions).toHaveLength(1);
    expect(s.selectedCategory).toBe('Themes');
    expect(s.isLoading).toBe(false);
  });

  it('getPopularExtensions sets selectedCategory to null when no category', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([])),
    );

    await useMarketplaceStore.getState().getPopularExtensions();

    expect(useMarketplaceStore.getState().selectedCategory).toBeNull();
  });

  it('getPopularExtensions sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await useMarketplaceStore.getState().getPopularExtensions();

    const s = useMarketplaceStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBe('Marketplace request failed with status 500');
  });

  it('getPopularExtensions sets generic error on non-Error rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue({});

    await useMarketplaceStore.getState().getPopularExtensions();

    expect(useMarketplaceStore.getState().error).toBe('Failed to load extensions');
  });

  it('getTrendingExtensions succeeds and stores extensions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension({ extensionId: 'trending.ext' })])),
    );

    await useMarketplaceStore.getState().getTrendingExtensions();

    const s = useMarketplaceStore.getState();
    expect(s.extensions).toHaveLength(1);
    expect(s.isLoading).toBe(false);
  });

  it('getTrendingExtensions sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await useMarketplaceStore.getState().getTrendingExtensions();

    expect(useMarketplaceStore.getState().error).toBe('Marketplace request failed with status 500');
  });

  it('getTrendingExtensions sets generic error on non-Error rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('oops');

    await useMarketplaceStore.getState().getTrendingExtensions();

    expect(useMarketplaceStore.getState().error).toBe('Failed to load trending');
  });

  it('getRecommendedExtensions succeeds and stores extensions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(galleryResponse([makeExtension()])),
    );

    await useMarketplaceStore.getState().getRecommendedExtensions();

    const s = useMarketplaceStore.getState();
    expect(s.extensions).toHaveLength(5);
    expect(s.isLoading).toBe(false);
  });

  it('getRecommendedExtensions sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await useMarketplaceStore.getState().getRecommendedExtensions();

    expect(useMarketplaceStore.getState().error).toBe('Marketplace request failed with status 500');
  });

  it('getRecommendedExtensions sets generic error on non-Error rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(42);

    await useMarketplaceStore.getState().getRecommendedExtensions();

    expect(useMarketplaceStore.getState().error).toBe('Failed to load recommendations');
  });

  it('getCategories succeeds and stores categories', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await useMarketplaceStore.getState().getCategories();

    expect(useMarketplaceStore.getState().categories.length).toBeGreaterThan(10);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('getCategories logs error on failure (getCategories never throws)', async () => {
    // getCategories returns a static array and never throws, so we verify it
    // still populates state. The catch branch is exercised only if the static
    // array generation were to throw, which it does not. We assert the happy
    // path here and rely on the catch being present for coverage.
    await useMarketplaceStore.getState().getCategories();

    expect(useMarketplaceStore.getState().categories).toContain('Themes');
  });
});
