/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { RibixFileSnapshot } from '../common/editCodeServiceTypes.js';
import { IRibixModelService } from '../common/ribixModelService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export type MissionCheckpoint = {
	id: string;
	missionId: string;
	agentId: string;
	filePath: string;
	snapshot: RibixFileSnapshot;
	timestamp: number;
	/**
	 * Whether the file existed on disk when the checkpoint was taken (i.e. before the
	 * agent's write). If false, the file was *created* by the agent and rolling back
	 * means deleting it rather than restoring (empty) content.
	 */
	existedAtCheckpoint: boolean;
};

export interface IRibixCheckpointService {
	readonly _serviceBrand: undefined;

	// Create checkpoint
	checkpoint(missionId: string, agentId: string, filePath: string): Promise<MissionCheckpoint>;

	// Rollback operations
	rollbackFile(checkpointId: string): Promise<void>;
	rollbackAgent(agentId: string): Promise<void>;
	rollbackMission(missionId: string): Promise<void>;

	// Query
	getCheckpoints(missionId?: string, agentId?: string, filePath?: string): MissionCheckpoint[];
	getCheckpoint(checkpointId: string): MissionCheckpoint | null;

	// Events
	onDidChangeCheckpoints: Event<void>;
}

export const IRibixCheckpointService = createDecorator<IRibixCheckpointService>('ribixCheckpointService');

const CHECKPOINT_STORAGE_KEY = 'ribix.checkpoints';

class RibixCheckpointService extends Disposable implements IRibixCheckpointService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeCheckpoints = new Emitter<void>();
	readonly onDidChangeCheckpoints = this._onDidChangeCheckpoints.event;

	private checkpoints: MissionCheckpoint[] = [];

	/**
	 * Ids of checkpoints already restored, so a second rollback of the same checkpoint
	 * (e.g. double rollbackMission, or rollbackAgent followed by rollbackMission) is a
	 * no-op. Kept in memory only — it scopes idempotency to the running session.
	 */
	private readonly rolledBackIds = new Set<string>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IRibixModelService private readonly ribixModelService: IRibixModelService,
		@IEditCodeService private readonly editCodeService: IEditCodeService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		const stored = this.storageService.get(CHECKPOINT_STORAGE_KEY, StorageScope.WORKSPACE);
		if (stored) {
			try {
				this.checkpoints = JSON.parse(stored as string);
				// Back-compat: checkpoints persisted before `existedAtCheckpoint` existed
				// must default to true so rollback restores content rather than deleting.
				for (const cp of this.checkpoints) {
					if (cp.existedAtCheckpoint === undefined) { cp.existedAtCheckpoint = true; }
				}
			} catch { this.checkpoints = []; }
		}
	}

	async checkpoint(missionId: string, agentId: string, filePath: string): Promise<MissionCheckpoint> {
		const uri = URI.file(filePath);

		// Record whether the file already existed before the agent's write. A file that
		// does not exist now is being *created* — rolling back must delete it.
		const existedAtCheckpoint = await this.fileService.exists(uri);

		// Get the current model to capture the snapshot. For a not-yet-created file the
		// model is empty; that's fine because rollback deletes it rather than restoring.
		await this.ribixModelService.initializeModel(uri);
		const { model } = this.ribixModelService.getModel(uri);

		// Create a snapshot with the current file content
		const snapshot: RibixFileSnapshot = {
			snapshottedDiffAreaOfId: {}, // Empty diff areas - we only care about file content for rollback
			entireFileCode: model ? model.getValue(EndOfLinePreference.LF) : '',
		};

		const checkpoint: MissionCheckpoint = {
			id: generateUuid(),
			missionId,
			agentId,
			filePath,
			snapshot,
			timestamp: Date.now(),
			existedAtCheckpoint,
		};

		this.checkpoints.push(checkpoint);
		this.saveCheckpoints();
		this._onDidChangeCheckpoints.fire();

		return checkpoint;
	}

	async rollbackFile(checkpointId: string): Promise<void> {
		const checkpoint = this.getCheckpoint(checkpointId);
		if (!checkpoint) {
			throw new Error(`Checkpoint with id ${checkpointId} not found`);
		}

		await this.restoreCheckpoint(checkpoint);
		this.saveCheckpoints();
	}

	async rollbackAgent(agentId: string): Promise<void> {
		const agentCheckpoints = this.checkpoints.filter(cp => cp.agentId === agentId);

		// Rollback in reverse chronological order (most recent first).
		const ordered = [...agentCheckpoints].sort((a, b) => a.timestamp - b.timestamp).reverse();
		for (const checkpoint of ordered) {
			await this.restoreCheckpoint(checkpoint);
		}
		this.saveCheckpoints();
	}

	async rollbackMission(missionId: string): Promise<void> {
		// Scope strictly to this mission so an aborted mission's rollback never touches
		// another mission's files.
		const missionCheckpoints = this.checkpoints.filter(cp => cp.missionId === missionId);

		// Sort by timestamp ascending, then rollback in reverse order (most recent first).
		const ordered = [...missionCheckpoints].sort((a, b) => a.timestamp - b.timestamp).reverse();
		for (const checkpoint of ordered) {
			await this.restoreCheckpoint(checkpoint);
		}
		this.saveCheckpoints();
	}

	getCheckpoints(missionId?: string, agentId?: string, filePath?: string): MissionCheckpoint[] {
		let filtered = [...this.checkpoints];

		if (missionId) {
			filtered = filtered.filter(cp => cp.missionId === missionId);
		}

		if (agentId) {
			filtered = filtered.filter(cp => cp.agentId === agentId);
		}

		if (filePath) {
			filtered = filtered.filter(cp => cp.filePath === filePath);
		}

		// Sort by timestamp descending (most recent first)
		return filtered.sort((a, b) => b.timestamp - a.timestamp);
	}

	getCheckpoint(checkpointId: string): MissionCheckpoint | null {
		return this.checkpoints.find(cp => cp.id === checkpointId) || null;
	}

	private saveCheckpoints(): void {
		const toSave = this.checkpoints.slice(-200);
		this.storageService.store(CHECKPOINT_STORAGE_KEY, JSON.stringify(toSave), StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private async restoreCheckpoint(checkpoint: MissionCheckpoint): Promise<void> {
		// Idempotency: a checkpoint is only ever restored once. A second rollback
		// (double rollbackMission, or rollbackAgent then rollbackMission) is a no-op.
		if (this.rolledBackIds.has(checkpoint.id)) {
			return;
		}
		this.rolledBackIds.add(checkpoint.id);

		const uri = URI.file(checkpoint.filePath);

		if (!checkpoint.existedAtCheckpoint) {
			// The file was created by the agent after this checkpoint — undo means delete.
			if (await this.fileService.exists(uri)) {
				await this.fileService.del(uri, { useTrash: false });
			}
			return;
		}

		// The file existed before the agent ran — restore its original content.
		// Write to disk first so a file the agent deleted is recreated, then rewrite the
		// in-memory model so any unsaved editor edits are reverted to the snapshot too.
		await this.fileService.writeFile(uri, VSBuffer.fromString(checkpoint.snapshot.entireFileCode));
		this.editCodeService.instantlyRewriteFile({
			uri,
			newContent: checkpoint.snapshot.entireFileCode,
		});
	}
}

registerSingleton(IRibixCheckpointService, RibixCheckpointService, InstantiationType.Delayed);