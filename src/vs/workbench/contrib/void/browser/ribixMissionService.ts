/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { MemoryEntry, Mission, MissionState, MissionContext, PlanTask } from './ribixTypes.js';
import { IVoidSCMService } from './voidSCMTypes.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';

export interface IRibixMissionService {
	readonly _serviceBrand: undefined;

	// Create
	createMission(outcome: string, context: MissionContext): Promise<Mission>;

	// Read
	getMission(id: string): Mission | null;
	getAllMissions(): Mission[];
	getActiveMissions(): Mission[];

	// Transitions
	submitForPlanning(id: string): Promise<void>;
	approvePlan(id: string, modifiedTasks?: PlanTask[]): Promise<void>;
	abortMission(id: string): Promise<void>;
	completeMission(id: string, result: Mission['result']): Promise<void>;

	// Persistence
	onDidChangeMissions: Event<void>;
}

export const IRibixMissionService = createDecorator<IRibixMissionService>('ribixMissionService');

class RibixMissionService extends Disposable implements IRibixMissionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeMissions = new Emitter<void>();
	readonly onDidChangeMissions = this._onDidChangeMissions.event;

	private missions: Mission[] = [];
	private maxConcurrentMissions: number = 3;
	private voidSCM: IVoidSCMService;

	constructor(
		@IRibixMemoryService private readonly memoryService: IRibixMemoryService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		this.voidSCM = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));
		this.loadMissions();
	}

	private async loadMissions(): Promise<void> {
		try {
			const workspaceId = await this.memoryService.getWorkspaceId();
			const entries = await this.memoryService.getEntries('mission_summary' as any, workspaceId);
			this.missions = entries.map(entry => JSON.parse(entry.content) as Mission);
			// Sort by createdAt descending
			this.missions.sort((a, b) => b.createdAt - a.createdAt);
		} catch (e) {
			console.error('Failed to load missions:', e);
			this.missions = [];
		}
	}

	private async saveMission(mission: Mission): Promise<void> {
		const workspaceId = await this.memoryService.getWorkspaceId();
		const entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> = {
			type: 'mission_summary' as any,
			workspaceId,
			content: JSON.stringify(mission),
			metadata: { missionId: mission.id },
			confidence: 1,
			source: 'agent',
		};
		await this.memoryService.writeEntry(entry);
		this._onDidChangeMissions.fire();
	}

	async createMission(outcome: string, context: MissionContext): Promise<Mission> {
		const activeMissions = this.getActiveMissions();
		if (activeMissions.length >= this.maxConcurrentMissions) {
			throw new Error(`Maximum concurrent missions (${this.maxConcurrentMissions}) reached`);
		}

		const now = Date.now();
		const mission: Mission = {
			id: generateUuid(),
			outcome,
			state: 'awaiting_outcome',
			tasks: [],
			agentIds: [],
			branchName: '',
			createdAt: now,
			completedAt: null,
			result: null,
		};

		this.missions.unshift(mission);
		await this.saveMission(mission);
		return mission;
	}

	getMission(id: string): Mission | null {
		return this.missions.find(m => m.id === id) || null;
	}

	getAllMissions(): Mission[] {
		return [...this.missions];
	}

	getActiveMissions(): Mission[] {
		return this.missions.filter(m => 
			['awaiting_outcome', 'planning', 'plan_ready', 'executing', 'reviewing'].includes(m.state)
		);
	}

	async submitForPlanning(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'awaiting_outcome') {
			throw new Error(`Cannot submit for planning: mission is in state ${mission.state}`);
		}

		mission.state = 'planning';
		await this.saveMission(mission);
	}

	async approvePlan(id: string, modifiedTasks?: PlanTask[]): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'plan_ready') {
			throw new Error(`Cannot approve plan: mission is in state ${mission.state}`);
		}

		if (modifiedTasks) {
			mission.tasks = modifiedTasks;
		}

		// Create git branch
		const workspaceId = await this.memoryService.getWorkspaceId();
		const branchName = `ribix/mission-${mission.id.substring(0, 8)}`;
		mission.branchName = branchName;

		try {
			// Try to create branch via voidSCM
			const workspaceFolders = await this.getWorkspacePath();
			if (workspaceFolders) {
				await this.voidSCM.gitCreateBranch(workspaceFolders, branchName);
			}
		} catch (e) {
			console.error('Failed to create git branch:', e);
			// Continue without branch creation
		}

		mission.state = 'executing';
		await this.saveMission(mission);
	}

	async abortMission(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (['complete', 'aborted', 'failed'].includes(mission.state)) {
			throw new Error(`Cannot abort mission in state ${mission.state}`);
		}

		mission.state = 'aborted';
		mission.completedAt = Date.now();
		await this.saveMission(mission);
	}

	async completeMission(id: string, result: Mission['result']): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'executing' && mission.state !== 'reviewing') {
			throw new Error(`Cannot complete mission in state ${mission.state}`);
		}

		mission.state = 'complete';
		mission.completedAt = Date.now();
		mission.result = result;
		await this.saveMission(mission);
	}

	private async getWorkspacePath(): Promise<string | null> {
		// This would need to be implemented to get the actual workspace path
		// For now, return null as a placeholder
		return null;
	}
}

registerSingleton(IRibixMissionService, RibixMissionService, InstantiationType.Delayed);