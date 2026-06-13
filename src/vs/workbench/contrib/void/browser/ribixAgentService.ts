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
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js';
import { IRibixFileLockService } from '../common/ribixFileLockService.js';
import { IMCPService } from '../common/mcpService.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { IRibixCheckpointService } from './ribixCheckpointService.js';
import { AgentInstance, AgentStatus, AgentType, AgentActivityEntry, AgentOutput, AgentFinding, RiskLevel } from '../common/ribixTypes.js';
import { AgentTurnMessage, AgentLoopBudget, ParsedToolCall, DEFAULT_AGENT_BUDGETS, estimateTokens } from '../common/ribixAgentLoopTypes.js';
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
	onDidCompleteAgent: Event<{ agentId: string; status: 'complete' | 'failed' }>;
}

export const IRibixAgentService = createDecorator<IRibixAgentService>('ribixAgentService');

interface AgentExecutionState {
	agentId: string;
	tokenSource: CancellationTokenSource;
	abortController: AbortController;
}

export class RibixAgentService extends Disposable implements IRibixAgentService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = new Emitter<void>();
	readonly onDidChangeAgents = this._onDidChangeAgents.event;

	private readonly _onDidCompleteAgent = new Emitter<{ agentId: string; status: 'complete' | 'failed' }>();
	readonly onDidCompleteAgent = this._onDidCompleteAgent.event;

	/** Write tools that mutate files and require lock + checkpoint before execution. */
	private static readonly WRITE_TOOLS = new Set(['rewrite_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder']);

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
		this._register(this._onDidChangeAgents);
		this._register(this._onDidCompleteAgent);
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
			output: null,
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

	private budgetForType(type: AgentType): AgentLoopBudget {
		return DEFAULT_AGENT_BUDGETS[type];
	}

	/**
	 * Real multi-turn agentic loop. Maintains a running message array and feeds tool
	 * results back to the model every turn until the model emits no tool calls, or a
	 * budget guard (turns / tokens / deadline) terminates it cleanly.
	 */
	private async executeAgent(agent: AgentInstance, taskDescription: string, context?: any): Promise<void> {
		const tokenSource = new CancellationTokenSource();
		const abortController = new AbortController();
		this.executionStates.set(agent.id, { agentId: agent.id, tokenSource, abortController });

		const budget = this.budgetForType(agent.type);
		const deadline = Date.now() + budget.deadlineMs;
		let lastAssistantMessage = '';
		let lastTestReport: string | null = null;
		let budgetHit: string | null = null;

		try {
			this.updateAgentStatus(agent, 'executing', 'Reading memory');
			const workspaceId = await this.memoryService.getWorkspaceId();
			const memoryEntries = await this.memoryService.getEntries('codebase_file' as any, workspaceId);
			this.addActivityLog(agent, 'Read memory', `Loaded ${memoryEntries.length} memory entries`, null, null);

			const messages: AgentTurnMessage[] = [
				{ role: 'system', content: this.generatePrompt(agent.type, taskDescription, memoryEntries, context) },
				{ role: 'user', content: taskDescription },
			];

			for (let turn = 0; turn < budget.maxTurns; turn++) {
				if (tokenSource.token.isCancellationRequested) { break; }
				if (Date.now() > deadline) { budgetHit = 'deadline'; break; }
				if (estimateTokens(messages) > budget.maxTokens) { budgetHit = 'tokens'; break; }

				this.updateAgentStatus(agent, 'executing', `Turn ${turn + 1}`);
				const reply = await this.callLLM(messages, tokenSource.token);
				messages.push({ role: 'assistant', content: reply });
				lastAssistantMessage = reply;
				this.addActivityLog(agent, 'LLM turn', `Turn ${turn + 1} response`, null, null);

				const toolCalls = this.parseToolCalls(reply);
				if (toolCalls.length === 0) {
					break; // model is done
				}

				for (const call of toolCalls) {
					if (tokenSource.token.isCancellationRequested) { break; }
					const resultText = await this.runOneTool(agent, call);
					messages.push({ role: 'tool', toolName: call.tool, content: resultText });
					if (call.tool === 'run_command' || call.tool === 'run_persistent_command') {
						lastTestReport = resultText;
					}
				}

				if (turn === budget.maxTurns - 1) { budgetHit = 'maxTurns'; }
			}

			if (tokenSource.token.isCancellationRequested) {
				return; // aborted — abortAgent already set terminal state
			}

			agent.output = this.buildAgentOutput(agent, lastAssistantMessage, lastTestReport, budgetHit);

			this.updateAgentStatus(agent, 'executing', 'Writing memory');
			await this.writeMemory(agent, taskDescription, agent.output);
			this.addActivityLog(agent, 'Write memory', 'Saved agent run to memory', null, null);

			agent.completedAt = Date.now();
			const completionDetail = budgetHit ? `Completed (budget: ${budgetHit})` : 'Task completed';
			this.updateAgentStatus(agent, 'complete', completionDetail);
			this.addActivityLog(agent, 'Completion', completionDetail, null, null);
		} catch (error) {
			if (!tokenSource.token.isCancellationRequested) {
				this.markAgentFailed(agent.id, error instanceof Error ? error.message : String(error));
			}
		} finally {
			this.executionStates.delete(agent.id);
			this._onDidChangeAgents.fire();
		}
	}

	/**
	 * Builds the structured AgentOutput consumed by orchestration for inter-agent handoff.
	 * summary/findings/blocked are parsed from the final assistant message; filesChanged
	 * comes from the agent's recorded writes; testReport from the last command tool result.
	 */
	private buildAgentOutput(
		agent: AgentInstance,
		finalMessage: string,
		testReport: string | null,
		budgetHit: string | null,
	): AgentOutput {
		return {
			summary: this.extractSummary(finalMessage),
			filesChanged: [...agent.filesWritten],
			testReport,
			findings: agent.type === 'reviewer' ? this.extractFindings(finalMessage) : [],
			blocked: this.extractBlocked(finalMessage, budgetHit),
			rawFinalMessage: finalMessage,
		};
	}

	private extractSummary(finalMessage: string): string {
		const trimmed = finalMessage.trim();
		if (!trimmed) { return 'No summary produced.'; }
		// Prefer an explicit "Summary:" line if present, else first non-empty paragraph.
		const summaryMatch = trimmed.match(/^\s*summary\s*:\s*(.+)$/im);
		if (summaryMatch) { return summaryMatch[1].trim().slice(0, 500); }
		const firstParagraph = trimmed.split(/\n\s*\n/)[0].replace(/```[\s\S]*?```/g, '').trim();
		return (firstParagraph || trimmed).slice(0, 500);
	}

	private extractBlocked(finalMessage: string, budgetHit: string | null): { reason: string } | null {
		const blockedMatch = finalMessage.match(/^\s*blocked\s*:\s*(.+)$/im);
		if (blockedMatch) { return { reason: blockedMatch[1].trim().slice(0, 500) }; }
		if (budgetHit) { return { reason: `Budget exhausted (${budgetHit})` }; }
		return null;
	}

	private extractFindings(finalMessage: string): AgentFinding[] {
		// Reviewer findings emitted as a fenced JSON array: ```json [ { severity, file, line, message } ] ```
		const findingsBlock = finalMessage.match(/```json\s*(\[[\s\S]*?\])\s*```/);
		if (!findingsBlock) { return []; }
		try {
			const parsed = JSON.parse(findingsBlock[1]);
			if (!Array.isArray(parsed)) { return []; }
			return parsed
				.filter((f: any) => f && typeof f.message === 'string')
				.map((f: any): AgentFinding => ({
					severity: (['low', 'medium', 'high'].includes(f.severity) ? f.severity : 'medium') as RiskLevel,
					file: typeof f.file === 'string' ? f.file : '',
					line: typeof f.line === 'number' ? f.line : null,
					message: String(f.message),
				}));
		} catch {
			return [];
		}
	}

	/**
	 * Parses tool calls from an assistant turn. Agent prompts instruct the model to emit
	 * tool calls as JSON fenced blocks containing a "tool" key:
	 * ```json
	 * {"tool": "read_file", "params": {"uri": "/abs/path/to/file"}}
	 * ```
	 */
	private parseToolCalls(llmResponse: string): ParsedToolCall[] {
		const toolCallPattern = /```json\s*(\{[\s\S]*?"tool"\s*:[\s\S]*?\})\s*```/g;
		const matches = [...llmResponse.matchAll(toolCallPattern)];
		const calls: ParsedToolCall[] = [];
		for (const match of matches) {
			try {
				const parsed = JSON.parse(match[1]) as { tool?: unknown; params?: unknown };
				if (typeof parsed.tool === 'string') {
					calls.push({
						tool: parsed.tool,
						params: (parsed.params ?? {}) as Record<string, string | undefined>,
					});
				}
			} catch {
				// ignore malformed tool-call block
			}
		}
		return calls;
	}

	/**
	 * Executes a single tool call and returns a string representation of its result,
	 * which the loop feeds back to the model as a `tool` message. Write tools acquire a
	 * lock and checkpoint before mutating; the lock is always released in `finally`.
	 */
	private async runOneTool(agent: AgentInstance, call: ParsedToolCall): Promise<string> {
		const { tool, params } = call;

		// Route unknown tools through MCP (Playwright MCP, browser MCP, etc.)
		if (!this.toolsService.validateParams[tool as keyof typeof this.toolsService.validateParams]) {
			const mcpTools = this.mcpService.getMCPTools() ?? [];
			const mcpTool = mcpTools.find(t => t.name === tool);
			if (mcpTool?.mcpServerName) {
				this.addActivityLog(agent, 'MCP tool call', `${mcpTool.mcpServerName}/${tool}`, tool, null);
				const mcpResult = await this.mcpService.callMCPTool({
					serverName: mcpTool.mcpServerName,
					toolName: tool,
					params: params as Record<string, unknown>,
				});
				const text = String((mcpResult?.result as any)?.content?.[0]?.text ?? '');
				this.addActivityLog(agent, 'MCP tool result', text.slice(0, 200), tool, null);
				return text || `(no output from ${tool})`;
			}
			this.addActivityLog(agent, 'Unknown tool skipped', tool, tool, null);
			return `Error: unknown tool "${tool}".`;
		}

		// Validate raw string params → typed params (handles URI string → URI object conversion)
		let validated: any;
		try {
			validated = this.toolsService.validateParams[tool as keyof typeof this.toolsService.validateParams](params);
		} catch (err) {
			this.addActivityLog(agent, 'Tool param validation failed', `${tool}: ${err}`, tool, null);
			return `Error: invalid params for "${tool}": ${err instanceof Error ? err.message : String(err)}`;
		}

		const filePath: string | null = validated?.uri?.fsPath ?? null;
		this.addActivityLog(agent, 'Tool call', tool, tool, filePath);

		const stringify = (result: unknown): string => {
			try {
				return this.toolsService.stringOfResult[tool as keyof typeof this.toolsService.stringOfResult](validated as never, result as never);
			} catch {
				return typeof result === 'string' ? result : JSON.stringify(result);
			}
		};

		if (RibixAgentService.WRITE_TOOLS.has(tool) && filePath) {
			const releaseLock = await this.fileLockService.acquire(filePath, agent.id);
			try {
				await this.checkpointService.checkpoint(agent.missionId, agent.id, filePath);
				this.addActivityLog(agent, 'Checkpoint created', filePath, null, filePath);
				const { result } = await this.toolsService.callTool[tool as keyof typeof this.toolsService.callTool](validated as never);
				const awaited = await result;
				if (!agent.filesWritten.includes(filePath)) { agent.filesWritten.push(filePath); }
				this.addActivityLog(agent, 'File written', filePath, tool, filePath);
				return stringify(awaited);
			} finally {
				releaseLock();
			}
		}

		const { result } = await this.toolsService.callTool[tool as keyof typeof this.toolsService.callTool](validated as never);
		const awaited = await result;
		if (tool === 'read_file' && filePath && !agent.filesRead.includes(filePath)) {
			agent.filesRead.push(filePath);
			this.addActivityLog(agent, 'File read', filePath, tool, filePath);
		}
		return stringify(awaited);
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

	/**
	 * Sends the running message array to the model and resolves with the assistant text.
	 * The leading `system` message is passed via `separateSystemMessage`; remaining turns
	 * (including fed-back `tool` results) are flattened into provider-agnostic chat messages.
	 */
	private async callLLM(messages: AgentTurnMessage[], token: CancellationToken): Promise<string> {
		const systemMessage = messages.find(m => m.role === 'system');
		const chatMessages: LLMChatMessage[] = [];
		for (const m of messages) {
			if (m.role === 'system') {
				continue;
			} else if (m.role === 'assistant') {
				chatMessages.push({ role: 'assistant', content: m.content });
			} else if (m.role === 'tool') {
				// Feed tool output back as a user turn so the model can react to it. Kept
				// provider-agnostic (text) rather than using native tool_call_id plumbing.
				chatMessages.push({ role: 'user', content: `[tool result: ${m.toolName}]\n${m.content}` });
			} else {
				chatMessages.push({ role: 'user', content: m.content });
			}
		}

		return new Promise((resolve, reject) => {
			if (token.isCancellationRequested) {
				reject(new Error('LLM call cancelled'));
				return;
			}

			const modelSelection = this.settingsService.state.modelSelectionOfFeature['Chat'];

			const requestId = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: chatMessages,
				separateSystemMessage: systemMessage?.content,
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

	/**
	 * Persists a single agent run under the dedicated `agent_run` memory type so it never
	 * collides with the mission store (which now uses its own IStorageService namespace).
	 */
	private async writeMemory(agent: AgentInstance, taskDescription: string, output: AgentOutput): Promise<void> {
		const workspaceId = await this.memoryService.getWorkspaceId();
		await this.memoryService.writeEntry({
			type: 'agent_run',
			workspaceId,
			content: JSON.stringify({
				agentId: agent.id,
				agentType: agent.type,
				taskDescription,
				output,
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
		if (status === 'complete') {
			this._onDidCompleteAgent.fire({ agentId: agent.id, status: 'complete' });
		}
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
			if (!agent.output) {
				agent.output = {
					summary: 'Agent failed before producing output.',
					filesChanged: [...agent.filesWritten],
					testReport: null,
					findings: [],
					blocked: { reason: errorMessage },
					rawFinalMessage: '',
				};
			}
			this.addActivityLog(agent, 'Failed', errorMessage, null, null);
			this._onDidChangeAgents.fire();
			this._onDidCompleteAgent.fire({ agentId: agent.id, status: 'failed' });
		}
	}
}

registerSingleton(IRibixAgentService, RibixAgentService, InstantiationType.Delayed);