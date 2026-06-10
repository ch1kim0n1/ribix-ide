/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { PlanTask, MissionContext } from '../common/ribixTypes.js';
import { generatePlanningPrompt, PlanningPromptContext } from '../common/prompt/ribixPlanningPrompt.js';

export interface IRibixPlanningService {
	readonly _serviceBrand: undefined;

	/**
	 * Generates a task execution plan for a given mission.
	 * @param missionId - The ID of the mission to plan
	 * @param outcome - The desired outcome (engineer's request)
	 * @param context - Additional context (attached files, selections, etc.)
	 * @returns Promise resolving to an array of PlanTask objects
	 */
	plan(missionId: string, outcome: string, context: MissionContext): Promise<PlanTask[]>;

	/**
	 * Event fired when a plan is produced
	 */
	onDidProducePlan: Event<{ missionId: string; tasks: PlanTask[] }>;
}

export const IRibixPlanningService = createDecorator<IRibixPlanningService>('ribixPlanningService');

class RibixPlanningService extends Disposable implements IRibixPlanningService {
	readonly _serviceBrand: undefined;

	private readonly _onDidProducePlan = new Emitter<{ missionId: string; tasks: PlanTask[] }>();
	readonly onDidProducePlan = this._onDidProducePlan.event;

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IRibixMemoryService private readonly memoryService: IRibixMemoryService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@IVoidSettingsService private readonly settingsService: IVoidSettingsService,
	) {
		super();
	}

	async plan(missionId: string, outcome: string, context: MissionContext): Promise<PlanTask[]> {
		try {
			// Gather codebase context
			const workspaceId = await this.memoryService.getWorkspaceId();
			const memoryEntries = await this.gatherMemoryEntries(workspaceId, outcome);
			const directoryTree = await this.gatherDirectoryTree();
			const fileOwnership = await this.gatherFileOwnership(workspaceId);

			// Build attached context string
			const attachedContext = this.buildAttachedContextString(context);

			// Generate prompt
			const promptContext: PlanningPromptContext = {
				memoryEntries,
				directoryTree,
				fileOwnership,
				outcome,
				attachedContext,
			};

			const prompt = generatePlanningPrompt({ context: promptContext });

			// Send LLM request
			const tasks = await this.sendLLMRequest(prompt);

			// Fire event
			this._onDidProducePlan.fire({ missionId, tasks });

			return tasks;
		} catch (error) {
			console.error('Error in planning service:', error);
			// Return minimal safe default plan on error
			return this.getMinimalSafePlan();
		}
	}

	private async gatherMemoryEntries(workspaceId: string, outcome: string): Promise<string[]> {
		try {
			// Search for relevant memory entries based on outcome keywords
			const keywords = this.extractKeywords(outcome);
			const allEntries: string[] = [];

			// Get relevant memory types
			const relevantTypes = ['codebase_file', 'codebase_ownership', 'codebase_pattern'] as const;

			for (const type of relevantTypes) {
				const entries = await this.memoryService.getEntries(type, workspaceId);
				// Filter by keyword relevance
				const relevant = entries.filter(entry =>
					keywords.some(keyword => entry.content.toLowerCase().includes(keyword.toLowerCase()))
				);
				allEntries.push(...relevant.map(e => `[${type}] ${e.content}`));
			}

			// Limit to top 10 most relevant entries
			return allEntries.slice(0, 10);
		} catch (error) {
			console.error('Error gathering memory entries:', error);
			return [];
		}
	}

	private async gatherDirectoryTree(): Promise<string> {
		try {
			const cutOffMessage = '(directory truncated for token efficiency)';
			return await this.directoryStrService.getAllDirectoriesStr({ cutOffMessage });
		} catch (error) {
			console.error('Error gathering directory tree:', error);
			return 'Unable to retrieve directory structure.';
		}
	}

	private async gatherFileOwnership(workspaceId: string): Promise<string> {
		try {
			const ownershipEntries = await this.memoryService.getEntries('codebase_ownership', workspaceId);
			return ownershipEntries.map(e => e.content).join('\n');
		} catch (error) {
			console.error('Error gathering file ownership:', error);
			return 'No file ownership information available.';
		}
	}

	private buildAttachedContextString(context: MissionContext): string {
		const parts: string[] = [];

		if (context.attachedFiles.length > 0) {
			parts.push(`Attached Files:\n${context.attachedFiles.join('\n')}`);
		}

		if (context.attachedSelections.length > 0) {
			parts.push(`Attached Selections:\n${context.attachedSelections.map(s => 
				`- ${s.filePath} (lines ${s.range[0]}-${s.range[1]})`
			).join('\n')}`);
		}

		if (context.issueUrls.length > 0) {
			parts.push(`Issue URLs:\n${context.issueUrls.join('\n')}`);
		}

		if (context.notes) {
			parts.push(`Notes:\n${context.notes}`);
		}

		return parts.join('\n\n');
	}

	private extractKeywords(text: string): string[] {
		// Simple keyword extraction - remove common words and extract meaningful terms
		const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'unless', 'since', 'that', 'this', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'whose']);

		const words = text.toLowerCase().split(/\s+/);
		return words.filter(word => word.length > 3 && !commonWords.has(word));
	}

	private async sendLLMRequest(prompt: string): Promise<PlanTask[]> {
		return new Promise((resolve, reject) => {
			const modelSelection = this.settingsService.state.modelSelectionOfFeature['Chat'];

			const requestId = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: prompt }],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				logging: { loggingName: 'ribix-planner' },
				onText: (_params) => { /* streaming — not used; wait for onFinalMessage */ },
				onFinalMessage: (params) => {
					try {
						const tasks = this.parseAndValidateResponse(params.fullText);
						resolve(tasks);
					} catch (error) {
						console.error('Error parsing LLM response:', error);
						resolve(this.getMinimalSafePlan());
					}
				},
				onError: (params) => {
					console.error('LLM planning error:', params.message);
					resolve(this.getMinimalSafePlan());
				},
				onAbort: () => {
					console.warn('LLM planning request aborted');
					resolve(this.getMinimalSafePlan());
				},
			});

			if (!requestId) {
				resolve(this.getMinimalSafePlan());
			}
		});
	}

	private parseAndValidateResponse(response: string): PlanTask[] {
		// Check for refusal
		if (response.trim().startsWith('REFUSAL:')) {
			throw new Error(`LLM refused: ${response}`);
		}

		// Extract JSON from response (handle markdown code blocks)
		let jsonStr = response.trim();
		
		// Remove markdown code block markers if present
		if (jsonStr.startsWith('```json')) {
			jsonStr = jsonStr.substring(7);
		} else if (jsonStr.startsWith('```')) {
			jsonStr = jsonStr.substring(3);
		}
		
		if (jsonStr.endsWith('```')) {
			jsonStr = jsonStr.substring(0, jsonStr.length - 3);
		}

		jsonStr = jsonStr.trim();

		// Parse JSON
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonStr);
		} catch (error) {
			throw new Error(`Failed to parse JSON response: ${error}`);
		}

		// Validate structure
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Response is not an object');
		}

		const responseObj = parsed as Record<string, unknown>;
		if (!('tasks' in responseObj) || !Array.isArray(responseObj.tasks)) {
			throw new Error('Response does not contain a tasks array');
		}

		const tasks = responseObj.tasks as unknown[];

		// Validate each task
		const validatedTasks: PlanTask[] = [];
		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i];
			if (!task || typeof task !== 'object') {
				throw new Error(`Task ${i} is not an object`);
			}

			const taskObj = task as Record<string, unknown>;

			// Validate required fields
			if (!('id' in taskObj) || typeof taskObj.id !== 'string') {
				throw new Error(`Task ${i} missing valid id`);
			}
			if (!('agentType' in taskObj) || typeof taskObj.agentType !== 'string') {
				throw new Error(`Task ${i} missing valid agentType`);
			}
			if (!('description' in taskObj) || typeof taskObj.description !== 'string') {
				throw new Error(`Task ${i} missing valid description`);
			}
			if (!('dependsOn' in taskObj) || !Array.isArray(taskObj.dependsOn)) {
				throw new Error(`Task ${i} missing valid dependsOn`);
			}
			if (!('riskLevel' in taskObj) || typeof taskObj.riskLevel !== 'string') {
				throw new Error(`Task ${i} missing valid riskLevel`);
			}
			if (!('estimatedTokens' in taskObj) || typeof taskObj.estimatedTokens !== 'number') {
				throw new Error(`Task ${i} missing valid estimatedTokens`);
			}
			if (!('notes' in taskObj) || typeof taskObj.notes !== 'string') {
				throw new Error(`Task ${i} missing valid notes`);
			}

			// Validate enum values
			const validAgentTypes = ['planner', 'coder', 'tester', 'debugger', 'reviewer', 'docs'];
			if (!validAgentTypes.includes(taskObj.agentType)) {
				throw new Error(`Task ${i} has invalid agentType: ${taskObj.agentType}`);
			}

			const validRiskLevels = ['low', 'medium', 'high'];
			if (!validRiskLevels.includes(taskObj.riskLevel)) {
				throw new Error(`Task ${i} has invalid riskLevel: ${taskObj.riskLevel}`);
			}

			validatedTasks.push({
				id: taskObj.id,
				agentType: taskObj.agentType as any,
				description: taskObj.description,
				dependsOn: taskObj.dependsOn as string[],
				riskLevel: taskObj.riskLevel as any,
				estimatedTokens: taskObj.estimatedTokens,
				notes: taskObj.notes,
				status: 'pending',
			});
		}

		// Validate task graph rules
		this.validateTaskGraph(validatedTasks);

		return validatedTasks;
	}

	private validateTaskGraph(tasks: PlanTask[]): void {
		if (tasks.length === 0) {
			throw new Error('No tasks in plan');
		}

		if (tasks.length > 12) {
			throw new Error('Plan exceeds maximum of 12 tasks');
		}

		// First task must be planner
		if (tasks[0].agentType !== 'planner') {
			throw new Error('First task must be a planner task');
		}

		// Check for circular dependencies
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const hasCycle = (taskId: string): boolean => {
			visited.add(taskId);
			recursionStack.add(taskId);

			const task = tasks.find(t => t.id === taskId);
			if (!task) return false;

			for (const depId of task.dependsOn) {
				if (!visited.has(depId)) {
					if (hasCycle(depId)) return true;
				} else if (recursionStack.has(depId)) {
					return true;
				}
			}

			recursionStack.delete(taskId);
			return false;
		};

		for (const task of tasks) {
			if (!visited.has(task.id)) {
				if (hasCycle(task.id)) {
					throw new Error('Circular dependency detected in task graph');
				}
			}
		}

		// Validate that all dependencies exist
		const taskIds = new Set(tasks.map(t => t.id));
		for (const task of tasks) {
			for (const depId of task.dependsOn) {
				if (!taskIds.has(depId)) {
					throw new Error(`Task ${task.id} depends on non-existent task ${depId}`);
				}
			}
		}
	}

	private getMinimalSafePlan(): PlanTask[] {
		return [
			{
				id: 'task-1',
				agentType: 'planner',
				description: 'Analyze requirements and create implementation plan',
				dependsOn: [],
				riskLevel: 'low',
				estimatedTokens: 5000,
				notes: 'Default planner task - LLM planning failed, using fallback plan',
				status: 'pending',
			},
		];
	}
}

registerSingleton(IRibixPlanningService, RibixPlanningService, InstantiationType.Delayed);