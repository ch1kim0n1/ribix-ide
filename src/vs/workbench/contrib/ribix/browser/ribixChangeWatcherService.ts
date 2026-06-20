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
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IRibixSCMService } from '../common/ribixSCMTypes.js';
import { IRibixFileLockService } from '../common/ribixFileLockService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { renderFindingsAsMarkers } from './ribixMarkerRendering.js';
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

/** Test seam: lets unit tests inject a tiny debounce and stub SCM/agent/marker/file services. */
type WatcherOptions = {
	debounceMs?: number;
	scmOverride?: IRibixSCMService;
	agentOverride?: IRibixAgentService;
	markerOverride?: IMarkerService;
	fileOverride?: IFileService;
};

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

	private readonly ribixSCM: IRibixSCMService;
	private readonly agentService: IRibixAgentService | undefined;
	private readonly markerService: IMarkerService | undefined;
	private readonly fileService: IFileService | undefined;

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@IRibixFileLockService private readonly fileLockService: IRibixFileLockService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IRibixAgentService agentService: IRibixAgentService,
		@IMarkerService markerService: IMarkerService,
		@IFileService fileService: IFileService,
		options?: WatcherOptions,
	) {
		super();
		// IRibixSCMService lives in electron-main; resolve it via its IPC channel.
		// Tests inject a stub through options.scmOverride.
		this.ribixSCM = options?.scmOverride ?? ProxyChannel.toService<IRibixSCMService>(mainProcessService.getChannel('ribix-channel-scm'));
		this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		// The agent/marker/file services are only needed for the unattended `auto` run.
		// Tests inject stubs through options so they can assert marker rendering without
		// pulling in the full DI graph; production gets them from the container.
		this.agentService = options?.agentOverride ?? agentService;
		this.markerService = options?.markerOverride ?? markerService;
		this.fileService = options?.fileOverride ?? fileService;

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
		const now = Date.now();
		// Opportunistically drop expired entries so the map can't grow unbounded
		// across a long session of writes to distinct, never-re-saved files.
		for (const [p, until] of this.recentlyWritten) {
			if (until <= now) { this.recentlyWritten.delete(p); }
		}
		const until = now + SELF_WRITE_SUPPRESS_MS;
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
				const sampled = await this.ribixSCM.gitSampledDiffs(workspacePath);
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
			return await this.ribixSCM.gitBranch(workspacePath);
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

			// `auto` mode runs unattended: spawn a lightweight Reviewer agent scoped to the
			// changed files and surface findings inline as Problems-panel markers. `ask` mode
			// leaves the prepared mission for in-panel approval (G-AUTOTRIGGER, issue #58).
			if (this._mode === 'auto') {
				void this.runUnattendedDetection(mission.id, chunk);
			}
		} catch (e) {
			// Auto path must never crash the IDE — surface as a quiet toast.
			this.notificationService.notify({
				severity: Severity.Info,
				message: 'Ribix: failed to start auto-QA (see logs).',
			});
			console.error('RibixChangeWatcherService.launch failed:', e);
		}
	}

	/**
	 * Spawn a single Reviewer agent over the changed files, await completion, and render the
	 * findings as markers. Fire-and-forget from `launch` so the debounce loop never blocks on
	 * the (potentially slow) agent run. Every step is best-effort: a failure surfaces a quiet
	 * toast and never throws into the watcher.
	 */
	private async runUnattendedDetection(missionId: string, chunk: ChangedChunk): Promise<void> {
		if (!this.agentService || !this.markerService || !this.fileService) {
			return; // No agent/marker/file services available (e.g. stripped test build).
		}
		const fileList = chunk.files.map(f => f.uri);
		if (fileList.length === 0) { return; }

		const taskDescription =
			`Review ONLY the following changed file(s), scoped to the saved ranges where available: ${fileList.join(', ')}. ` +
			`Report concrete findings (bugs, ai-smell, day-2 failures, observability gaps, and the other detection ` +
			`categories) as a fenced JSON array of {severity, file, line, message, findingType}. Do not modify any file.`;

		let agentId: string;
		try {
			agentId = await this.agentService.spawnAgent(
				missionId,
				`auto-${Date.now()}`,
				'reviewer',
				taskDescription,
				{ attachedContext: `Auto QA on changed chunk (trigger: ${chunk.trigger}).` },
			);
		} catch (e) {
			this.notificationService.notify({
				severity: Severity.Info,
				message: `Ribix: auto-QA could not start: ${e instanceof Error ? e.message : String(e)}`,
			});
			return;
		}

		// Wait for THIS agent to finish. The watcher is not blocked — this promise is awaited
		// only by the fire-and-forget caller in `launch`. The listener is registered with the
		// service so a dispose() during a long run cleans it up (no leaked disposables).
		const result = await new Promise<{ status: 'complete' | 'failed' }>(resolve => {
			const listener = this._register(this.agentService!.onDidCompleteAgent(e => {
				if (e.agentId !== agentId) { return; }
				listener.dispose();
				resolve({ status: e.status });
			}));
		});
		if (result.status === 'failed') {
			this.notificationService.notify({ severity: Severity.Info, message: 'Ribix: auto-QA run failed.' });
			return;
		}

		const agent = this.agentService.getAgent(agentId);
		const rawFindings = agent?.output?.findings ?? [];
		try {
			const { visible, suppressed } = await renderFindingsAsMarkers(
				this.markerService, this.fileService, this.workspaceContextService, rawFindings,
			);
			const suffix = suppressed > 0 ? ` (${suppressed} suppressed by .ribixignore)` : '';
			if (visible === 0) {
				this.notificationService.notify({ severity: Severity.Info, message: `Ribix: auto-QA found no issues${suffix}.` });
			} else {
				this.notificationService.notify({
					severity: Severity.Info,
					message: `Ribix: auto-QA reported ${visible} finding(s)${suffix}. See the Problems panel.`,
				});
			}
		} catch (e) {
			console.error('RibixChangeWatcherService.runUnattendedDetection render failed:', e);
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
