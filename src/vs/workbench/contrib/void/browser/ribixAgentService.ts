/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IToolsService } from './toolsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IRibixFileLockService } from '../common/ribixFileLockService.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { IRibixCheckpointService } from './ribixCheckpointService.js';
import { AgentInstance, AgentStatus, AgentType, AgentActivityEntry } from '../common/ribixTypes.js';
import { generatePlannerPrompt, PlannerPromptParams } from '../common/prompt/ribixPlannerPrompt.js';
import { generateCoderPrompt, CoderPromptParams } from '../common/prompt/ribixCoderPrompt.js';
import { generateTesterPrompt, TesterPromptParams } from '../common/prompt/ribixTesterPrompt.js';
import { generateDebuggerPrompt, DebuggerPromptParams } from '../common/prompt/ribixDebuggerPrompt.js';
import { generateReviewerPrompt, ReviewerPromptParams } from '../common/prompt/ribixReviewerPrompt.js';
import { generateDocsPrompt, DocsPromptParams } from '../common/prompt/ribixDocsPrompt.js';
import { generateReleasePrompt, ReleasePromptParams } from '../common/prompt/ribixReleasePrompt.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';

export interface IRibixAgentService {
	readonly _serviceBrand: undefined;

	// Agent lifecycle
	spawnAgent(missionId: string, taskId: string, agentType: AgentType, taskDescription: string, context?: any): Promise<string>;
	getAgent(agentId: string): AgentInstance | null;
	getAgentsForMission(missionId: string): AgentInstance[];
	getAllActiveAgents(): AgentInstance[];
	abortAgent(agentId: string): Promise<void>;

	// Events
	onDidChangeAgents: Event<void>;
}

export const IRibixAgentService = createDecorator<IRibixAgentService>('ribixAgentService');

interface AgentExecutionState {
	agentId: string;
	tokenSource: CancellationTokenSource;
	abortController: AbortController;
}

class RibixAgentService extends Disposable implements IRibixAgentService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = new Emitter<void>();
	readonly onDidChangeAgents = this._onDidChangeAgents.event;

	private agents: Map<string, AgentInstance> = new Map();
	private executionStates: Map<string, AgentExecutionState> = new Map();

	constructor(
		@IToolsService private readonly toolsService: IToolsService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IRibixFileLockService private readonly fileLockService: IRibixFileLockService,
		@IRibixMemoryService private readonly memoryService: IRibixMemoryService,
		@IRibixCheckpointService private readonly checkpointService: IRibixCheckpointService,
		@IVoidSettingsService private readonly settingsService: IVoidSettingsService,
	) {
		super();
	}

	async spawnAgent(
		missionId: string,
		taskId: string,
		agentType: AgentType,
		taskDescription: string,
		context?: any
	): Promise<string> {
		const agentId = generateUuid();
		const now = Date.now();

		const agent: AgentInstance = {
			id: agentId,
			type: agentType,
			missionId,
			taskId,
			status: 'idle',
			currentAction: 'Initializing',
			activityLog: [],
			filesRead: [],
			filesWritten: [],
			startedAt: now,
			completedAt: null,
		};

		this.agents.set(agentId, agent);
		this._onDidChangeAgents.fire();

		// Start agent execution
		this.executeAgent(agent, taskDescription, context).catch(error => {
			console.error(`Agent ${agentId} execution failed:`, error);
			this.markAgentFailed(agentId, error.message);
		});

		return agentId;
	}

	getAgent(agentId: string): AgentInstance | null {
		return this.agents.get(agentId) || null;
	}

	getAgentsForMission(missionId: string): AgentInstance[] {
		return Array.from(this.agents.values()).filter(agent => agent.missionId === missionId);
	}

	getAllActiveAgents(): AgentInstance[] {
		return Array.from(this.agents.values()).filter(agent =>
			['idle', 'planning', 'executing', 'blocked'].includes(agent.status)
		);
	}

	async abortAgent(agentId: string): Promise<void> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent ${agentId} not found`);
		}

		// Cancel execution
		const executionState = this.executionStates.get(agentId);
		if (executionState) {
			executionState.tokenSource.cancel();
			executionState.abortController.abort();
			this.executionStates.delete(agentId);
		}

		agent.status = 'failed';
		agent.completedAt = Date.now();
		this.addActivityLog(agent, 'Aborted', 'Agent was manually aborted', null, null);
		this._onDidChangeAgents.fire();
	}

	private async executeAgent(agent: AgentInstance, taskDescription: string, context?: any): Promise<void> {
		const tokenSource = new CancellationTokenSource();
		const abortController = new AbortController();

		this.executionStates.set(agent.id, { agentId: agent.id, tokenSource, abortController });

		try {
			// Step 1: Read task
			this.updateAgentStatus(agent, 'executing', 'Reading task');
			this.addActivityLog(agent, 'Read task', `Task: ${taskDescription}`, null, null);

			// Step 2: Read memory
			this.updateAgentStatus(agent, 'executing', 'Reading memory');
			const workspaceId = await this.memoryService.getWorkspaceId();
			const memoryEntries = await this.memoryService.getEntries('codebase_file' as any, workspaceId);
			this.addActivityLog(agent, 'Read memory', `Loaded ${memoryEntries.length} memory entries`, null, null);

			// File locks are acquired per-write inside processToolCalls via fileLockService.
			try {
				// Step 4: Execute LLM
				this.updateAgentStatus(agent, 'executing', 'Executing LLM');
				const prompt = this.generatePrompt(agent.type, taskDescription, memoryEntries, context);
				const llmResponse = await this.callLLM(prompt, tokenSource.token);
				this.addActivityLog(agent, 'LLM execution', 'Received LLM response', null, null);

				// Step 5: Tool calls
				this.updateAgentStatus(agent, 'executing', 'Processing tool calls');
				await this.processToolCalls(agent, llmResponse, tokenSource.token, abortController.signal);

				// Step 6: Write activity log (already done throughout the process)

				// Step 7: Write memory
				this.updateAgentStatus(agent, 'executing', 'Writing memory');
				await this.writeMemory(agent, taskDescription, llmResponse);
				this.addActivityLog(agent, 'Write memory', 'Saved execution results to memory', null, null);

				// Step 8: Report completion
				this.updateAgentStatus(agent, 'complete', 'Task completed');
				this.addActivityLog(agent, 'Completion', 'Agent completed successfully', null, null);
				agent.completedAt = Date.now();
			} finally {
				// per-write locks are released inside processToolCalls
			}
		} catch (error) {
			if (!tokenSource.token.isCancellationRequested) {
				this.markAgentFailed(agent.id, error instanceof Error ? error.message : String(error));
			}
		} finally {
			this.executionStates.delete(agent.id);
			this._onDidChangeAgents.fire();
		}
	}

	private generatePrompt(
		agentType: AgentType,
		taskDescription: string,
		memoryEntries: any[],
		context?: any
	): string {
		const memoryStrings = memoryEntries.map(entry => entry.content);

		switch (agentType) {
			case 'planner':
				return generatePlannerPrompt({
					context: {
						memoryEntries: memoryStrings,
						directoryTree: context?.directoryTree || '',
						fileOwnership: context?.fileOwnership || '',
						outcome: taskDescription,
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'coder':
				return generateCoderPrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						plannerOutput: context?.plannerOutput || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'tester':
				return generateTesterPrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						coderOutput: context?.coderOutput || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'debugger':
				return generateDebuggerPrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						testerOutput: context?.testerOutput || '',
						errorLogs: context?.errorLogs || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'reviewer':
				return generateReviewerPrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						implementationSummary: context?.implementationSummary || '',
						testReport: context?.testReport || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'docs':
				return generateDocsPrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						implementationSummary: context?.implementationSummary || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			case 'release':
				return generateReleasePrompt({
					context: {
						memoryEntries: memoryStrings,
						taskDescription,
						missionSummary: context?.missionSummary || '',
						attachedContext: context?.attachedContext || '',
					},
				});
			default:
				throw new Error(`Unknown agent type: ${agentType}`);
		}
	}

	private async callLLM(prompt: string, token: CancellationToken): Promise<string> {
		return new Promise((resolve, reject) => {
			if (token.isCancellationRequested) {
				reject(new Error('LLM call cancelled'));
				return;
			}

			const modelSelection = this.settingsService.state.modelSelectionOfFeature['Chat'];

			const requestId = this.llmMessageService.sendLLMMessage({
				messages: [{ role: 'user', content: prompt }],
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				logging: { loggingName: 'ribix-agent' },
				onText: (_params) => { /* streaming text — not used; wait for final */ },
				onFinalMessage: (params) => { resolve(params.fullText); },
				onError: (params) => { reject(new Error(params.message)); },
				onAbort: () => { reject(new Error('LLM call aborted')); },
			});

			if (!requestId) {
				reject(new Error('Failed to send LLM message'));
				return;
			}

			// Cancel the in-flight request if the cancellation token fires
			token.onCancellationRequested(() => {
				this.llmMessageService.abort(requestId);
			});
		});
	}

	private async processToolCalls(
		agent: AgentInstance,
		llmResponse: string,
		token: CancellationToken,
		signal: AbortSignal
	): Promise<void> {
		// Parse tool calls embedded in the LLM response. The agent prompt instructs the
		// model to emit tool calls as JSON blocks: {"tool":"write_file","params":{...}}
		const toolCallPattern = /```json\s*(\{[^`]*"tool"\s*:[^`]*\})\s*```/gs;
		const matches = [...llmResponse.matchAll(toolCallPattern)];

		if (matches.length === 0) {
			this.addActivityLog(agent, 'Tool calls', 'No tool calls in response', null, null);
			return;
		}

		for (const match of matches) {
			if (token.isCancellationRequested) {
				break;
			}

			let call: { tool: string; params: Record<string, unknown> };
			try {
				call = JSON.parse(match[1]);
			} catch {
				this.addActivityLog(agent, 'Tool call parse error', match[1], null, null);
				continue;
			}

			const { tool, params } = call;
			this.addActivityLog(agent, 'Tool call', `${tool}`, tool, (params?.path as string) ?? null);

			// Checkpoint before every file write so rollback works
			if ((tool === 'write_file' || tool === 'edit_file') && typeof params?.path === 'string') {
				const releaseLock = await this.fileLockService.acquire(params.path, agent.id);
				try {
					await this.checkpointService.checkpoint(agent.missionId, agent.id, params.path);
					this.addActivityLog(agent, 'Checkpoint created', params.path, null, params.path);

					const result = await (this.toolsService as any)[tool]?.(params);
					agent.filesWritten.push(params.path);
					this.addActivityLog(agent, 'File written', params.path, tool, params.path);
					void result;
				} finally {
					releaseLock();
				}
			} else if (tool === 'read_file' && typeof params?.path === 'string') {
				const result = await (this.toolsService as any).readFile?.(params);
				agent.filesRead.push(params.path);
				this.addActivityLog(agent, 'File read', params.path, tool, params.path);
				void result;
			} else {
				// Other tools (run_terminal, search_codebase, etc.) — execute directly
				const result = await (this.toolsService as any)[tool]?.(params);
				void result;
			}
		}
	}

	private async writeMemory(agent: AgentInstance, taskDescription: string, llmResponse: string): Promise<void> {
		const workspaceId = await this.memoryService.getWorkspaceId();
		await this.memoryService.writeEntry({
			type: 'mission_summary' as any,
			workspaceId,
			content: JSON.stringify({
				agentId: agent.id,
				agentType: agent.type,
				taskDescription,
				llmResponse,
				timestamp: Date.now(),
			}),
			metadata: {
				agentId: agent.id,
				agentType: agent.type,
				taskId: agent.taskId,
			},
			confidence: 0.8,
			source: 'agent',
		});
	}

	private updateAgentStatus(agent: AgentInstance, status: AgentStatus, currentAction: string): void {
		agent.status = status;
		agent.currentAction = currentAction;
		this._onDidChangeAgents.fire();
	}

	private addActivityLog(agent: AgentInstance, action: string, detail: string | null, tool: string | null, filePath: string | null): void {
		const entry: AgentActivityEntry = {
			timestamp: Date.now(),
			agentId: agent.id,
			action,
			detail,
			tool,
			filePath,
		};
		agent.activityLog.push(entry);
		this._onDidChangeAgents.fire();
	}

	private markAgentFailed(agentId: string, errorMessage: string): void {
		const agent = this.agents.get(agentId);
		if (agent) {
			agent.status = 'failed';
			agent.completedAt = Date.now();
			this.addActivityLog(agent, 'Failed', errorMessage, null, null);
			this._onDidChangeAgents.fire();
		}
	}
}

registerSingleton(IRibixAgentService, RibixAgentService, InstantiationType.Delayed);