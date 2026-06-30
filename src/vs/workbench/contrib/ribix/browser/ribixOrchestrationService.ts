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
import { AgentOutput, Mission, MissionState, PlanTask } from '../common/ribixTypes.js';
import { agentProgressFeed } from './agentProgressFeed.js';

export interface MissionProgress {
	missionId: string;
	state: MissionState;
	totalTasks: number;
	completedTasks: number;
	failedTasks: number;
	currentTask: string | null;
	error: string | null;
	/** Id of the task whose agent failed and paused the mission (null when none). */
	failedTaskId: string | null;
	/** Human-readable description of the failed task (so the card can show WHY). */
	failedTaskDescription: string | null;
	/** The failing agent's error message (from its blocked.reason), surfaced in the card. */
	failedAgentError: string | null;
}

export interface IRibixOrchestrationService {
	readonly _serviceBrand: undefined;

	// Mission execution
	executeMission(missionId: string): Promise<void>;
	pauseMission(missionId: string): Promise<void>;
	resumeMission(missionId: string): Promise<void>;

	/** Retry a mission that paused on a failed task: reset the failed task and resume execution. */
	retryMission(missionId: string): Promise<void>;
	/** Abort a paused/failed mission: mark it aborted and stop all agents. */
	abortMission(missionId: string): Promise<void>;

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
	/** The task whose agent failure paused the mission, plus the agent's error. */
	failure: { taskId: string; agentError: string } | null;
}

export class RibixOrchestrationService extends Disposable implements IRibixOrchestrationService {
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
			failure: null,
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

	async retryMission(missionId: string): Promise<void> {
		const state = this.orchestrationStates.get(missionId);
		if (!state) {
			throw new Error(`Mission ${missionId} is not being orchestrated`);
		}

		const mission = this.missionService.getMission(missionId);
		// Reset the failed task(s) so they become ready again, and clear the failure.
		for (const failedId of state.failedTaskIds) {
			const task = mission?.tasks.find(t => t.id === failedId);
			if (task) { task.status = 'pending'; }

			// Drop the failed agent for this task so executeTopological re-spawns it instead of
			// treating the dead agent as an already-running one (existingAgent guard).
			state.spawnedAgentIds = state.spawnedAgentIds.filter(agentId => {
				const agent = this.agentService.getAgent(agentId);
				return agent?.taskId !== failedId;
			});
		}
		state.failedTaskIds.clear();
		state.failure = null;
		state.isPaused = false;

		await this.executeTopological(missionId);
	}

	async abortMission(missionId: string): Promise<void> {
		const state = this.orchestrationStates.get(missionId);
		if (state) {
			state.isPaused = true;
			for (const agentId of state.spawnedAgentIds) {
				try {
					await this.agentService.abortAgent(agentId);
				} catch (error) {
					console.error(`Failed to abort agent ${agentId}:`, error);
				}
			}
		}
		try {
			await this.missionService.abortMission(missionId);
		} catch (error) {
			console.error(`Failed to abort mission ${missionId}:`, error);
		}
		this.emitProgress(missionId);
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

		// Surface the concrete reason (failed task + agent error) instead of a generic string.
		const failure = state?.failure ?? null;
		const failedTask = failure ? mission.tasks.find(t => t.id === failure.taskId) : undefined;
		const failedTaskDescription = failedTask?.description ?? null;
		const error = failure
			? `Task "${failedTaskDescription ?? failure.taskId}" failed: ${failure.agentError}`
			: (failedTasks > 0 ? 'One or more tasks failed' : null);

		return {
			missionId,
			state: mission.state,
			totalTasks: mission.tasks.length,
			completedTasks,
			failedTasks,
			currentTask: currentTask?.id || null,
			error,
			failedTaskId: failure?.taskId ?? null,
			failedTaskDescription,
			failedAgentError: failure?.agentError ?? null,
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
			agentProgressFeed.emit({ agentId: `${missionId}:${task.agentType}`, agentRole: task.agentType as any, stage: 'planning', message: task.description, timestamp: Date.now() });

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

		// Add structured outputs from dependency tasks. Each dependency stores its
		// AgentOutput plus the producing agentType in taskContexts (see handleTaskCompletion).
		for (const depId of task.dependsOn) {
			const dep = state.taskContexts.get(depId) as { output?: AgentOutput; agentType?: string } | undefined;
			const output = dep?.output;
			if (!output) { continue; }

			// Pass structured fields directly instead of converting to text blob
			if (task.agentType === 'coder' && dep.agentType === 'planner') {
				context.plannerOutput = output.summary;
				context.plannerPlan = output.rawFinalMessage; // Full plan for detailed context
			} else if (task.agentType === 'tester' && dep.agentType === 'coder') {
				context.coderOutput = output.summary;
				context.filesChanged = output.filesChanged;
			} else if (task.agentType === 'debugger' && dep.agentType === 'tester') {
				context.testerOutput = output.summary;
				context.testReport = output.testReport ?? '';
				context.errorLogs = output.testReport ?? '';
			} else if (task.agentType === 'reviewer') {
				context.implementationSummary = output.summary;
				context.testReport = output.testReport ?? '';
				context.filesChanged = output.filesChanged;
				context.findings = output.findings;
			} else if (task.agentType === 'docs' && dep.agentType === 'coder') {
				context.implementationSummary = output.summary;
				context.filesChanged = output.filesChanged;
			}
		}

		return context;
	}

	private monitorAgentCompletion(missionId: string, taskId: string, agentId: string, state: OrchestrationState): void {
		// Event-driven completion: register a one-shot listener keyed by agentId that
		// routes the terminal status to the right handler and disposes itself.
		const listener = this.agentService.onDidCompleteAgent(e => {
			if (e.agentId !== agentId) { return; }
			listener.dispose();
			if (e.status === 'complete') {
				this.handleTaskCompletion(missionId, taskId, agentId, state);
			} else {
				this.handleTaskFailure(missionId, taskId, agentId, state);
			}
		});
		this._register(listener);
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
		if (task) {
			agentProgressFeed.emit({ agentId: `${missionId}:${task.agentType}`, agentRole: task.agentType as any, stage: 'complete', message: `${task.description} — done`, timestamp: Date.now() });
		}

		// Store structured agent output for dependent tasks
		const agent = this.agentService.getAgent(agentId);
		if (agent) {
			const context = state.taskContexts.get(taskId) || {};
			context.output = agent.output;
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
		if (task) {
			agentProgressFeed.emit({ agentId: `${missionId}:${task.agentType}`, agentRole: task.agentType as any, stage: 'error', message: `${task.description} — failed`, timestamp: Date.now() });
		}

		// Capture WHY the task failed: the failing agent records its error in
		// output.blocked.reason (see ribixAgentService.markAgentFailed). Surface it so the
		// mission card can show a human-readable reason instead of a generic string.
		const agent = this.agentService.getAgent(agentId);
		const agentError = agent?.output?.blocked?.reason || 'Agent failed without a reported reason.';
		state.failure = { taskId, agentError };

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