import * as vscode from 'vscode';
import { 
  extensionCompatibilityManager, 
  extensionMarketplaceCompatibility 
} from './extensionCompatibility';

/**
 * Register extension compatibility commands
 */
export function registerExtensionCompatibilityCommands(context: vscode.ExtensionContext): void {
  
  // Command: Check extension compatibility
  const checkCompatibilityCommand = vscode.commands.registerCommand(
    'ribix.checkExtensionCompatibility',
    async (extensionId: string) => {
      if (!extensionId) {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter extension ID (e.g., dbaeumer.vscode-eslint)',
          placeHolder: 'extension-id.publisher.extension-name'
        });
        if (!input) return;
        extensionId = input;
      }

      const info = extensionCompatibilityManager.getCompatibilityInfo(extensionId);
      
      if (!info) {
        vscode.window.showInformationMessage(
          `Extension ${extensionId} is not in the compatibility database. Assuming compatible.`
        );
        return;
      }

      const message = info.compatible
        ? `✅ ${extensionId} is compatible`
        : `⚠️ ${extensionId} has compatibility issues:\n${info.issues.join('\n')}\n\nWorkarounds:\n${info.workarounds.join('\n')}`;

      vscode.window.showInformationMessage(message);
    }
  );

  // Command: Generate compatibility report
  const reportCommand = vscode.commands.registerCommand(
    'ribix.generateCompatibilityReport',
    async () => {
      const report = extensionCompatibilityManager.generateCompatibilityReport();
      
      const doc = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown'
      });
      
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Compatibility report generated');
    }
  );

  // Command: Test extension compatibility
  const testCommand = vscode.commands.registerCommand(
    'ribix.testExtensionCompatibility',
    async () => {
      const extensionId = await vscode.window.showInputBox({
        prompt: 'Enter extension ID to test',
        placeHolder: 'extension-id.publisher.extension-name'
      });

      if (!extensionId) return;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing ${extensionId}...`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0 });
        const info = await extensionCompatibilityManager.testExtension(extensionId);
        progress.report({ increment: 100 });

        const message = info.compatible
          ? `✅ ${extensionId} is compatible`
          : `⚠️ ${extensionId} has compatibility issues`;
        
        vscode.window.showInformationMessage(message);
      });
    }
  );

  // Command: Install from marketplace with compatibility check
  const installCommand = vscode.commands.registerCommand(
    'ribix.installExtensionCompatible',
    async () => {
      const extensionId = await vscode.window.showInputBox({
        prompt: 'Enter extension ID from VS Code Marketplace',
        placeHolder: 'extension-id.publisher.extension-name'
      });

      if (!extensionId) return;

      const result = await extensionMarketplaceCompatibility.installExtension(extensionId);
      
      if (result.success) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showErrorMessage(result.message);
      }
    }
  );

  // Command: Show incompatible extensions
  const showIncompatibleCommand = vscode.commands.registerCommand(
    'ribix.showIncompatibleExtensions',
    async () => {
      const incompatible = extensionCompatibilityManager.getIncompatibleExtensions();
      
      if (incompatible.length === 0) {
        vscode.window.showInformationMessage('No known incompatible extensions');
        return;
      }

      const items = incompatible.map(ext => ({
        label: ext,
        description: extensionCompatibilityManager.getCompatibilityInfo(ext)?.issues.join(', ')
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an extension to see details'
      });

      if (selected) {
        const info = extensionCompatibilityManager.getCompatibilityInfo(selected.label);
        const message = `${selected.label}\n\nIssues: ${info?.issues.join('\n')}\n\nWorkarounds: ${info?.workarounds.join('\n')}`;
        vscode.window.showInformationMessage(message);
      }
    }
  );

  context.subscriptions.push(
    checkCompatibilityCommand,
    reportCommand,
    testCommand,
    installCommand,
    showIncompatibleCommand
  );
}

/**
 * Add extension compatibility menu items
 */
export function addExtensionCompatibilityMenuItems(): void {
  // Add to command palette
  // This is handled by the commands registered above
  
  // Could add context menu items here if needed
}