/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export const IRibixFileWatcherService = createDecorator<IRibixFileWatcherService>('ribixFileWatcherService');

export interface IRibixFileWatcherService {
	readonly _serviceBrand: undefined;
	start(): Promise<void>;
	stop(): void;
	updateConfig(config: Partial<WatcherConfig>): void;
	getConfig(): WatcherConfig;
}

interface FileChange {
	resource: URI;
	type: 'added' | 'updated' | 'deleted';
}

interface WatcherConfig {
	enabled: boolean;
	debounceMs: number;
	ignorePatterns: string[];
	triggerOnSave: boolean;
	triggerOnChange: boolean;
}

export class RibixFileWatcherService extends Disposable implements IRibixFileWatcherService {
	readonly _serviceBrand: undefined;
	static readonly ID = 'ribixFileWatcherService';

	private _isDisposed = false;
	private _watcher: IDisposable | null = null;
	private _pendingChanges = new Map<string, FileChange>();
	private _debounceTimer: number | null = null;
	private _config: WatcherConfig = {
		enabled: true,
		debounceMs: 3000, // 3 seconds debounce
		ignorePatterns: [
			'**/node_modules/**',
			'**/.git/**',
			'**/dist/**',
			'**/build/**',
			'**/.next/**',
			'**/*.log',
			'**/coverage/**',
		],
		triggerOnSave: true,
		triggerOnChange: false,
	};

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super();
		this.logService.info('[RibixFileWatcher] Initializing file watcher service');
	}

	async start(): Promise<void> {
		if (this._isDisposed) {
			this.logService.warn('[RibixFileWatcher] Cannot start: service is disposed');
			return;
		}

		const workspacePath = await this.getWorkspacePath();
		if (!workspacePath) {
			this.logService.warn('[RibixFileWatcher] No workspace path available');
			return;
		}

		this.logService.info(`[RibixFileWatcher] Starting file watcher for workspace: ${workspacePath}`);

		// Create file system watcher
		this._watcher = this.fileService.watch(URI.file(workspacePath), {
			recursive: true,
			excludes: this._config.ignorePatterns,
		}) as any;

		// Listen to file changes
		(this._watcher as any).onDidChangeFile((changes: FileChange[]) => {
			this.handleFileChanges(changes);
		});

		this.logService.info('[RibixFileWatcher] File watcher started successfully');
	}

	stop(): void {
		if (this._watcher) {
			this._watcher.dispose();
			this._watcher = null;
		}

		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = null;
		}

		this._pendingChanges.clear();
		this.logService.info('[RibixFileWatcher] File watcher stopped');
	}

	private async handleFileChanges(changes: FileChange[]): Promise<void> {
		if (!this._config.enabled) {
			return;
		}

		this.logService.debug(`[RibixFileWatcher] Handling ${changes.length} file changes`);

		// Filter changes based on configuration
		const relevantChanges = changes.filter(change => {
			return this.isRelevantChange(change);
		});

		if (relevantChanges.length === 0) {
			return;
		}

		// Add to pending changes
		for (const change of relevantChanges) {
			const key = change.resource.toString();
			this._pendingChanges.set(key, change);
		}

		// Debounce and trigger mission
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = window.setTimeout(() => {
			this.triggerAutoMission();
		}, this._config.debounceMs);
	}

	private isRelevantChange(change: FileChange): boolean {
		const path = change.resource.fsPath;

		// Check ignore patterns
		for (const pattern of this._config.ignorePatterns) {
			if (this.matchPattern(path, pattern)) {
				return false;
			}
		}

		// Only trigger on specific file types
		const relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.py', '.go', '.rs', '.java'];
		const hasRelevantExtension = relevantExtensions.some(ext => path.endsWith(ext));

		return hasRelevantExtension;
	}

	private matchPattern(path: string, pattern: string): boolean {
		// Simple glob pattern matching
		const regexPattern = pattern
			.replace(/\*\*/g, '.*')
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '.');
		const regex = new RegExp(regexPattern);
		return regex.test(path);
	}

	private async triggerAutoMission(): Promise<void> {
		if (this._pendingChanges.size === 0) {
			return;
		}

		const changedFiles = Array.from(this._pendingChanges.values());
		this._pendingChanges.clear();

		this.logService.info(`[RibixFileWatcher] Triggering auto mission for ${changedFiles.length} changed files`);

		try {
			const workspacePath = await this.getWorkspacePath();
			if (!workspacePath) {
				this.logService.warn('[RibixFileWatcher] No workspace path for auto mission');
				return;
			}

			// Create mission with changed files context
			const missionId = await (this.missionService as any).createMission({
				description: 'Auto-triggered QA check for recent file changes',
				outcome: '',
				branchName: await this.getCurrentBranch(),
				context: {
					attachedFiles: changedFiles.map(c => c.resource.fsPath),
					attachedSelections: [],
					issueUrls: [],
				},
			});

			this.logService.info(`[RibixFileWatcher] Created auto mission: ${missionId}`);

			// Submit for planning
			await this.missionService.submitForPlanning(missionId as any);

			this.logService.info(`[RibixFileWatcher] Auto mission submitted for planning: ${missionId}`);
		} catch (error) {
			this.logService.error('[RibixFileWatcher] Failed to trigger auto mission', error);
		}
	}

	private async getWorkspacePath(): Promise<string | null> {
		const workspace = this.workspaceService.getWorkspace();
		return workspace?.folders[0]?.uri.fsPath ?? null;
	}

	private async getCurrentBranch(): Promise<string> {
		// This would integrate with the SCM service
		// For now, return a placeholder
		return 'auto-trigger-branch';
	}

	updateConfig(config: Partial<WatcherConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info('[RibixFileWatcher] Configuration updated', this._config);
	}

	getConfig(): WatcherConfig {
		return { ...this._config };
	}

	override dispose(): void {
		this._isDisposed = true;
		this.stop();
	}
}

registerWorkbenchContribution2(RibixFileWatcherService.ID, RibixFileWatcherService, WorkbenchPhase.BlockRestore);

registerSingleton(IRibixFileWatcherService, RibixFileWatcherService, InstantiationType.Delayed);