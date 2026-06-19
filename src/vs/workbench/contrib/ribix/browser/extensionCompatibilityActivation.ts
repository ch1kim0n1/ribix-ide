/**
 * Extension Compatibility Activation
 * Call this from the main extension activation file
 */

import * as vscode from 'vscode';
import { registerExtensionCompatibilityCommands } from './extensionCompatibilityCommands.js';

/**
 * Activate extension compatibility system
 * Call this from your extension's activate() function
 */
export function activateExtensionCompatibility(context: vscode.ExtensionContext): void {
  console.log('Activating Ribix IDE Extension Compatibility System...');
  
  // Register all extension compatibility commands
  registerExtensionCompatibilityCommands(context);
  
  console.log('Extension Compatibility System activated');
  console.log('Available commands:');
  console.log('  - ribix.checkExtensionCompatibility');
  console.log('  - ribix.generateCompatibilityReport');
  console.log('  - ribix.testExtensionCompatibility');
  console.log('  - ribix.installExtensionCompatible');
  console.log('  - ribix.showIncompatibleExtensions');
}

/**
 * Deactivate extension compatibility system
 */
export function deactivateExtensionCompatibility(): void {
  console.log('Deactivating Extension Compatibility System');
}