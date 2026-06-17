/**
 * Enhanced VS Code Marketplace Integration
 * Provides full marketplace access with compatibility filtering
 */

import { webIdeApiUrl } from '../lib/api';

export interface MarketplaceExtension {
  extensionId: string;
  extensionName: string;
  displayName: string;
  shortDescription: string;
  versions: MarketplaceVersion[];
  publisher: {
    publisherId: string;
    publisherName: string;
    displayName: string;
  };
  statistics: {
    install: number;
    averagerating: number;
    weightedrating: number;
    downloadcount: number;
  };
  tags: string[];
  releaseDate: number;
  lastUpdated: number;
  categories: string[];
  compatibility?: {
    ribix: boolean;
    issues: string[];
    workarounds: string[];
  };
}

export interface MarketplaceVersion {
  version: string;
  lastUpdated: number;
  files: MarketplaceFile[];
}

export interface MarketplaceFile {
  assetType: string;
  source: string;
}

interface GalleryResponse<T> {
  results: Array<{
    extensions: T[];
  }>;
}

export class VSCodeMarketplaceClient {
  private apiBase: string;
  private healthUrl: string;
  private compatibilityManager: any;

  constructor(compatibilityManager?: any) {
    this.apiBase = webIdeApiUrl('/marketplace/query');
    this.healthUrl = webIdeApiUrl('/marketplace/health');
    this.compatibilityManager = compatibilityManager;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(this.healthUrl);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async queryMarketplace<T>(payload: unknown): Promise<GalleryResponse<T>> {
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=7.2-preview.1',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Marketplace request failed with status ${response.status}`);
    }

    return response.json();
  }

  /**
   * Search marketplace extensions
   */
  async searchExtensions(query: string, options: {
    pageSize?: number;
    pageNumber?: number;
    flags?: number;
    filterCompatible?: boolean;
  } = {}): Promise<MarketplaceExtension[]> {
    const {
      pageSize = 50,
      pageNumber = 0,
      flags = 914, // 914 = Exclude unpublished, incompatible
      filterCompatible = false,
    } = options;

    const data = await this.queryMarketplace<MarketplaceExtension>({
      filters: [{
        criteria: [
          { filterType: 10, value: query }, // Search text
          { filterType: 8, value: 'Microsoft.VisualStudio.Code' }, // Target platform
        ],
        pageNumber,
        pageSize,
      }],
      flags: flags ?? (filterCompatible ? 914 : 0),
    });
    let extensions = data.results[0].extensions;

    // Add compatibility information
    if (this.compatibilityManager) {
      extensions = await Promise.all(
        extensions.map(async (ext: MarketplaceExtension & { extensionIdentifier?: string }) => {
          const compatibility = this.compatibilityManager.getCompatibilityInfo(ext.extensionIdentifier || ext.extensionId);
          return {
            ...ext,
            compatibility: {
              ribix: compatibility?.compatible ?? true,
              issues: compatibility?.issues || [],
              workarounds: compatibility?.workarounds || [],
            },
          };
        })
      );

      if (filterCompatible) {
        extensions = extensions.filter((ext: MarketplaceExtension) => 
          ext.compatibility?.ribix
        );
      }
    }

    return extensions;
  }

  /**
   * Get extension by ID
   */
  async getExtension(extensionId: string): Promise<MarketplaceExtension> {
    const data = await this.queryMarketplace<MarketplaceExtension>({
      filters: [{
        criteria: [{ filterType: 7, value: extensionId }],
        pageNumber: 1,
        pageSize: 1,
      }],
      flags: 914,
    });
    const extension = data.results[0].extensions[0];

    // Add compatibility information
    if (this.compatibilityManager) {
      const compatibility = this.compatibilityManager.getCompatibilityInfo(extensionId);
      extension.compatibility = {
        ribix: compatibility?.compatible ?? true,
        issues: compatibility?.issues || [],
        workarounds: compatibility?.workarounds || [],
      };
    }

    return extension;
  }

  /**
   * Get extension versions
   */
  async getExtensionVersions(extensionId: string): Promise<MarketplaceVersion[]> {
    const extension = await this.getExtension(extensionId);
    return extension.versions;
  }

  /**
   * Get extension manifest
   */
  async getExtensionManifest(extensionId: string, version?: string): Promise<any> {
    const extension = await this.getExtension(extensionId);
    const targetVersion = version || extension.versions[0].version;
    
    const versionFile = extension.versions.find((v: MarketplaceVersion) => v.version === targetVersion);
    if (!versionFile) {
      throw new Error('Version not found');
    }

    const vsixFile = versionFile.files.find((f: MarketplaceFile) => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
    if (!vsixFile) {
      throw new Error('VSIX file not found');
    }

    // Download and extract manifest
    // This would require additional implementation
    return {};
  }

  /**
   * Get popular extensions
   */
  async getPopularExtensions(category?: string): Promise<MarketplaceExtension[]> {
    const query = category ? `category:"${category}"` : '';
    return this.searchExtensions(query, { pageSize: 20 });
  }

  /**
   * Get trending extensions
   */
  async getTrendingExtensions(): Promise<MarketplaceExtension[]> {
    return this.searchExtensions('trending', { pageSize: 20 });
  }

  /**
   * Get recommended extensions
   */
  async getRecommendedExtensions(): Promise<MarketplaceExtension[]> {
    const recommendedIds = [
      'dbaeumer.vscode-eslint',
      'esbenp.prettier-vscode',
      'eamodio.gitlens',
      'ms-python.python',
      'ms-vscode.cpptools',
    ];

    return Promise.all(
      recommendedIds.map(id => this.getExtension(id))
    );
  }

  /**
   * Install extension
   */
  async installExtension(extensionId: string, version?: string): Promise<void> {
    const extension = await this.getExtension(extensionId);
    const targetVersion = version || extension.versions[0].version;
    
    const versionFile = extension.versions.find((v: MarketplaceVersion) => v.version === targetVersion);
    if (!versionFile) {
      throw new Error('Version not found');
    }

    const vsixFile = versionFile.files.find((f: MarketplaceFile) => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
    if (!vsixFile) {
      throw new Error('VSIX file not found');
    }

    // Download and install VSIX
    // This would require additional implementation
    console.log(`Installing ${extensionId} version ${targetVersion} from ${vsixFile.source}`);
  }

  /**
   * Get categories
   */
  async getCategories(): Promise<string[]> {
    const categories = [
      'Programming Languages',
      'Snippets',
      'Linters',
      'Themes',
      'Debuggers',
      'Formatters',
      'Keymaps',
      'SCM Providers',
      'Other',
      'Extension Packs',
      'Language Packs',
      'Data Science',
      'Machine Learning',
      'Notebooks',
      'Testing',
      'Visualization',
    ];
    return categories;
  }
}

/**
 * Extension Browser Store for React
 */
import { create } from 'zustand';

interface MarketplaceState {
  extensions: MarketplaceExtension[];
  categories: string[];
  searchQuery: string;
  selectedCategory: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  searchExtensions: (query: string) => Promise<void>;
  getPopularExtensions: (category?: string) => Promise<void>;
  getTrendingExtensions: () => Promise<void>;
  getRecommendedExtensions: () => Promise<void>;
  getCategories: () => Promise<void>;
  setSelectedCategory: (category: string | null) => void;
  setSearchQuery: (query: string) => void;
  setError: (error: string | null) => void;
}

const marketplaceClient = new VSCodeMarketplaceClient();

export const useMarketplaceStore = create<MarketplaceState>((set) => ({
  extensions: [],
  categories: [],
  searchQuery: '',
  selectedCategory: null,
  isLoading: false,
  error: null,

  setError: (error) => set({ error }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedCategory: (category) => set({ selectedCategory: category }),

  searchExtensions: async (query) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const extensions = await marketplaceClient.searchExtensions(query);
      set({ extensions, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Search failed',
        isLoading: false,
      });
    }
  },

  getPopularExtensions: async (category) => {
    set({ isLoading: true, error: null, selectedCategory: category || null });
    try {
      const extensions = await marketplaceClient.getPopularExtensions(category);
      set({ extensions, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load extensions',
        isLoading: false,
      });
    }
  },

  getTrendingExtensions: async () => {
    set({ isLoading: true, error: null });
    try {
      const extensions = await marketplaceClient.getTrendingExtensions();
      set({ extensions, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load trending',
        isLoading: false,
      });
    }
  },

  getRecommendedExtensions: async () => {
    set({ isLoading: true, error: null });
    try {
      const extensions = await marketplaceClient.getRecommendedExtensions();
      set({ extensions, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load recommendations',
        isLoading: false,
      });
    }
  },

  getCategories: async () => {
    try {
      const categories = await marketplaceClient.getCategories();
      set({ categories });
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  },
}));
