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
import { VoidFileSnapshot } from '../common/editCodeServiceTypes.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';

export type MissionCheckpoint = {
	id: string;
	missionId: string;
	agentId: string;
	filePath: string;
	snapshot: VoidFileSnapshot;
	timestamp: number;
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

class RibixCheckpointService extends Disposable implements IRibixCheckpointService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeCheckpoints = new Emitter<void>();
	readonly onDidChangeCheckpoints = this._onDidChangeCheckpoints.event;

	private checkpoints: MissionCheckpoint[] = [];

	constructor(
		@IVoidModelService private readonly voidModelService: IVoidModelService,
		@IEditCodeService private readonly editCodeService: IEditCodeService,
	) {
		super();
	}

	async checkpoint(missionId: string, agentId: string, filePath: string): Promise<MissionCheckpoint> {
		const uri = URI.file(filePath);
		
		// Get the current model to capture the snapshot
		await this.voidModelService.initializeModel(uri);
		const { model } = this.voidModelService.getModel(uri);

		if (!model) {
			throw new Error(`Failed to get model for file: ${filePath}`);
		}

		// Create a snapshot with the current file content
		const snapshot: VoidFileSnapshot = {
			snapshottedDiffAreaOfId: {}, // Empty diff areas - we only care about file content for rollback
			entireFileCode: model.getValue(EndOfLinePreference.LF),
		};

		const checkpoint: MissionCheckpoint = {
			id: generateUuid(),
			missionId,
			agentId,
			filePath,
			snapshot,
			timestamp: Date.now(),
		};

		this.checkpoints.push(checkpoint);
		this._onDidChangeCheckpoints.fire();

		return checkpoint;
	}

	async rollbackFile(checkpointId: string): Promise<void> {
		const checkpoint = this.getCheckpoint(checkpointId);
		if (!checkpoint) {
			throw new Error(`Checkpoint with id ${checkpointId} not found`);
		}

		await this.restoreSnapshot(checkpoint.filePath, checkpoint.snapshot);
	}

	async rollbackAgent(agentId: string): Promise<void> {
		const agentCheckpoints = this.checkpoints.filter(cp => cp.agentId === agentId);
		
		// Rollback in reverse chronological order (most recent first)
		for (const checkpoint of agentCheckpoints.reverse()) {
			await this.restoreSnapshot(checkpoint.filePath, checkpoint.snapshot);
		}
	}

	async rollbackMission(missionId: string): Promise<void> {
		const missionCheckpoints = this.checkpoints.filter(cp => cp.missionId === missionId);
		
		// Sort by timestamp ascending, then rollback in reverse order
		missionCheckpoints.sort((a, b) => a.timestamp - b.timestamp);
		
		for (const checkpoint of missionCheckpoints.reverse()) {
			await this.restoreSnapshot(checkpoint.filePath, checkpoint.snapshot);
		}
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

	private async restoreSnapshot(filePath: string, snapshot: VoidFileSnapshot): Promise<void> {
		const uri = URI.file(filePath);
		
		// Restore the file content from the snapshot
		this.editCodeService.instantlyRewriteFile({
			uri,
			newContent: snapshot.entireFileCode,
		});
	}
}

registerSingleton(IRibixCheckpointService, RibixCheckpointService, InstantiationType.Delayed);