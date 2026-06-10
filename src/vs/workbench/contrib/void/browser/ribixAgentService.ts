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
import { IMCPService } from '../common/mcpService.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { IRibixCheckpointService } from './ribixCheckpointService.js';
import { AgentInstance, AgentStatus, AgentType, AgentActivityEntry } from '../common/ribixTypes.js';
import { generatePlannerPrompt } from '../common/prompt/ribixPlannerPrompt.js';
import { generateCoderPrompt } from '../common/prompt/ribixCoderPrompt.js';
import { generateTesterPrompt } from '../common/prompt/ribixTesterPrompt.js';
import { generateDebuggerPrompt } from '../common/prompt/ribixDebuggerPrompt.js';
import { generateReviewerPrompt } from '../common/prompt/ribixReviewerPrompt.js';
import { generateDocsPrompt } from '../common/prompt/ribixDocsPrompt.js';
import { generateReleasePrompt } from '../common/prompt/ribixReleasePrompt.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';

export interface IRibixAgentService {
	readonly _serviceBrand: undefined;

	// Agent lifecycle
	spawnAgent(missionId: string, taskId: string, agentType: AgentType, taskDescription: string, context?: any): Promise<string>;
	getAgent(agentId: string): AgentInstance | null;
	getAgentsForMission(missionId: string): AgentInstance[];
	getAllActiveAgents(): AgentInstance[];
	getAllKnownAgents(): AgentInstance[];
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
		@IMCPService private readonly mcpService: IMCPService,
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

	getAllKnownAgents(): AgentInstance[] {
		return Array.from(this.agents.values());
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
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: prompt }],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				logging: { loggingName: 'ribix-agent' },
				onText: (_params) => { /* streaming — not used; wait for onFinalMessage */ },
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
		_signal: AbortSignal
	): Promise<void> {
		// Agent prompts instruct the model to emit tool calls as JSON fenced blocks:
		// ```json
		// {"tool": "read_file", "params": {"uri": "/abs/path/to/file"}}
		// ```
		const toolCallPattern = /```json\s*(\{[\s\S]*?"tool"\s*:[\s\S]*?\})\s*```/g;
		const matches = [...llmResponse.matchAll(toolCallPattern)];

		if (matches.length === 0) {
			this.addActivityLog(agent, 'Tool calls', 'No tool calls in response', null, null);
			return;
		}

		// WRITE_TOOLS: tools that mutate files and require lock + checkpoint before execution.
		// The API uses 'rewrite_file' (full overwrite) and 'edit_file' (search/replace blocks).
		const WRITE_TOOLS = new Set(['rewrite_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder']);

		for (const match of matches) {
			if (token.isCancellationRequested) {
				break;
			}

			let call: { tool: string; params: Record<string, string | undefined> };
			try {
				call = JSON.parse(match[1]);
			} catch {
				this.addActivityLog(agent, 'Tool call parse error', match[1].slice(0, 120), null, null);
				continue;
			}

			const { tool, params } = call;

			// Route unknown tools through MCP (Playwright MCP, browser MCP, etc.)
			if (!this.toolsService.validateParams[tool as keyof typeof this.toolsService.validateParams]) {
				// Find an MCP server that exposes this tool
				const mcpTools = this.mcpService.getMCPTools() ?? [];
				const mcpTool = mcpTools.find(t => t.name === tool);
				if (mcpTool?.mcpServerName) {
					this.addActivityLog(agent, 'MCP tool call', `${mcpTool.mcpServerName}/${tool}`, tool, null);
					const mcpResult = await this.mcpService.callMCPTool({
						serverName: mcpTool.mcpServerName,
						toolName: tool,
						params: params as Record<string, unknown>,
					});
					this.addActivityLog(agent, 'MCP tool result', String((mcpResult?.result as any)?.content?.[0]?.text ?? ''), tool, null);
				} else {
					this.addActivityLog(agent, 'Unknown tool skipped', tool, tool, null);
				}
				continue;
			}

			// Validate raw string params → typed params (handles URI string → URI object conversion)
			let validated: any;
			try {
				validated = this.toolsService.validateParams[tool as keyof typeof this.toolsService.validateParams](params);
			} catch (err) {
				this.addActivityLog(agent, 'Tool param validation failed', `${tool}: ${err}`, tool, null);
				continue;
			}

			const filePath: string | null = validated?.uri?.fsPath ?? null;
			this.addActivityLog(agent, 'Tool call', tool, tool, filePath);

			if (WRITE_TOOLS.has(tool) && filePath) {
				// Acquire lock, checkpoint current content, then write
				const releaseLock = await this.fileLockService.acquire(filePath, agent.id);
				try {
					await this.checkpointService.checkpoint(agent.missionId, agent.id, filePath);
					this.addActivityLog(agent, 'Checkpoint created', filePath, null, filePath);

					await this.toolsService.callTool[tool as keyof typeof this.toolsService.callTool](validated as never);
					agent.filesWritten.push(filePath);
					this.addActivityLog(agent, 'File written', filePath, tool, filePath);
				} finally {
					releaseLock();
				}
			} else if (tool === 'read_file' && filePath) {
				await this.toolsService.callTool.read_file(validated);
				if (!agent.filesRead.includes(filePath)) {
					agent.filesRead.push(filePath);
				}
				this.addActivityLog(agent, 'File read', filePath, tool, filePath);
			} else {
				// All other tools (search, run_command, ls_dir, etc.) — execute directly
				await this.toolsService.callTool[tool as keyof typeof this.toolsService.callTool](validated as never);
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