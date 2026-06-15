/**
 * Auto-Update System for Ribix IDE
 * Supports both desktop (Electron) and web versions
 */

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  changelog: string;
  downloadUrl: string;
  signature?: string;
  size: number;
  mandatory: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  updateInfo?: UpdateInfo;
}

export class AutoUpdateManager {
  private currentVersion: string;
  private updateCheckUrl: string;
  private platform: 'win32' | 'darwin' | 'linux' | 'web';
  private checkInterval: number = 3600000; // 1 hour
  private checkTimer: NodeJS.Timeout | null = null;
  private onUpdateAvailable?: (update: UpdateInfo) => void;
  private onDownloadProgress?: (progress: number) => void;
  private onUpdateDownloaded?: (update: UpdateInfo) => void;

  constructor(config: {
    currentVersion: string;
    updateCheckUrl: string;
    platform?: 'win32' | 'darwin' | 'linux' | 'web';
    checkInterval?: number;
  }) {
    this.currentVersion = config.currentVersion;
    this.updateCheckUrl = config.updateCheckUrl;
    this.platform = config.platform || (typeof window !== 'undefined' ? 'web' : process.platform as any);
    this.checkInterval = config.checkInterval || this.checkInterval;
  }

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const response = await fetch(this.updateCheckUrl, {
        headers: {
          'X-Current-Version': this.currentVersion,
          'X-Platform': this.platform,
        },
      });

      if (!response.ok) {
        throw new Error('Update check failed');
      }

      const updateInfo: UpdateInfo = await response.json();
      
      const hasUpdate = this.compareVersions(updateInfo.version, this.currentVersion) > 0;

      return {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion: updateInfo.version,
        updateInfo: hasUpdate ? updateInfo : undefined,
      };
    } catch (error) {
      console.error('Update check failed:', error);
      return {
        hasUpdate: false,
        currentVersion: this.currentVersion,
        latestVersion: this.currentVersion,
      };
    }
  }

  /**
   * Download update
   */
  async downloadUpdate(updateInfo: UpdateInfo): Promise<void> {
    if (this.platform === 'web') {
      // Web version doesn't need manual download
      console.log('Web version will auto-update on next refresh');
      return;
    }

    try {
      const response = await fetch(updateInfo.downloadUrl);
      const reader = response.body?.getReader();
      const contentLength = response.headers.get('Content-Length');
      let receivedLength = 0;

      if (!reader) {
        throw new Error('Failed to download update');
      }

      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;

        if (contentLength && this.onDownloadProgress) {
          const progress = (receivedLength / parseInt(contentLength)) * 100;
          this.onDownloadProgress(progress);
        }
      }

      const blob = new Blob(chunks);
      // Save and install update
      await this.installUpdate(blob, updateInfo);
      
      if (this.onUpdateDownloaded) {
        this.onUpdateDownloaded(updateInfo);
      }
    } catch (error) {
      console.error('Update download failed:', error);
      throw error;
    }
  }

  /**
   * Install update
   */
  private async installUpdate(blob: Blob, updateInfo: UpdateInfo): Promise<void> {
    if (this.platform === 'win32') {
      await this.installWindowsUpdate(blob, updateInfo);
    } else if (this.platform === 'darwin') {
      await this.installMacUpdate(blob, updateInfo);
    } else if (this.platform === 'linux') {
      await this.installLinuxUpdate(blob, updateInfo);
    }
  }

  private async installWindowsUpdate(blob: Blob, updateInfo: UpdateInfo): Promise<void> {
    // For Electron on Windows, use the auto-updater
    // This would be handled by Electron's built-in auto-updater
    console.log('Installing Windows update:', updateInfo.version);
  }

  private async installMacUpdate(blob: Blob, updateInfo: UpdateInfo): Promise<void> {
    // For Electron on macOS, use the auto-updater
    console.log('Installing macOS update:', updateInfo.version);
  }

  private async installLinuxUpdate(blob: Blob, updateInfo: UpdateInfo): Promise<void> {
    // For Electron on Linux, use the auto-updater
    console.log('Installing Linux update:', updateInfo.version);
  }

  /**
   * Restart and apply update
   */
  async restartAndApplyUpdate(): Promise<void> {
    if (this.platform === 'web') {
      window.location.reload();
    } else {
      // Electron would handle this
      console.log('Restarting to apply update...');
    }
  }

  /**
   * Compare version strings
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Start automatic update checking
   */
  startAutoUpdateCheck(): void {
    this.stopAutoUpdateCheck();
    
    // Check immediately
    this.checkForUpdates().then((result) => {
      if (result.hasUpdate && result.updateInfo && this.onUpdateAvailable) {
        this.onUpdateAvailable(result.updateInfo);
      }
    });

    // Schedule periodic checks
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().then((result) => {
        if (result.hasUpdate && result.updateInfo && this.onUpdateAvailable) {
          this.onUpdateAvailable(result.updateInfo);
        }
      });
    }, this.checkInterval);
  }

  /**
   * Stop automatic update checking
   */
  stopAutoUpdateCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Set update callbacks
   */
  setCallbacks(callbacks: {
    onUpdateAvailable?: (update: UpdateInfo) => void;
    onDownloadProgress?: (progress: number) => void;
    onUpdateDownloaded?: (update: UpdateInfo) => void;
  }): void {
    this.onUpdateAvailable = callbacks.onUpdateAvailable;
    this.onDownloadProgress = callbacks.onDownloadProgress;
    this.onUpdateDownloaded = callbacks.onUpdateDownloaded;
  }
}

/**
 * Update Store for React
 */
import { create } from 'zustand';

interface UpdateState {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  updateInfo: UpdateInfo | null;
  isDownloading: boolean;
  downloadProgress: number;
  isChecking: boolean;
  error: string | null;
  
  // Actions
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  setError: (error: string | null) => void;
}

let updateManager: AutoUpdateManager | null = null;

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  currentVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateInfo: null,
  isDownloading: false,
  downloadProgress: 0,
  isChecking: false,
  error: null,

  setError: (error) => set({ error }),

  checkForUpdates: async () => {
    set({ isChecking: true, error: null });
    
    if (!updateManager) {
      updateManager = new AutoUpdateManager({
        currentVersion: '1.0.0',
        updateCheckUrl: process.env.NEXT_PUBLIC_UPDATE_URL || 'https://api.ribix.dev/updates/check',
        platform: 'web',
      });

      updateManager.setCallbacks({
        onUpdateAvailable: (update) => {
          set({
            hasUpdate: true,
            updateInfo: update,
            latestVersion: update.version,
          });
        },
        onDownloadProgress: (progress) => {
          set({ downloadProgress: progress });
        },
        onUpdateDownloaded: (update) => {
          set({ isDownloading: false });
        },
      });
    }

    try {
      const result = await updateManager.checkForUpdates();
      set({
        hasUpdate: result.hasUpdate,
        latestVersion: result.latestVersion,
        updateInfo: result.updateInfo || null,
        isChecking: false,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Update check failed',
        isChecking: false,
      });
    }
  },

  downloadUpdate: async () => {
    const { updateInfo } = useUpdateStore.getState();
    if (!updateInfo) {
      set({ error: 'No update available' });
      return;
    }

    set({ isDownloading: true, downloadProgress: 0, error: null });

    try {
      await updateManager.downloadUpdate(updateInfo);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Download failed',
        isDownloading: false,
      });
    }
  },

  installUpdate: async () => {
    try {
      await updateManager?.restartAndApplyUpdate();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Install failed',
      });
    }
  },

  dismissUpdate: () => {
    set({ hasUpdate: false, updateInfo: null });
  },
}));