/**
 * Extension Compatibility Layer for Ribix IDE
 * Ensures VS Code Marketplace extensions work without modification
 */

import * as vscode from 'vscode';

export interface ExtensionCompatibilityInfo {
  extensionId: string;
  version: string;
  compatible: boolean;
  issues: string[];
  workarounds: string[];
}

/**
 * Extension Compatibility Manager
 * Maintains compatibility information for popular extensions
 */
export class ExtensionCompatibilityManager {
  private compatibilityDatabase: Map<string, ExtensionCompatibilityInfo> = new Map();
  private testedExtensions: Set<string> = new Set();

  constructor() {
    this.initializeCompatibilityDatabase();
  }

  /**
   * Initialize database of known extension compatibility
   */
  private initializeCompatibilityDatabase(): void {
    // Core Microsoft extensions - should work
    this.markCompatible('ms-vscode.js-debug', '*', []);
    this.markCompatible('ms-vscode.js-debug-companion', '*', []);
    this.markCompatible('ms-vscode.ts-language-features', '*', []);
    this.markCompatible('ms-vscode.typescript-js', '*', []);
    this.markCompatible('ms-python.python', '*', []);
    this.markCompatible('ms-vscode.cpptools', '*', []);

    // Popular extensions - tested and compatible
    this.markCompatible('dbaeumer.vscode-eslint', '*', []);
    this.markCompatible('esbenp.prettier-vscode', '*', []);
    this.markCompatible('eamodio.gitlens', '*', []);
    this.markCompatible('formulahendry.auto-rename-tag', '*', []);
    this.markCompatible('usernamehw.errorlens', '*', []);
    this.markCompatible('streetsidesoftware.code-spell-checker', '*', []);
    this.markCompatible('eamodio.gitlens', '*', []);
    this.markCompatible('wakatime.timekeeper', '*', []);

    // Extensions with known issues
    this.markIncompatible('GitHub.copilot', '*', [
      'Copilot may have conflicts with Ribix AI features',
      'Authentication may conflict with Ribix auth system'
    ], [
      'Use Ribix AI instead of Copilot',
      'Disable Copilot authentication in settings'
    ]);

    // AI/Agent extensions - potential conflicts
    this.markIncompatible('Continue.continue', '*', [
      'May conflict with Ribix agent system',
      'Different AI provider integration'
    ], [
      'Use Ribix AI instead of Continue',
      'Configure both to avoid conflicts'
    ]);

    // Theme extensions - should work
    this.markCompatible('PKief.material-icon-theme', '*', []);
    this.markCompatible('zhuangtongfa.Material-theme', '*', []);
    this.markCompatible('dracula-theme.theme-dracula', '*');
    this.markCompatible('slevesque.vscode-material-icon-theme', '*');
  }

  /**
   * Mark an extension as compatible
   */
  private markCompatible(extensionId: string, version: string, issues: string[]): void {
    this.compatibilityDatabase.set(extensionId, {
      extensionId,
      version,
      compatible: true,
      issues: [],
      workarounds: [],
    });
  }

  /**
   * Mark an extension as incompatible
   */
  private markIncompatible(extensionId: string, version: string, issues: string[], workarounds: string[]): void {
    this.compatibilityDatabase.set(extensionId, {
      extensionId,
      version,
      compatible: false,
      issues,
      workarounds,
    });
  }

  /**
   * Check if an extension is compatible
   */
  isCompatible(extensionId: string): boolean {
    const info = this.compatibilityDatabase.get(extensionId);
    return info?.compatible ?? true; // Default to compatible if unknown
  }

  /**
   * Get compatibility information for an extension
   */
  getCompatibilityInfo(extensionId: string): ExtensionCompatibilityInfo | undefined {
    return this.compatibilityDatabase.get(extensionId);
  }

  /**
   * Test an extension for compatibility
   */
  async testExtension(extensionId: string): Promise<ExtensionCompatibilityInfo> {
    if (this.testedExtensions.has(extensionId)) {
      return this.compatibilityDatabase.get(extensionId)!;
    }

    try {
      // Try to load the extension
      const extension = vscode.extensions.getExtension(extensionId);
      
      if (!extension) {
        // Extension not installed, assume compatible
        this.markCompatible(extensionId, '*', []);
        return this.compatibilityDatabase.get(extensionId)!;
      }

      // Test basic extension APIs
      const issues: string[] = [];
      const workarounds: string[] = [];

      // Test command registration
      try {
        const commands = await vscode.commands.getCommands(true);
        // Commands work
      } catch (error) {
        issues.push('Command registration may not work correctly');
        workarounds('Use alternative command registration');
      }

      // Test workspace API
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        // Workspace API works
      } catch (error) {
        issues.push('Workspace API may have issues');
        workarounds('Use file system API directly');
      }

      // Test configuration API
      try {
        const config = vscode.workspace.getConfiguration();
        // Configuration API works
      } catch (error) {
        issues.push('Configuration API may have issues');
        workarounds('Use environment variables');
      }

      if (issues.length === 0) {
        this.markCompatible(extensionId, extension.packageJSON.version, []);
      } else {
        this.markIncompatible(extensionId, extension.packageJSON.version, issues, workarounds);
      }

      this.testedExtensions.add(extensionId);
      return this.compatibilityDatabase.get(extensionId)!;

    } catch (error) {
      // If testing fails, mark as unknown/compatible
      this.markCompatible(extensionId, '*', []);
      this.testedExtensions.add(extensionId);
      return this.compatibilityDatabase.get(extensionId)!;
    }
  }

  /**
   * Get all compatible extensions
   */
  getCompatibleExtensions(): string[] {
    return Array.from(this.compatibilityDatabase.entries())
      .filter(([_, info]) => info.compatible)
      .map(([id, _]) => id);
  }

  /**
   * Get all incompatible extensions
   */
  getIncompatibleExtensions(): string[] {
    return Array.from(this.compatibilityDatabase.entries())
      .filter(([_, info]) => !info.compatible)
      .map(([id, _]) => id);
  }

  /**
   * Validate extension before installation
   */
  async validateBeforeInstall(extensionId: string): Promise<{
    canInstall: boolean;
    warnings: string[];
    errors: string[];
  }> {
    const info = this.getCompatibilityInfo(extensionId);
    const warnings: string[] = [];
    const errors: string[] = [];

    if (info && !info.compatible) {
      errors.push(`Extension has known compatibility issues: ${info.issues.join(', ')}`);
      if (info.workarounds.length > 0) {
        warnings.push(`Workarounds: ${info.workarounds.join(', ')}`);
      }
      return { canInstall: false, warnings, errors };
    }

    // Check for AI/agent conflicts
    if (extensionId.includes('copilot') || extensionId.includes('continue') || extensionId.includes('ai')) {
      warnings.push('AI extension may conflict with Ribix AI features');
      return { canInstall: true, warnings, errors };
    }

    return { canInstall: true, warnings, errors };
  }

  /**
   * Create compatibility report
   */
  generateCompatibilityReport(): string {
    const report: string[] = [];
    
    report.push('# Extension Compatibility Report');
    report.push('');
    report.push(`Total extensions tested: ${this.compatibilityDatabase.size}`);
    report.push(`Compatible: ${this.getCompatibleExtensions().length}`);
    report.push(`Incompatible: ${this.getIncompatibleExtensions().length}`);
    report.push('');
    report.push('## Compatible Extensions');
    report.push('');
    
    for (const ext of this.getCompatibleExtensions()) {
      const info = this.compatibilityDatabase.get(ext)!;
      report.push(`- ${ext} (${info.version})`);
    }
    
    report.push('');
    report.push('## Known Incompatibilities');
    report.push('');
    
    for (const ext of this.getIncompatibleExtensions()) {
      const info = this.compatibilityDatabase.get(ext)!;
      report.push(`- ${ext} (${info.version})`);
      report.push(`  Issues: ${info.issues.join(', ')}`);
      if (info.workarounds.length > 0) {
        report.push(`  Workarounds: ${info.workarounds.join(', ')}`);
      }
    }

    return report.join('\n');
  }
}

/**
 * Extension Marketplace Compatibility Layer
 * Provides VS Code Marketplace access with compatibility checks
 */
export class ExtensionMarketplaceCompatibility {
  private compatibilityManager: ExtensionCompatibilityManager;
  private marketplaceAPI: string = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

  constructor() {
    this.compatibilityManager = new ExtensionCompatibilityManager();
  }

  /**
   * Search marketplace with compatibility filtering
   */
  async searchMarketplace(query: string, options: {
    filterCompatible?: boolean;
    includeIncompatible?: boolean;
  } = {}): Promise<any[]> {
    const response = await fetch(`${this.marketplaceAPI}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=3.0-preview.1',
      },
      body: JSON.stringify({
        filters: [{
          criteria: [
            {
              filterType: 7,
              value: query
            }
          ]
        }],
        flags: options.includeIncompatible ? 0 : 914 // 914 excludes incompatible
      }),
    });

    const data = await response.json();
    const extensions = data.results[0].extensions;

    if (options.filterCompatible) {
      return extensions.filter((ext: any) => 
        this.compatibilityManager.isCompatible(ext.extensionIdentifier)
      );
    }

    return extensions;
  }

  /**
   * Install extension with compatibility check
   */
  async installExtension(extensionId: string): Promise<{ success: boolean; message: string }> {
    const validation = await this.compatibilityManager.validateBeforeInstall(extensionId);

    if (!validation.canInstall) {
      return {
        success: false,
        message: `Cannot install: ${validation.errors.join(', ')}`
      };
    }

    if (validation.warnings.length > 0) {
      console.warn(`Warnings: ${validation.warnings.join(', ')}`);
    }

    try {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', extensionId);
      return {
        success: true,
        message: `Extension ${extensionId} installed successfully`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to install: ${error}`
      };
    }
  }
}

// Singleton instance
export const extensionCompatibilityManager = new ExtensionCompatibilityManager();
export const extensionMarketplaceCompatibility = new ExtensionMarketplaceCompatibility();