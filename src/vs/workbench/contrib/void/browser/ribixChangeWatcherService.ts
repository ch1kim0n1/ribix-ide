/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import Severity from '../../../../base/common/severity.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITextFileService } from '../../../../workbench/services/textfile/common/textfiles.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { IRibixFileLockService } from '../common/ribixFileLockService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { ChangedChunk, ChangedFile, isIgnoredPath, parseSampledDiffsToChunk } from '../common/ribixChangedChunk.js';

/** Auto-trigger policy. `off` = silent; `ask` = create + surface for approval; `auto` = run unattended. */
export type AutoTriggerMode = 'off' | 'ask' | 'auto';

/** Storage keys for the persisted auto-trigger settings (PROFILE-scoped, user target). */
export const RIBIX_AUTO_TRIGGER_MODE_KEY = 'ribix.autoTriggerMode';

/** Conservative default: never surprise the engineer. */
const DEFAULT_MODE: AutoTriggerMode = 'off';
const DEFAULT_DEBOUNCE_MS = 2500;
/** How long after an agent write we keep suppressing the same path (anti self-trigger). */
const SELF_WRITE_SUPPRESS_MS = 10_000;

export interface IRibixChangeWatcherService {
	readonly _serviceBrand: undefined;

	/** Current auto-trigger mode. */
	readonly mode: AutoTriggerMode;
	/** True when the watcher is actively listening (mode !== 'off'). */
	readonly enabled: boolean;

	/** Set the auto-trigger mode (persisted). */
	setMode(mode: AutoTriggerMode): void;
	/** Convenience toggle used by the Command Center: on => 'auto', off => 'off'. */
	setEnabled(on: boolean): void;

	/** Record that an agent just wrote these files so a subsequent save does not self-trigger. */
	noteAgentWrote(fsPaths: string[]): void;

	/** Fired with the debounced changed-file batch after filtering. */
	readonly onDidDetectChange: Event<ChangedChunk>;
	/** Fired whenever the mode changes (for UI). */
	readonly onDidChangeMode: Event<AutoTriggerMode>;
}

export const IRibixChangeWatcherService = createDecorator<IRibixChangeWatcherService>('ribixChangeWatcherService');

/** Test seam: lets unit tests inject a tiny debounce and a stub SCM service. */
type WatcherOptions = { debounceMs?: number; scmOverride?: IVoidSCMService };

export class RibixChangeWatcherService extends Disposable implements IRibixChangeWatcherService {
	readonly _serviceBrand: undefined;

	private readonly _onDidDetectChange = this._register(new Emitter<ChangedChunk>());
	readonly onDidDetectChange = this._onDidDetectChange.event;

	private readonly _onDidChangeMode = this._register(new Emitter<AutoTriggerMode>());
	readonly onDidChangeMode = this._onDidChangeMode.event;

	private _mode: AutoTriggerMode;
	private readonly debounceMs: number;

	/** Pending changed paths buffered during the debounce window (coalesces duplicates). */
	private readonly pending = new Set<string>();
	private readonly debounce: RunOnceScheduler;
	private readonly saveListener = this._register(new MutableDisposable());

	/** fsPath -> timestamp until which a save of this path is treated as a self-write. */
	private readonly recentlyWritten = new Map<string, number>();

	private readonly voidSCM: IVoidSCMService;

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@IRibixFileLockService private readonly fileLockService: IRibixFileLockService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IMainProcessService mainProcessService: IMainProcessService,
		options?: WatcherOptions,
	) {
		super();
		// IVoidSCMService lives in electron-main; resolve it via its IPC channel.
		// Tests inject a stub through options.scmOverride.
		this.voidSCM = options?.scmOverride ?? ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));
		this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;

		const stored = this.storageService.get(RIBIX_AUTO_TRIGGER_MODE_KEY, StorageScope.PROFILE);
		this._mode = (stored === 'ask' || stored === 'auto' || stored === 'off') ? stored : DEFAULT_MODE;

		this.debounce = this._register(new RunOnceScheduler(() => { void this.flush(); }, this.debounceMs));

		this.applyListening();
	}

	get mode(): AutoTriggerMode { return this._mode; }
	get enabled(): boolean { return this._mode !== 'off'; }

	setMode(mode: AutoTriggerMode): void {
		if (mode === this._mode) { return; }
		this._mode = mode;
		this.storageService.store(RIBIX_AUTO_TRIGGER_MODE_KEY, mode, StorageScope.PROFILE, StorageTarget.USER);
		this.applyListening();
		this._onDidChangeMode.fire(mode);
	}

	setEnabled(on: boolean): void {
		this.setMode(on ? 'auto' : 'off');
	}

	noteAgentWrote(fsPaths: string[]): void {
		const until = Date.now() + SELF_WRITE_SUPPRESS_MS;
		for (const p of fsPaths) {
			this.recentlyWritten.set(p, until);
		}
	}

	/** Attach/detach the save listener and clear pending state based on mode. */
	private applyListening(): void {
		if (!this.enabled) {
			this.saveListener.clear();
			this.pending.clear();
			this.debounce.cancel();
			return;
		}
		if (!this.saveListener.value) {
			this.saveListener.value = this.textFileService.files.onDidSave(e => {
				this.onSave(e.model.resource);
			});
		}
	}

	private onSave(resource: URI): void {
		if (!this.enabled) { return; }
		if (resource.scheme !== 'file') { return; }
		const fsPath = resource.fsPath;
		if (this.isSuppressed(fsPath)) { return; }
		if (!this.isInWorkspace(resource)) { return; }
		this.pending.add(fsPath);
		this.debounce.schedule();
	}

	private isSuppressed(fsPath: string): boolean {
		if (isIgnoredPath(fsPath)) { return true; }
		// A file currently locked by an agent is being written right now.
		if (this.fileLockService.isLocked(fsPath)) { return true; }
		// A file written by an agent within the suppression window.
		const until = this.recentlyWritten.get(fsPath);
		if (until !== undefined) {
			if (until > Date.now()) { return true; }
			this.recentlyWritten.delete(fsPath);
		}
		return false;
	}

	private isInWorkspace(resource: URI): boolean {
		try {
			return !!this.workspaceContextService.getWorkspaceFolder(resource);
		} catch {
			return false;
		}
	}

	private async flush(): Promise<void> {
		if (!this.enabled || this.pending.size === 0) { return; }
		const paths = [...this.pending];
		this.pending.clear();

		const branch = await this.getBranch();
		const files = await this.buildChangedFiles('save', paths);
		if (files.length === 0) { return; }

		const chunk: ChangedChunk = { trigger: 'save', files, branch, detectedAt: Date.now() };
		this._onDidDetectChange.fire(chunk);
		await this.launch(chunk);
	}

	/**
	 * Build the per-file ranges. We try to scope save-trigger ranges from the SCM
	 * sampled diff (the saved buffer is now on disk so `git diff` sees it); if SCM is
	 * unavailable we fall back to a whole-file entry (empty ranges) so the mission still
	 * runs. Files filtered to the just-saved set.
	 */
	private async buildChangedFiles(_trigger: 'save' | 'commit', savedPaths: string[]): Promise<ChangedFile[]> {
		const workspacePath = this.getWorkspacePath();
		let sampledFiles: ChangedFile[] = [];
		if (workspacePath) {
			try {
				const sampled = await this.voidSCM.gitSampledDiffs(workspacePath);
				sampledFiles = parseSampledDiffsToChunk(sampled);
			} catch {
				sampledFiles = [];
			}
		}
		const rangeByBasename = new Map<string, ChangedFile>();
		for (const f of sampledFiles) {
			rangeByBasename.set(this.basename(f.uri), f);
		}
		const result: ChangedFile[] = [];
		for (const p of savedPaths) {
			const matched = rangeByBasename.get(this.basename(p));
			result.push({ uri: URI.file(p).toString(), ranges: matched ? matched.ranges : [] });
		}
		return result;
	}

	private basename(p: string): string {
		const norm = p.replace(/\\/g, '/');
		const i = norm.lastIndexOf('/');
		return i >= 0 ? norm.slice(i + 1) : norm;
	}

	private async getBranch(): Promise<string | null> {
		const workspacePath = this.getWorkspacePath();
		if (!workspacePath) { return null; }
		try {
			return await this.voidSCM.gitBranch(workspacePath);
		} catch {
			return null;
		}
	}

	private getWorkspacePath(): string | null {
		try {
			const folders = this.workspaceContextService.getWorkspace().folders;
			return folders.length > 0 ? folders[0].uri.fsPath : null;
		} catch {
			return null;
		}
	}

	/** Create the scoped mission and surface a non-blocking notification. Never throws. */
	private async launch(chunk: ChangedChunk): Promise<void> {
		try {
			const mission = await this.missionService.createScopedQAMission(chunk);
			if (!mission) {
				// At concurrency cap — inform without interrupting.
				this.notificationService.notify({
					severity: Severity.Info,
					message: 'Ribix: auto-QA skipped (max concurrent missions reached).',
				});
				return;
			}
			const fileCount = chunk.files.length;
			this.notificationService.notify({
				severity: Severity.Info,
				message: this._mode === 'auto'
					? `Ribix is auto-running QA on ${fileCount} changed file(s).`
					: `Ribix prepared a QA mission for ${fileCount} changed file(s) — review it in the Command Center.`,
			});
		} catch (e) {
			// Auto path must never crash the IDE — surface as a quiet toast.
			this.notificationService.notify({
				severity: Severity.Info,
				message: 'Ribix: failed to start auto-QA (see logs).',
			});
			console.error('RibixChangeWatcherService.launch failed:', e);
		}
	}
}

// Registered via SyncDescriptor (Eager) because the constructor carries an optional
// non-service `options` arg (a test seam) that the branded-ctor overload rejects.
// The DI container only supplies the leading services; `options` stays undefined.
registerSingleton(
	IRibixChangeWatcherService,
	new SyncDescriptor(RibixChangeWatcherService, [], /* supportsDelayedInstantiation */ false),
);
