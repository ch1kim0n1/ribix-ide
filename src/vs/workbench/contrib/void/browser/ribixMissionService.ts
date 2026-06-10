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
import { IRibixAuthService } from './ribixAuthService.js';
import { RibixApiClient } from '../common/ribixApiClient.js';
import { IRibixAgentService } from './ribixAgentService.js';

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
	prepareRelease(id: string): Promise<void>;

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
		@IRibixAuthService private readonly authService: IRibixAuthService,
		@IRibixAgentService private readonly agentService: IRibixAgentService,
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

	async prepareRelease(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'complete') {
			throw new Error(`Cannot prepare release: mission is in state ${mission.state}`);
		}

		if (!mission.result) {
			throw new Error(`Cannot prepare release: mission has no result`);
		}

		const workspacePath = await this.getWorkspacePath();
		if (!workspacePath) {
			throw new Error('Cannot prepare release: workspace path not available');
		}

		// Step 1: Analyze mission diff to determine semver bump
		const semverBump = await this.determineSemverBump(mission, workspacePath);

		// Step 2: Draft changelog entry from mission history + agent notes
		const changelogEntry = await this.draftChangelogEntry(mission);

		// Step 3: Bump version in package.json
		const newVersion = await this.bumpVersion(workspacePath, semverBump);

		// Step 4: Create git tag
		const tagName = `v${newVersion}`;
		await this.voidSCM.gitCreateTag(workspacePath, tagName, `Release ${newVersion}: ${mission.outcome.substring(0, 70)}`);

		// Step 5: Call ribixApiClient.createPR() with full context
		const config = await this.authService.getRequiredConfig();
		const apiClient = new RibixApiClient();

		const prTitle = mission.outcome.substring(0, 70);
		const prBody = this.buildPRBody(mission, changelogEntry, newVersion);

		const prResponse = await apiClient.createPR(config, {
			workspaceId: config.workspaceId,
			branchName: mission.branchName,
			title: prTitle,
			description: prBody,
		});

		// Update mission result with PR URL
		if (mission.result) {
			mission.result.prUrl = prResponse.prUrl;
		}
		await this.saveMission(mission);
	}

	private async determineSemverBump(mission: Mission, workspacePath: string): Promise<'patch' | 'minor' | 'major'> {
		// Analyze the diff to determine the appropriate semver bump
		// For now, default to patch - in a real implementation, this would analyze the changes
		// Major: breaking changes
		// Minor: new features, non-breaking changes
		// Patch: bug fixes
		return 'patch';
	}

	private async draftChangelogEntry(mission: Mission): Promise<string> {
		const lines: string[] = [];
		lines.push(`## ${new Date().toISOString().split('T')[0]}`);
		lines.push('');
		lines.push(`### Mission: ${mission.outcome.substring(0, 100)}`);
		lines.push('');
		if (mission.result) {
			lines.push(mission.result.summary);
			lines.push('');
			if (mission.result.testReport) {
				lines.push('**Test Report:**');
				lines.push('```');
				lines.push(mission.result.testReport);
				lines.push('```');
				lines.push('');
			}
			if (mission.result.reviewerFindings.length > 0) {
				lines.push('**Reviewer Findings:**');
				for (const finding of mission.result.reviewerFindings) {
					lines.push(`- ${finding}`);
				}
				lines.push('');
			}
		}
		return lines.join('\n');
	}

	private async bumpVersion(workspacePath: string, bumpType: 'patch' | 'minor' | 'major'): Promise<string> {
		// Read package.json
		const fs = await import('fs');
		const path = await import('path');
		const packageJsonPath = path.join(workspacePath, 'package.json');
		const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
		const packageJson = JSON.parse(packageJsonContent);

		// Parse current version
		const versionParts = packageJson.version.split('.').map(Number);
		let [major, minor, patch] = versionParts;

		// Bump version based on type
		switch (bumpType) {
			case 'major':
				major++;
				minor = 0;
				patch = 0;
				break;
			case 'minor':
				minor++;
				patch = 0;
				break;
			case 'patch':
				patch++;
				break;
		}

		const newVersion = `${major}.${minor}.${patch}`;
		packageJson.version = newVersion;

		// Write back to package.json
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

		return newVersion;
	}

	private buildPRBody(mission: Mission, changelogEntry: string, version: string): string {
		const lines: string[] = [];
		lines.push('## Mission Summary');
		lines.push('');
		lines.push(mission.outcome);
		lines.push('');
		lines.push('## Task List');
		lines.push('');
		for (const task of mission.tasks) {
			lines.push(`- [${task.status === 'complete' ? 'x' : ' '}] ${task.description} (${task.agentType})`);
		}
		lines.push('');
		lines.push('## Test Report');
		lines.push('');
		if (mission.result?.testReport) {
			lines.push('```');
			lines.push(mission.result.testReport);
			lines.push('```');
		} else {
			lines.push('No test report available.');
		}
		lines.push('');
		lines.push('## Agent Notes');
		lines.push('');
		for (const task of mission.tasks) {
			if (task.notes) {
				lines.push(`### ${task.description}`);
				lines.push(task.notes);
				lines.push('');
			}
		}
		lines.push('');
		lines.push('## Changelog');
		lines.push('');
		lines.push(changelogEntry);
		lines.push('');
		lines.push(`**Version:** ${version}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('*This PR was created by the Ribix Release Agent*');
		return lines.join('\n');
	}

	private async getWorkspacePath(): Promise<string | null> {
		// This would need to be implemented to get the actual workspace path
		// For now, return null as a placeholder
		return null;
	}
}

registerSingleton(IRibixMissionService, RibixMissionService, InstantiationType.Delayed);