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
import { AgentInstance, AgentStatus, AgentType, AgentActivityEntry, AgentOutput, AgentFinding, RiskLevel } from '../common/ribixTypes.js';
import { AgentTurnMessage, AgentLoopBudget, ParsedToolCall, DEFAULT_AGENT_BUDGETS, estimateTokens } from '../common/ribixAgentLoopTypes.js';
import { generatePlannerPrompt } from '../common/prompt/ribixPlannerPrompt.js';
import { generateCoderPrompt } from '../common/prompt/ribixCoderPrompt.js';
import { generateTesterPrompt } from '../common/prompt/ribixTesterPrompt.js';
import { generateDebuggerPrompt } from '../common/prompt/ribixDebuggerPrompt.js';
import { generateReviewerPrompt } from '../common/prompt/ribixReviewerPrompt.js';
import { generateDocsPrompt } from '../common/prompt/ribixDocsPrompt.js';
import { generateReleasePrompt } from '../common/prompt/ribixReleasePrompt.js';
import { BROWSER_AGENT_PROMPT } from './ribixBrowserAgent.js';
import { IRibixSettingsService } from '../common/ribixSettingsService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { PlaywrightRunner, PlaywrightFinding } from './playwrightRunner.js';
import { agentProgressFeed } from './agentProgressFeed.js';
import { IFixMemoryService } from './fixMemory.js';
import { callLlm, parseToolCalls } from './ribixAgentLlmClient.js';
import { agentSandboxInstance, SandboxBlockedError } from './agentSandbox.js';
import { CostTracker, DEFAULT_MISSION_CEILING_TOKENS, MISSION_BUDGET_EXCEEDED_MESSAGE } from './costTracker.js';

/** Storage key under which the workspace staging URL is persisted. */
const RIBIX_STAGING_URL_KEY = 'ribix.stagingUrl';

/**
 * #149: Storage key for persisting completed agent runs to workspace storage
 * so they survive IDE restarts. Stored as a JSON array of serialized agents.
 */
const RIBIX_AGENT_RUNS_STORAGE_KEY = 'ribix.agentRuns.v1';

/** #149: Sub-folder inside globalStorageHome where agent run JSON files are kept. */
const AGENT_RUNS_STORAGE_FOLDER = 'ribix-agent-runs';

/** #149: Maximum number of persisted agent run files to retain on disk. */
const MAX_PERSISTED_AGENT_RUNS = 100;

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

	// #152: Rate limiting — returns the number of currently executing agents.
	getActiveRunCount(): number;
	// #152: Returns the number of queued agent runs waiting for a slot.
	getQueuedRunCount(): number;

	// #150: GDPR right-to-be-forgotten — clears all local agent run data
	// (in-memory agents, persisted JSON files, and workspace storage entries).
	deleteAllAgentRunData(): Promise<void>;

	// #149: Returns all persisted (completed/failed) agent runs loaded from disk.
	getPersistedAgentRuns(): AgentInstance[];
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

	/** Temporary storage for Playwright findings collected during tester agent runs. */
	private readonly _playwrightFindingsMap = new Map<string, PlaywrightFinding[]>();

	/** Write tools that mutate files and require lock + checkpoint before execution. */
	private static readonly WRITE_TOOLS = new Set(['rewrite_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder']);

	/** Tools that execute commands / spawn terminals (can run tests, build, mutate via shell). */
	private static readonly COMMAND_TOOLS = new Set(['run_command', 'run_persistent_command', 'open_persistent_terminal', 'kill_persistent_terminal']);

	/**
	 * #115: Per-agent-type tool allowlists, enforced in code (not just the prompt).
	 * A tool is permitted for an agent type if it is read-only OR explicitly listed here.
	 * Read-only tools (read_file, ls_dir, searches, lint, browser inspection) are always
	 * allowed for every type. Write tools and command tools must be opted into per type.
	 *  - reviewer/planner/docs: read-only only (no write, no command execution).
	 *  - tester: read-only + command tools (may run tests) but no file writes.
	 *  - coder/debugger/release/browser: read-only + write + command (full capability).
	 */
	private static readonly EXTRA_ALLOWED_TOOLS: Record<AgentType, ReadonlySet<string>> = {
		planner: new Set<string>(),
		reviewer: new Set<string>(),
		docs: new Set<string>(),
		'onboarding-persona': new Set<string>(),
		tester: RibixAgentService.COMMAND_TOOLS,
		coder: new Set([...RibixAgentService.WRITE_TOOLS, ...RibixAgentService.COMMAND_TOOLS]),
		debugger: new Set([...RibixAgentService.WRITE_TOOLS, ...RibixAgentService.COMMAND_TOOLS]),
		release: new Set([...RibixAgentService.WRITE_TOOLS, ...RibixAgentService.COMMAND_TOOLS]),
		browser: new Set([...RibixAgentService.WRITE_TOOLS, ...RibixAgentService.COMMAND_TOOLS]),
	};

	/**
	 * Returns true if `tool` is allowed for `agentType`. Read-only tools are always allowed;
	 * write/command tools are only allowed if listed in EXTRA_ALLOWED_TOOLS for the type.
	 * MCP / unknown tools are not gated here (handled by their own routing in runOneTool).
	 */
	private isToolAllowed(agentType: AgentType, tool: string): boolean {
		if (!RibixAgentService.WRITE_TOOLS.has(tool) && !RibixAgentService.COMMAND_TOOLS.has(tool)) {
			return true; // read-only builtin tool
		}
		return RibixAgentService.EXTRA_ALLOWED_TOOLS[agentType]?.has(tool) ?? false;
	}

	/**
	 * Maximum number of completed/failed agents to retain in memory for UI queries.
	 * Older entries beyond this cap are pruned once a new agent finishes. Active agents
	 * (status 'idle'|'planning'|'executing'|'blocked') are never pruned.
	 */
	private static readonly MAX_COMPLETED_AGENTS = 50;

	/**
	 * #118: Message-history growth cap. Tool results from old turns are the dominant
	 * source of token bloat in long runs. We keep the most-recent RECENT_TOOL_RESULTS
	 * tool messages verbatim and truncate the content of any older tool message to
	 * TRUNCATED_TOOL_RESULT_CHARS, leaving a marker. System/user/assistant turns are
	 * never touched, so the model retains its instructions and full reasoning trail.
	 */
	private static readonly RECENT_TOOL_RESULTS = 6;
	private static readonly TRUNCATED_TOOL_RESULT_CHARS = 500;

	/** #118: Debug flag gating per-turn timing logs (off unless the config key is set). */
	private get timingDebugEnabled(): boolean {
		return this.configurationService?.getValue<boolean>('ribix.agentLoop.debugTiming') === true;
	}

	/**
	 * #152: Maximum number of concurrently executing agents. Additional spawn
	 * requests are queued and dispatched when a slot frees up.
	 */
	private static readonly MAX_CONCURRENT_AGENT_RUNS = 3;

	/**
	 * #152: Queue of pending agent spawn requests waiting for a concurrency slot.
	 * Each entry contains the arguments needed to start the agent once a slot opens.
	 */
	private readonly _agentQueue: Array<{
		agent: AgentInstance;
		taskDescription: string;
		context?: any;
	}> = [];

	/** #149: Persisted agent runs loaded from disk on startup. */
	private _persistedAgentRuns: AgentInstance[] = [];

	/** #149: URI of the directory where agent run JSON files are stored. */
	private _agentRunsStorageUri: URI | undefined;

	private agents: Map<string, AgentInstance> = new Map();
	private executionStates: Map<string, AgentExecutionState> = new Map();

	constructor(
		@IToolsService private readonly toolsService: IToolsService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IRibixFileLockService private readonly fileLockService: IRibixFileLockService,
		@IRibixMemoryService private readonly memoryService: IRibixMemoryService,
		@IRibixCheckpointService private readonly checkpointService: IRibixCheckpointService,
		@IRibixSettingsService private readonly settingsService: IRibixSettingsService,
		@IMCPService private readonly mcpService: IMCPService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFixMemoryService private readonly fixMemoryService: IFixMemoryService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
	) {
		super();
		this._register(this._onDidChangeAgents);
		this._register(this._onDidCompleteAgent);
		// #149: Load persisted agent runs from disk on startup.
		this.loadPersistedAgentRuns().catch(e => {
			this.logService.error('Failed to load persisted agent runs:', e);
		});
	}

	/**
	 * #88: Drain in-flight agent runs on IDE shutdown. Aborts all active
	 * agents and waits briefly for them to clean up before the service
	 * is disposed. Prevents silent loss of running missions on crash/exit.
	 */
	public override dispose(): void {
		// Abort all active execution states.
		for (const [agentId, state] of this.executionStates) {
			try {
				state.tokenSource.cancel();
				state.abortController.abort();
			} catch {
				// Best-effort — don't throw during shutdown.
			}
			const agent = this.agents.get(agentId);
			if (agent && (agent.status === 'executing' || agent.status === 'planning' || agent.status === 'blocked')) {
				agent.status = 'failed';
				agent.currentAction = 'Aborted during IDE shutdown';
				agent.completedAt = Date.now();
			}
		}
		this.executionStates.clear();
		this._onDidChangeAgents.fire();
		super.dispose();
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

		// #152: Rate limiting — if at capacity, queue the agent instead of starting it.
		if (this.getActiveRunCount() > RibixAgentService.MAX_CONCURRENT_AGENT_RUNS) {
			agent.currentAction = `Queued (position ${this._agentQueue.length + 1})`;
			this._agentQueue.push({ agent, taskDescription, context });
			this._onDidChangeAgents.fire();
			this.logService.info(`[ribix-agent] Agent ${agentId} queued (${this._agentQueue.length} waiting, ${this.getActiveRunCount()} active)`);
			return agentId;
		}

		// Start agent execution
		this.startAgentExecution(agent, taskDescription, context);

		return agentId;
	}

	/**
	 * #152: Starts agent execution (called directly when a slot is available,
	 * or from the queue drain when a slot frees up).
	 */
	private startAgentExecution(agent: AgentInstance, taskDescription: string, context?: any): void {
		this.executeAgent(agent, taskDescription, context).catch(error => {
			this.logService.error(`Agent ${agent.id} execution failed:`, error);
			this.markAgentFailed(agent.id, error.message);
		});
	}

	/**
	 * #152: Drains the agent queue when a concurrency slot opens up.
	 * Called after each agent completes or is aborted.
	 */
	private drainAgentQueue(): void {
		if (this._agentQueue.length === 0) { return; }
		if (this.getActiveRunCount() > RibixAgentService.MAX_CONCURRENT_AGENT_RUNS) { return; }

		const next = this._agentQueue.shift();
		if (!next) { return; }

		next.agent.currentAction = 'Initializing';
		this._onDidChangeAgents.fire();
		this.logService.info(`[ribix-agent] Draining queue — starting agent ${next.agent.id} (${this._agentQueue.length} still queued)`);
		this.startAgentExecution(next.agent, next.taskDescription, next.context);
	}

	getActiveRunCount(): number {
		return Array.from(this.agents.values()).filter(agent =>
			['idle', 'planning', 'executing', 'blocked'].includes(agent.status)
		).length;
	}

	getQueuedRunCount(): number {
		return this._agentQueue.length;
	}

	getPersistedAgentRuns(): AgentInstance[] {
		return this._persistedAgentRuns;
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
		if (!agent.output) {
			agent.output = {
				summary: 'Agent was manually aborted before producing output.',
				filesChanged: [...agent.filesWritten],
				testReport: null,
				findings: [],
				blocked: { reason: 'aborted' },
				rawFinalMessage: '',
			};
		}
		this.addActivityLog(agent, 'Aborted', 'Agent was manually aborted', null, null);
		const released = this.fileLockService.releaseAllForAgent(agentId);
		if (released > 0) {
			this.addActivityLog(agent, 'File locks released', `${released} lock(s) force-released on abort`, null, null);
		}
		this._onDidChangeAgents.fire();
		// Fire completion so event-driven orchestration tears down its listener
		// (otherwise an aborted agent orphans the per-agent completion listener).
		this._onDidCompleteAgent.fire({ agentId: agent.id, status: 'failed' });
		this.pruneCompletedAgents();
		// #152: A concurrency slot freed up — drain the queue.
		this.drainAgentQueue();
	}

	private budgetForType(type: AgentType): AgentLoopBudget {
		return DEFAULT_AGENT_BUDGETS[type];
	}

	/** A tool call is safe to run in parallel only if it neither writes files nor runs commands. */
	private isReadOnlyTool(tool: string): boolean {
		return !RibixAgentService.WRITE_TOOLS.has(tool) && !RibixAgentService.COMMAND_TOOLS.has(tool);
	}

	/**
	 * #118: Caps message-history growth in place. Truncates the content of all but the
	 * most-recent tool results so accumulated token cost stays bounded across many turns.
	 * Mutates `messages` directly (cheap, no re-allocation of the array).
	 */
	private truncateOldToolResults(messages: AgentTurnMessage[]): void {
		const toolIndexes: number[] = [];
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].role === 'tool') { toolIndexes.push(i); }
		}
		const cutoff = toolIndexes.length - RibixAgentService.RECENT_TOOL_RESULTS;
		for (let k = 0; k < cutoff; k++) {
			const msg = messages[toolIndexes[k]];
			if (msg.role === 'tool' && msg.content.length > RibixAgentService.TRUNCATED_TOOL_RESULT_CHARS) {
				msg.content = `${msg.content.slice(0, RibixAgentService.TRUNCATED_TOOL_RESULT_CHARS)}\n…[older ${msg.toolName} result truncated to bound history growth]`;
			}
		}
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

		// #138: Enforce per-mission token budget via CostTracker. The ceiling defaults
		// to DEFAULT_MISSION_CEILING_TOKENS (100k tokens ≈ $0.50) and can be tuned via
		// ribix.missionCeilingTokens in settings.
		const missionCeiling = this.configurationService?.getValue<number>('ribix.missionCeilingTokens') ?? DEFAULT_MISSION_CEILING_TOKENS;
		const costTracker = new CostTracker(missionCeiling);

		try {
			this.updateAgentStatus(agent, 'executing', 'Reading memory');
			const workspaceId = await this.memoryService.getWorkspaceId();
			const memoryEntries = await this.memoryService.getEntries('codebase_file' as any, workspaceId);
			this.addActivityLog(agent, 'Read memory', `Loaded ${memoryEntries.length} memory entries`, null, null);

			// -----------------------------------------------------------------------
			// Tester agent: run Playwright QA against the staging URL before handing
			// off to the LLM loop. Findings are emitted through agentProgressFeed so
			// the Command Center panel can display them in real-time, and also stored
			// in the agent's output findings list for downstream reviewer/debugger use.
			// -----------------------------------------------------------------------
			if (agent.type === 'tester' && !tokenSource.token.isCancellationRequested) {
				const playwrightFindings = await this.runPlaywrightQA(agent, context);
				// Merge Playwright findings into the agent output findings list.
				// We store them in the service-level map keyed by agentId and merge
				// into the final output after the LLM loop finishes.
				this._playwrightFindingsMap.set(agent.id, playwrightFindings);
			}

			const messages: AgentTurnMessage[] = [
				{ role: 'system', content: this.generatePrompt(agent.type, taskDescription, memoryEntries, context) },
				{ role: 'user', content: taskDescription },
			];

			for (let turn = 0; turn < budget.maxTurns; turn++) {
				if (tokenSource.token.isCancellationRequested) { break; }
				if (Date.now() > deadline) { budgetHit = 'deadline'; break; }

				// #138: Enforce token budget ceiling before each LLM call.
				if (costTracker.isOverCeiling()) { budgetHit = 'tokenCeiling'; throw new Error(MISSION_BUDGET_EXCEEDED_MESSAGE); }

				// #118: Bound history growth BEFORE the token check so a long run is
				// kept under its ceiling by truncation rather than being cut short.
				this.truncateOldToolResults(messages);
				if (estimateTokens(messages) > budget.maxTokens) { budgetHit = 'tokens'; break; }

				this.updateAgentStatus(agent, 'executing', `Turn ${turn + 1}`);
				// #138: Record estimated input tokens before the LLM call.
				costTracker.addTokens(estimateTokens(messages));
				const llmStart = Date.now();
				const reply = await this.callLLM(messages, tokenSource.token);
				const llmMs = Date.now() - llmStart;
				// #138: Record estimated output tokens after the LLM reply.
				costTracker.addTokens(estimateTokens([{ role: 'assistant', content: reply }]));
				messages.push({ role: 'assistant', content: reply });
				lastAssistantMessage = reply;
				this.addActivityLog(agent, 'LLM turn', `Turn ${turn + 1} response`, null, null);

				const toolCalls = this.parseToolCalls(reply);
				if (toolCalls.length === 0) {
					this.logTiming(agent, turn, llmMs, 0, 0, estimateTokens(messages));
					break; // model is done
				}

				// #118: Parallelize independent read-only tool calls within a turn.
				// Write/command tools (and any single-call turn) run sequentially to
				// preserve ordering and the lock/checkpoint discipline; a contiguous run
				// of read-only calls is dispatched concurrently.
				const toolsStart = Date.now();
				for (let i = 0; i < toolCalls.length; i++) {
					if (tokenSource.token.isCancellationRequested) { break; }

					if (this.isReadOnlyTool(toolCalls[i].tool)) {
						// Gather the contiguous batch of read-only calls and run them together.
						const batch: ParsedToolCall[] = [];
						while (i < toolCalls.length && this.isReadOnlyTool(toolCalls[i].tool)) {
							batch.push(toolCalls[i]);
							i++;
						}
						i--; // outer loop will increment
						const results = await Promise.all(batch.map(c => this.runOneTool(agent, c)));
						for (let b = 0; b < batch.length; b++) {
							messages.push({ role: 'tool', toolName: batch[b].tool, content: results[b] });
						}
					} else {
						const call = toolCalls[i];
						const resultText = await this.runOneTool(agent, call);
						messages.push({ role: 'tool', toolName: call.tool, content: resultText });
						if (call.tool === 'run_command' || call.tool === 'run_persistent_command') {
							lastTestReport = resultText;
						}
					}
				}
				this.logTiming(agent, turn, llmMs, Date.now() - toolsStart, toolCalls.length, estimateTokens(messages));

				if (turn === budget.maxTurns - 1) { budgetHit = 'maxTurns'; }
			}

			if (tokenSource.token.isCancellationRequested) {
				return; // aborted — abortAgent already set terminal state
			}

			agent.output = this.buildAgentOutput(agent, lastAssistantMessage, lastTestReport, budgetHit);

			// Merge any pre-collected Playwright findings into the final output.
			const pwFindings: PlaywrightFinding[] | undefined = this._playwrightFindingsMap.get(agent.id);
			this._playwrightFindingsMap.delete(agent.id);
			if (pwFindings && pwFindings.length > 0 && agent.output) {
				const converted: AgentFinding[] = pwFindings.map(f => ({
					severity: f.severity === 'p0' ? 'high' : f.severity === 'p1' ? 'high' : f.severity === 'p2' ? 'medium' : 'low' as const,
					file: f.url,
					line: null,
					message: `[${f.severity.toUpperCase()}] ${f.title}: ${f.errorMessage}`,
				}));
				agent.output.findings = [...agent.output.findings, ...converted];
			}

			this.updateAgentStatus(agent, 'executing', 'Writing memory');
			await this.writeMemory(agent, taskDescription, agent.output);
			this.addActivityLog(agent, 'Write memory', 'Saved agent run to memory', null, null);

			// Fix memory integration:
			// 1. When a coder agent completes successfully with a test report (indicating
			//    tests passed), record the fix so it can be reused in future missions.
			if (agent.type === 'coder' && !budgetHit && agent.output && agent.output.testReport) {
				const primaryFile = agent.filesWritten[0] ?? agent.filesRead[0] ?? '';
				this.fixMemoryService.recordFix({
					filePath: primaryFile,
					errorPattern: '',
					bugDescription: taskDescription,
					fixDiff: agent.output.filesChanged.join('\n'),
					testCode: agent.output.testReport,
					missionId: agent.missionId,
					appliedAt: new Date().toISOString(),
				}).catch(e => {
					this.logService.warn('fixMemoryService.recordFix failed:', e);
				});
			}

			// 2. When any agent produces findings (reviewer, tester), check fix memory for
			//    similar past fixes and surface suggestions via IDE notification.
			if (agent.output && agent.output.findings.length > 0) {
				this.fixMemoryService.showSuggestions(agent.output.findings).catch(e => {
					this.logService.warn('fixMemoryService.showSuggestions failed:', e);
				});
			}

			agent.completedAt = Date.now();
			const completionDetail = budgetHit ? `Completed (budget: ${budgetHit})` : 'Task completed';
			// #138: Log final token budget usage so cost is visible in agent activity.
			this.addActivityLog(agent, 'Token budget', costTracker.getSummary(), null, null);
			this.updateAgentStatus(agent, 'complete', completionDetail);
			this.addActivityLog(agent, 'Completion', completionDetail, null, null);
		} catch (error) {
			if (!tokenSource.token.isCancellationRequested) {
				this.markAgentFailed(agent.id, error instanceof Error ? error.message : String(error));
			}
		} finally {
			this.executionStates.delete(agent.id);
			this._onDidChangeAgents.fire();
			// #149: Persist completed/failed agent runs to disk for backup/recovery.
			this.persistAgentRun(agent).catch(e => {
				this.logService.error('Failed to persist agent run:', e);
			});
			// #152: A concurrency slot freed up — drain the queue.
			this.drainAgentQueue();
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
	 * Parses tool calls from an assistant turn. Delegates to ribixAgentLlmClient.
	 */
	private parseToolCalls(llmResponse: string): ParsedToolCall[] {
		return parseToolCalls(llmResponse);
	}

	/**
	 * Executes a single tool call and returns a string representation of its result,
	 * which the loop feeds back to the model as a `tool` message. Write tools acquire a
	 * lock and checkpoint before mutating; the lock is always released in `finally`.
	 */
	// TODO(replay): Record tool calls and file reads/writes here.
	//   After obtaining `resultText` at the end of this method, call:
	//     missionRecorder?.record({
	//       agentId: agent.id,
	//       agentRole: agent.type,
	//       type: tool === 'readFile' ? 'file_read' : tool === 'writeFile' ? 'file_write' : 'tool_call',
	//       durationMs: Date.now() - callStart,
	//       data: { toolName: tool, filePath, resultSnippet: resultText.slice(0, 200) },
	//     });
	//   Obtain missionRecorder from IRibixMissionService._recorders.get(agent.missionId).
	private async runOneTool(agent: AgentInstance, call: ParsedToolCall): Promise<string> {
		const { tool, params } = call;

		// #115: Enforce the per-agent-type tool allowlist in code. A Reviewer (or any
		// read-only role) that emits a write/command tool gets an explaining tool-result
		// instead of the mutation ever executing — the prompt is advisory, this is the gate.
		if (!this.isToolAllowed(agent.type, tool)) {
			const reason = RibixAgentService.WRITE_TOOLS.has(tool)
				? `a "${agent.type}" agent has a read-only tool allowlist and cannot write files`
				: `a "${agent.type}" agent is not permitted to run commands`;
			this.addActivityLog(agent, 'Tool rejected (allowlist)', `${tool}: ${reason}`, tool, null);
			return `Error: tool "${tool}" is not permitted for this agent — ${reason}. Use read-only tools (read_file, ls_dir, search_*, read_lint_errors) and report findings in your final message instead.`;
		}

		// Route unknown tools through MCP (Playwright MCP, browser MCP, etc.)
		if (!this.toolsService.validateParams[tool as keyof IToolsService['validateParams']]) {
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
			validated = this.toolsService.validateParams[tool as keyof IToolsService['validateParams']](params);
		} catch (err) {
			this.addActivityLog(agent, 'Tool param validation failed', `${tool}: ${err}`, tool, null);
			return `Error: invalid params for "${tool}": ${err instanceof Error ? err.message : String(err)}`;
		}

		const filePath: string | null = validated?.uri?.fsPath ?? null;

		// #131: Enforce outbound request policy via AgentSandbox before any browser navigation.
		// guardRequest() throws SandboxBlockedError when the URL is denied or the per-run
		// request budget is exhausted. The singleton uses a permissive default policy but
		// can be tightened via ribix.configureSandbox or AgentSandbox.fromStagingUrl().
		if (tool === 'browser_navigate' && validated?.url) {
			try {
				agentSandboxInstance.guardRequest(validated.url, agent.id);
			} catch (err) {
				if (err instanceof SandboxBlockedError) {
					this.addActivityLog(agent, 'Sandbox blocked', err.message, tool, null);
					return `Error: outbound request blocked by AgentSandbox — ${err.policyReason}. Configure allowed domains via the "ribix.configureSandbox" command.`;
				}
				throw err;
			}
		}

		this.addActivityLog(agent, 'Tool call', tool, tool, filePath);

		const stringify = (result: unknown): string => {
			try {
				return this.toolsService.stringOfResult[tool as keyof IToolsService['stringOfResult']](validated as never, result as never);
			} catch {
				return typeof result === 'string' ? result : JSON.stringify(result);
			}
		};

		if (RibixAgentService.WRITE_TOOLS.has(tool) && filePath) {
			const releaseLock = await this.fileLockService.acquire(filePath, agent.id);
			try {
				await this.checkpointService.checkpoint(agent.missionId, agent.id, filePath);
				this.addActivityLog(agent, 'Checkpoint created', filePath, null, filePath);
				const { result } = await this.toolsService.callTool[tool as keyof IToolsService['callTool']](validated as never);
				const awaited = await result;
				if (!agent.filesWritten.includes(filePath)) { agent.filesWritten.push(filePath); }
				this.addActivityLog(agent, 'File written', filePath, tool, filePath);
				return stringify(awaited);
			} finally {
				releaseLock();
			}
		}

		const { result } = await this.toolsService.callTool[tool as keyof IToolsService['callTool']](validated as never);
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
			case 'browser':
				// The browser agent normally runs via RibixBrowserAgent (driving the headless
				// browser channel), but if spawned through the model loop it uses its own prompt.
				return `${BROWSER_AGENT_PROMPT}\n\n## Task\n${taskDescription}`;
			default:
				throw new Error(`Unknown agent type: ${agentType}`);
		}
	}

	/**
	 * Sends the running message array to the model and resolves with the assistant text.
	 * Delegates to ribixAgentLlmClient for provider routing and request management.
	 */
	private async callLLM(messages: AgentTurnMessage[], token: CancellationToken): Promise<string> {
		return callLlm(messages, token, this.llmMessageService, this.settingsService);
	}

	/**
	 * Reads the staging URL from workspace storage, launches `PlaywrightRunner` against
	 * it, converts each `PlaywrightFinding` into an `AgentProgressEvent` on
	 * `agentProgressFeed`, and returns the raw findings for merging into `AgentOutput`.
	 *
	 * If no staging URL is configured the method logs a skip notice and returns [].
	 * Playwright errors are surfaced as P1 findings rather than thrown so a broken
	 * Playwright setup can never crash the tester agent outright.
	 */
	private async runPlaywrightQA(agent: AgentInstance, context?: any): Promise<PlaywrightFinding[]> {
		// Resolve staging URL (in priority order):
		//  1. context override — supplied by orchestration (e.g. from mission metadata)
		//  2. VS Code workspace configuration — set via `ribix.configureSandbox` or user settings
		//  3. IStorageService workspace scope — programmatic fallback
		const stagingUrl: string =
			(context?.stagingUrl as string | undefined) ||
			(this.configurationService.getValue<string>('ribix.stagingUrl') ?? '') ||
			this.storageService.get(RIBIX_STAGING_URL_KEY, StorageScope.WORKSPACE, '');

		if (!stagingUrl) {
			this.addActivityLog(agent, 'Playwright skip', 'No staging URL configured — skipping Playwright QA. Set one via ribix.configureSandbox.', null, null);
			agentProgressFeed.emit({
				agentId: `${agent.missionId}:Tester`,
				agentRole: 'Tester',
				stage: 'testing',
				message: 'Playwright QA skipped: no staging URL configured.',
				timestamp: Date.now(),
			});
			return [];
		}

		this.addActivityLog(agent, 'Playwright start', `Running QA against ${stagingUrl}`, null, null);
		agentProgressFeed.emit({
			agentId: `${agent.missionId}:Tester`,
			agentRole: 'Tester',
			stage: 'testing',
			message: `Playwright: navigating ${stagingUrl}…`,
			timestamp: Date.now(),
		});

		const runner = new PlaywrightRunner(stagingUrl);
		const extraPages: string[] = Array.isArray(context?.playwrightPages) ? context.playwrightPages : [];

		let findings: PlaywrightFinding[];
		try {
			// Tester runs in aggressive FAFO mode (user-qa), not passive proactive
			// observation — see issue #102.
			findings = await runner.run({ timeoutMs: 90_000, pages: extraPages, mode: 'user-qa' });
		} catch (err) {
			// #91: Surface Playwright setup errors as agent failures instead of
			// silently converting them to findings. Distinguish setup errors
			// (browser not installed, launch failure) from runtime findings.
			const message = err instanceof Error ? err.message : String(err);
			const isSetupError = /browser|launch|executable|install/i.test(message);

			this.addActivityLog(agent, 'Playwright error', message, null, null);
			agentProgressFeed.emit({
				agentId: `${agent.missionId}:Tester`,
				agentRole: 'Tester',
				stage: 'error',
				message: isSetupError
					? `Playwright setup failed: ${message}. Install browsers with: npx playwright install chromium`
					: `Playwright runner failed: ${message}`,
				timestamp: Date.now(),
			});

			if (isSetupError) {
				// Propagate setup errors so the mission can record a proper failure
				// instead of masking a missing browser as a "p1 finding".
				throw new Error(`Playwright setup error: ${message}`);
			}

			return [{
				title: 'Playwright runner crashed',
				severity: 'p1',
				url: stagingUrl,
				errorMessage: message,
			}];
		}

		// Emit each finding as a progress event so the Command Center shows live updates.
		for (const finding of findings) {
			agentProgressFeed.emit({
				agentId: `${agent.missionId}:Tester`,
				agentRole: 'Tester',
				stage: 'testing',
				message: `[${finding.severity.toUpperCase()}] ${finding.title}`,
				timestamp: Date.now(),
				filesAffected: finding.screenshotPath ? [finding.screenshotPath] : undefined,
			});
			this.addActivityLog(
				agent,
				`Finding ${finding.severity.toUpperCase()}`,
				`${finding.title} — ${finding.errorMessage.slice(0, 200)}`,
				null,
				finding.screenshotPath ?? null,
			);
		}

		// Emit a completion summary.
		const p0Count = findings.filter(f => f.severity === 'p0').length;
		const summaryMsg = findings.length === 0
			? `Playwright QA complete — no anomalies found on ${stagingUrl}`
			: `Playwright QA complete — ${findings.length} finding(s) (${p0Count} P0) on ${stagingUrl}`;

		agentProgressFeed.emit({
			agentId: `${agent.missionId}:Tester`,
			agentRole: 'Tester',
			stage: findings.length === 0 ? 'complete' : 'testing',
			message: summaryMsg,
			timestamp: Date.now(),
		});

		this.addActivityLog(agent, 'Playwright complete', summaryMsg, null, null);
		return findings;
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
			this.pruneCompletedAgents();
		}
	}

	/**
	 * Evicts oldest completed/failed agents once the cap is exceeded.
	 * Active agents (idle/planning/executing/blocked) are never evicted.
	 */
	private pruneCompletedAgents(): void {
		const terminal = Array.from(this.agents.values())
			.filter(a => a.status === 'complete' || a.status === 'failed')
			.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));

		const excess = terminal.length - RibixAgentService.MAX_COMPLETED_AGENTS;
		if (excess <= 0) { return; }

		for (let i = 0; i < excess; i++) {
			this.agents.delete(terminal[i].id);
		}
	}

	/**
	 * #118: Per-turn timing log, gated behind the `ribix.agentLoop.debugTiming` config
	 * flag so it adds no overhead in normal operation. Reports LLM latency, tool latency,
	 * tool-call count, and the running token estimate so a slow/expensive run is diagnosable.
	 */
	private logTiming(agent: AgentInstance, turn: number, llmMs: number, toolMs: number, toolCount: number, estTokens: number): void {
		if (!this.timingDebugEnabled) { return; }
		this.logService.debug(`[ribix-agent-timing] ${agent.type}/${agent.id.slice(0, 8)} turn=${turn + 1} llm=${llmMs}ms tools=${toolMs}ms toolCalls=${toolCount} estTokens=${estTokens}`);
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
			this.pruneCompletedAgents();
		}
	}

	// ─── #149: Persist completed agent runs to disk ──────────────────────────

	/**
	 * #149: Resolves the storage directory URI for agent run JSON files.
	 * Lazily creates the directory on first access.
	 */
	private async getAgentRunsStorageDir(): Promise<URI> {
		if (this._agentRunsStorageUri) {
			return this._agentRunsStorageUri;
		}
		const baseUri = URI.joinPath(this.userDataProfilesService.defaultProfile.globalStorageHome, AGENT_RUNS_STORAGE_FOLDER);
		try {
			await this.fileService.createFolder(baseUri);
		} catch {
			// Directory may already exist — ignore.
		}
		this._agentRunsStorageUri = baseUri;
		return baseUri;
	}

	/**
	 * #149: Persists a completed/failed agent run as a JSON file in the workspace
	 * data directory. Only terminal-state agents are persisted. Also stores a
	 * lightweight index in workspace storage for quick startup loading.
	 */
	private async persistAgentRun(agent: AgentInstance): Promise<void> {
		if (agent.status !== 'complete' && agent.status !== 'failed') {
			return;
		}
		try {
			const dir = await this.getAgentRunsStorageDir();
			const fileUri = URI.joinPath(dir, `${agent.id}.json`);
			const serialized = JSON.stringify({
				id: agent.id,
				type: agent.type,
				missionId: agent.missionId,
				taskId: agent.taskId,
				status: agent.status,
				currentAction: agent.currentAction,
				startedAt: agent.startedAt,
				completedAt: agent.completedAt,
				filesRead: agent.filesRead,
				filesWritten: agent.filesWritten,
				output: agent.output,
			});
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(serialized));

			// Also update the in-memory persisted list (keep most-recent first).
			this._persistedAgentRuns = [agent, ...this._persistedAgentRuns.filter(a => a.id !== agent.id)]
				.slice(0, MAX_PERSISTED_AGENT_RUNS);

			// Prune old files if we exceed the cap.
			if (this._persistedAgentRuns.length > MAX_PERSISTED_AGENT_RUNS) {
				const toRemove = this._persistedAgentRuns.slice(MAX_PERSISTED_AGENT_RUNS);
				for (const old of toRemove) {
					try {
						await this.fileService.del(URI.joinPath(dir, `${old.id}.json`));
					} catch { /* file may already be gone */ }
				}
			}
		} catch (e) {
			this.logService.error('persistAgentRun: failed to write agent run to disk:', e);
		}
	}

	/**
	 * #149: Loads persisted agent run JSON files from disk on startup.
	 * Populates `_persistedAgentRuns` with the most recent terminal-state agents.
	 */
	private async loadPersistedAgentRuns(): Promise<void> {
		try {
			const dir = await this.getAgentRunsStorageDir();
			const dirStat = await this.fileService.resolve(dir);
			const loaded: AgentInstance[] = [];
			for (const { name } of dirStat.children ?? []) {
				if (!name.endsWith('.json')) { continue; }
				try {
					const content = await this.fileService.readFile(URI.joinPath(dir, name));
					const parsed = JSON.parse(content.value.toString()) as Partial<AgentInstance>;
					if (parsed && parsed.id && (parsed.status === 'complete' || parsed.status === 'failed')) {
						loaded.push({
							id: parsed.id,
							type: parsed.type ?? 'coder',
							missionId: parsed.missionId ?? '',
							taskId: parsed.taskId ?? '',
							status: parsed.status,
							currentAction: parsed.currentAction ?? '',
							activityLog: [],
							filesRead: parsed.filesRead ?? [],
							filesWritten: parsed.filesWritten ?? [],
							startedAt: parsed.startedAt ?? 0,
							completedAt: parsed.completedAt ?? null,
							output: parsed.output ?? null,
						});
					}
				} catch {
					// Malformed file — skip.
				}
			}
			// Sort by completedAt descending (most-recent first).
			loaded.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
			this._persistedAgentRuns = loaded.slice(0, MAX_PERSISTED_AGENT_RUNS);
			if (loaded.length > 0) {
				this.logService.info(`[ribix-agent] Loaded ${loaded.length} persisted agent run(s) from disk.`);
			}
		} catch (e) {
			// Directory may not exist yet — that's fine for a fresh install.
			this.logService.debug('loadPersistedAgentRuns: no persisted runs found (expected on first run):', e);
		}
	}

	// ─── #150: GDPR right-to-be-forgotten ────────────────────────────────────

	/**
	 * #150: GDPR deletion — clears ALL local agent run data:
	 *  - In-memory agents map
	 *  - Queued agent spawns
	 *  - Persisted JSON files on disk
	 *  - Workspace storage index
	 * Does NOT abort currently-running agents (call abortAgent first if needed).
	 */
	async deleteAllAgentRunData(): Promise<void> {
		// Clear the queue.
		this._agentQueue.length = 0;

		// Clear in-memory agents (only terminal-state ones; active ones need explicit abort).
		const toRemove = Array.from(this.agents.values()).filter(
			a => a.status === 'complete' || a.status === 'failed'
		);
		for (const a of toRemove) {
			this.agents.delete(a.id);
		}

		// Clear persisted in-memory list.
		this._persistedAgentRuns = [];

		// Delete JSON files from disk.
		try {
			const dir = await this.getAgentRunsStorageDir();
			const dirStat = await this.fileService.resolve(dir);
			for (const { name } of dirStat.children ?? []) {
				if (name.endsWith('.json')) {
					try {
						await this.fileService.del(URI.joinPath(dir, name));
					} catch { /* best-effort */ }
				}
			}
		} catch {
			// Directory may not exist — nothing to delete.
		}

		// Clear workspace storage index.
		this.storageService.remove(RIBIX_AGENT_RUNS_STORAGE_KEY, StorageScope.WORKSPACE);

		this._onDidChangeAgents.fire();
		this.logService.info('[ribix-agent] All local agent run data deleted (GDPR right-to-be-forgotten).');
	}
}

registerSingleton(IRibixAgentService, RibixAgentService, InstantiationType.Delayed);