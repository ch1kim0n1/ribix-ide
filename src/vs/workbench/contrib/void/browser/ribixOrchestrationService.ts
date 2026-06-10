/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { IRibixTaskQueueService } from '../common/ribixTaskQueueService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { Mission, MissionState, PlanTask } from '../common/ribixTypes.js';

export interface MissionProgress {
	missionId: string;
	state: MissionState;
	totalTasks: number;
	completedTasks: number;
	failedTasks: number;
	currentTask: string | null;
	error: string | null;
}

export interface IRibixOrchestrationService {
	readonly _serviceBrand: undefined;

	// Mission execution
	executeMission(missionId: string): Promise<void>;
	pauseMission(missionId: string): Promise<void>;
	resumeMission(missionId: string): Promise<void>;

	// Progress monitoring
	getMissionProgress(missionId: string): MissionProgress | null;

	// Events
	onDidChangeMissionProgress: Event<MissionProgress>;
}

export const IRibixOrchestrationService = createDecorator<IRibixOrchestrationService>('ribixOrchestrationService');

interface OrchestrationState {
	missionId: string;
	isPaused: boolean;
	completedTaskIds: Set<string>;
	failedTaskIds: Set<string>;
	spawnedAgentIds: string[];
	taskContexts: Map<string, any>;
}

class RibixOrchestrationService extends Disposable implements IRibixOrchestrationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeMissionProgress = new Emitter<MissionProgress>();
	readonly onDidChangeMissionProgress = this._onDidChangeMissionProgress.event;

	private orchestrationStates: Map<string, OrchestrationState> = new Map();

	constructor(
		@IRibixAgentService private readonly agentService: IRibixAgentService,
		@IRibixTaskQueueService private readonly taskQueueService: IRibixTaskQueueService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
	) {
		super();

		// Listen for agent changes to update progress
		this._register(this.agentService.onDidChangeAgents(() => {
			this.updateProgressForAllMissions();
		}));
	}

	async executeMission(missionId: string): Promise<void> {
		const mission = this.missionService.getMission(missionId);
		if (!mission) {
			throw new Error(`Mission ${missionId} not found`);
		}

		if (mission.state !== 'executing') {
			throw new Error(`Cannot execute mission in state ${mission.state}`);
		}

		// Initialize orchestration state
		const state: OrchestrationState = {
			missionId,
			isPaused: false,
			completedTaskIds: new Set(),
			failedTaskIds: new Set(),
			spawnedAgentIds: [],
			taskContexts: new Map(),
		};
		this.orchestrationStates.set(missionId, state);

		// Perform topological sort and start execution
		await this.executeTopological(missionId);
	}

	async pauseMission(missionId: string): Promise<void> {
		const state = this.orchestrationStates.get(missionId);
		if (!state) {
			throw new Error(`Mission ${missionId} is not being orchestrated`);
		}

		state.isPaused = true;

		// Abort all spawned agents
		for (const agentId of state.spawnedAgentIds) {
			try {
				await this.agentService.abortAgent(agentId);
			} catch (error) {
				console.error(`Failed to abort agent ${agentId}:`, error);
			}
		}

		this.emitProgress(missionId);
	}

	async resumeMission(missionId: string): Promise<void> {
		const state = this.orchestrationStates.get(missionId);
		if (!state) {
			throw new Error(`Mission ${missionId} is not being orchestrated`);
		}

		state.isPaused = false;
		await this.executeTopological(missionId);
	}

	getMissionProgress(missionId: string): MissionProgress | null {
		const mission = this.missionService.getMission(missionId);
		if (!mission) {
			return null;
		}

		const state = this.orchestrationStates.get(missionId);
		const completedTasks = state?.completedTaskIds.size || 0;
		const failedTasks = state?.failedTaskIds.size || 0;

		// Find current task (first in-progress task)
		const currentTask = mission.tasks.find(task => task.status === 'in_progress');
		const error = failedTasks > 0 ? 'One or more tasks failed' : null;

		return {
			missionId,
			state: mission.state,
			totalTasks: mission.tasks.length,
			completedTasks,
			failedTasks,
			currentTask: currentTask?.id || null,
			error,
		};
	}

	private async executeTopological(missionId: string): Promise<void> {
		const mission = this.missionService.getMission(missionId);
		if (!mission) {
			return;
		}

		const state = this.orchestrationStates.get(missionId);
		if (!state || state.isPaused) {
			return;
		}

		// Get ready tasks (tasks whose dependencies are all complete)
		const readyTasks = this.getReadyTasks(mission, state);

		for (const task of readyTasks) {
			if (state.isPaused) {
				break;
			}

			// Skip if already spawned or completed
			if (state.completedTaskIds.has(task.id) || state.failedTaskIds.has(task.id)) {
				continue;
			}

			// Check if agent already spawned for this task
			const existingAgent = state.spawnedAgentIds.find(agentId => {
				const agent = this.agentService.getAgent(agentId);
				return agent?.taskId === task.id;
			});

			if (existingAgent) {
				continue;
			}

			// Spawn agent for this task
			await this.spawnAgentForTask(missionId, task, state);
		}

		this.emitProgress(missionId);

		// Check if all tasks are complete
		if (this.areAllTasksComplete(mission, state)) {
			await this.transitionToReviewing(missionId);
		}
	}

	private getReadyTasks(mission: Mission, state: OrchestrationState): PlanTask[] {
		return mission.tasks.filter(task => {
			// Skip if already completed or failed
			if (state.completedTaskIds.has(task.id) || state.failedTaskIds.has(task.id)) {
				return false;
			}

			// Skip if already in progress
			if (task.status === 'in_progress') {
				return false;
			}

			// Check if all dependencies are complete
			const dependenciesComplete = task.dependsOn.every(depId => state.completedTaskIds.has(depId));
			return dependenciesComplete;
		});
	}

	private async spawnAgentForTask(missionId: string, task: PlanTask, state: OrchestrationState): Promise<void> {
		try {
			// Mark task as in progress
			task.status = 'in_progress';

			// Build context for the agent
			const context = await this.buildTaskContext(missionId, task, state);

			// Spawn agent via task queue
			const agentId = await this.taskQueueService.enqueue(async (token) => {
				if (state.isPaused) {
					throw new Error('Mission paused');
				}

				return await this.agentService.spawnAgent(
					missionId,
					task.id,
					task.agentType,
					task.description,
					context
				);
			}, this.getPriorityForAgentType(task.agentType));

			state.spawnedAgentIds.push(agentId);
			state.taskContexts.set(task.id, context);

			// Monitor agent completion
			this.monitorAgentCompletion(missionId, task.id, agentId, state);

			this.emitProgress(missionId);
		} catch (error) {
			console.error(`Failed to spawn agent for task ${task.id}:`, error);
			task.status = 'failed';
			state.failedTaskIds.add(task.id);
			this.emitProgress(missionId);
		}
	}

	private async buildTaskContext(missionId: string, task: PlanTask, state: OrchestrationState): Promise<any> {
		// Build context based on task type and dependencies
		const context: any = {
			taskId: task.id,
			taskDescription: task.description,
			notes: task.notes,
		};

		// Add outputs from dependency tasks
		for (const depId of task.dependsOn) {
			const depContext = state.taskContexts.get(depId);
			if (depContext) {
				if (task.agentType === 'coder' && depContext.agentType === 'planner') {
					context.plannerOutput = depContext.output;
				} else if (task.agentType === 'tester' && depContext.agentType === 'coder') {
					context.coderOutput = depContext.output;
				} else if (task.agentType === 'debugger' && depContext.agentType === 'tester') {
					context.testerOutput = depContext.output;
					context.errorLogs = depContext.errorLogs;
				} else if (task.agentType === 'reviewer') {
					context.implementationSummary = depContext.output;
					context.testReport = depContext.testReport;
				} else if (task.agentType === 'docs' && depContext.agentType === 'coder') {
					context.implementationSummary = depContext.output;
				}
			}
		}

		return context;
	}

	private monitorAgentCompletion(missionId: string, taskId: string, agentId: string, state: OrchestrationState): void {
		// Poll for agent completion
		const checkInterval = setInterval(() => {
			const agent = this.agentService.getAgent(agentId);
			if (!agent) {
				clearInterval(checkInterval);
				return;
			}

			if (agent.status === 'complete') {
				clearInterval(checkInterval);
				this.handleTaskCompletion(missionId, taskId, agentId, state);
			} else if (agent.status === 'failed') {
				clearInterval(checkInterval);
				this.handleTaskFailure(missionId, taskId, agentId, state);
			}
		}, 1000);

		// Clean up interval on disposal
		this._register({ dispose: () => clearInterval(checkInterval) });
	}

	private async handleTaskCompletion(missionId: string, taskId: string, agentId: string, state: OrchestrationState): Promise<void> {
		const mission = this.missionService.getMission(missionId);
		if (!mission) {
			return;
		}

		const task = mission.tasks.find(t => t.id === taskId);
		if (task) {
			task.status = 'complete';
		}

		state.completedTaskIds.add(taskId);

		// Store agent output for dependent tasks
		const agent = this.agentService.getAgent(agentId);
		if (agent) {
			const context = state.taskContexts.get(taskId) || {};
			context.output = this.extractAgentOutput(agent);
			context.agentType = agent.type;
			state.taskContexts.set(taskId, context);
		}

		// Check for newly unblocked tasks
		if (!state.isPaused) {
			await this.executeTopological(missionId);
		}
	}

	private async handleTaskFailure(missionId: string, taskId: string, agentId: string, state: OrchestrationState): Promise<void> {
		const mission = this.missionService.getMission(missionId);
		if (!mission) {
			return;
		}

		const task = mission.tasks.find(t => t.id === taskId);
		if (task) {
			task.status = 'failed';
		}

		state.failedTaskIds.add(taskId);

		// Pause mission on failure
		state.isPaused = true;

		// Abort all other agents
		for (const otherAgentId of state.spawnedAgentIds) {
			if (otherAgentId !== agentId) {
				try {
					await this.agentService.abortAgent(otherAgentId);
				} catch (error) {
					console.error(`Failed to abort agent ${otherAgentId}:`, error);
				}
			}
		}

		this.emitProgress(missionId);
	}

	private areAllTasksComplete(mission: Mission, state: OrchestrationState): boolean {
		return mission.tasks.every(task => state.completedTaskIds.has(task.id));
	}

	private async transitionToReviewing(missionId: string): Promise<void> {
		try {
			await this.missionService.setReviewing(missionId);
		} catch (e) {
			console.error('Failed to transition mission to reviewing:', e);
		}
		this.emitProgress(missionId);
	}

	private getPriorityForAgentType(agentType: string): number {
		// Define priority for each agent type
		const priorities: Record<string, number> = {
			planner: 100,
			coder: 80,
			tester: 60,
			debugger: 90, // Higher priority to fix bugs quickly
			reviewer: 40,
			docs: 20,
			release: 10,
		};
		return priorities[agentType] || 50;
	}

	private extractAgentOutput(agent: any): string {
		// Extract meaningful output from the agent
		// This would typically come from the agent's activity log or memory
		const lastActivity = agent.activityLog[agent.activityLog.length - 1];
		return lastActivity?.detail || 'No output available';
	}

	private emitProgress(missionId: string): void {
		const progress = this.getMissionProgress(missionId);
		if (progress) {
			this._onDidChangeMissionProgress.fire(progress);
		}
	}

	private updateProgressForAllMissions(): void {
		for (const missionId of this.orchestrationStates.keys()) {
			this.emitProgress(missionId);
		}
	}
}

registerSingleton(IRibixOrchestrationService, RibixOrchestrationService, InstantiationType.Delayed);