/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IModelDecorationOptions, IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CodeLens, CodeLensList, CodeLensProvider } from '../../../../editor/common/languages.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWebviewWorkbenchService } from '../../../contrib/webviewPanel/browser/webviewWorkbenchService.js';
import { ACTIVE_GROUP_TYPE } from '../../../services/editor/common/editorService.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { IRibixCheckpointService, MissionCheckpoint } from './ribixCheckpointService.js';
import { AgentInstance, AgentActivityEntry } from '../common/ribixTypes.js';

// Type for tracking agent-written code blocks
export type AgentWrittenBlock = {
	agentId: string;
	agentType: string;
	filePath: string;
	range: IRange;
	timestamp: number;
	checkpointId: string;
	activityLogEntries: AgentActivityEntry[];
};

// Interface for the diff annotation service
export interface IRibixDiffAnnotationWidget {
	readonly _serviceBrand: undefined;

	// Track agent-written blocks
	trackAgentWrite(block: AgentWrittenBlock): void;

	// Clear annotations for a file
	clearAnnotations(filePath: string): void;

	// Events
	onDidChangeAnnotations: Event<void>;
}

export const IRibixDiffAnnotationWidget = createDecorator<IRibixDiffAnnotationWidget>('ribixDiffAnnotationWidget');

// Command IDs
const VIEW_REASONING_COMMAND = 'ribix.viewReasoning';
const REJECT_BLOCK_COMMAND = 'ribix.rejectBlock';

class RibixDiffAnnotationWidget extends Disposable implements IRibixDiffAnnotationWidget, CodeLensProvider {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeAnnotations = new Emitter<void>();
	readonly onDidChangeAnnotations = this._onDidChangeAnnotations.event;

	private readonly _onDidChangeCodeLenses = new Emitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	// Track agent-written blocks by file path
	private readonly agentBlocksByFile = new Map<string, AgentWrittenBlock[]>();

	// Decoration type for agent-written blocks (subtle Ribix gold left border)
	private readonly agentBlockDecorationType: IModelDecorationOptions;

	constructor(
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ICommandService private readonly commandService: ICommandService,
		@IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
		@IRibixAgentService private readonly agentService: IRibixAgentService,
		@IRibixCheckpointService private readonly checkpointService: IRibixCheckpointService,
	) {
		super();

		// Register decoration type for agent-written blocks
		this.agentBlockDecorationType = {
			className: 'ribix-agent-written-block',
			description: 'Ribix agent-written code block',
			isWholeLine: true,
			overviewRuler: {
				color: '#C6AA58', // Ribix gold
				position: 4, // Left side
			},
			marginClassName: 'ribix-agent-block-margin',
		};

		// Register code lens provider
		this._register(this.languageFeaturesService.codeLensProvider.register(
			{ pattern: '**/*' },
			this
		));

		// Subscribe to agent service for file writes
		this._register(this.agentService.onDidChangeAgents(() => this.handleAgentChanges()));

		// Register commands
		this._register(this.commandService.registerCommand(VIEW_REASONING_COMMAND, (block: AgentWrittenBlock) => {
			this.showReasoningPanel(block);
		}));

		this._register(this.commandService.registerCommand(REJECT_BLOCK_COMMAND, (block: AgentWrittenBlock) => {
			this.rejectBlock(block);
		}));

		// Listen to model changes to update decorations
		this._register(this.modelService.onModelAdded(model => this.updateDecorations(model)));
		this._register(this.modelService.onModelRemoved(model => this.clearModelDecorations(model)));
	}

	trackAgentWrite(block: AgentWrittenBlock): void {
		const filePath = block.filePath;
		if (!this.agentBlocksByFile.has(filePath)) {
			this.agentBlocksByFile.set(filePath, []);
		}
		this.agentBlocksByFile.get(filePath)!.push(block);
		this._onDidChangeAnnotations.fire();
		this._onDidChangeCodeLenses.fire();

		// Update decorations for the affected file
		const uri = URI.file(filePath);
		const model = this.modelService.getModel(uri);
		if (model) {
			this.updateDecorations(model);
		}
	}

	clearAnnotations(filePath: string): void {
		this.agentBlocksByFile.delete(filePath);
		this._onDidChangeAnnotations.fire();
		this._onDidChangeCodeLenses.fire();

		const uri = URI.file(filePath);
		const model = this.modelService.getModel(uri);
		if (model) {
			this.clearModelDecorations(model);
		}
	}

	provideCodeLenses(model: ITextModel): CodeLensList | undefined {
		const filePath = model.uri.fsPath;
		const blocks = this.agentBlocksByFile.get(filePath);
		if (!blocks || blocks.length === 0) {
			return undefined;
		}

		const lenses: CodeLens[] = [];
		for (const block of blocks) {
			const range = block.range;

			// Get agent info
			const agent = this.agentService.getAgent(block.agentId);
			const agentName = agent ? `${block.agentType}-${block.agentId.slice(0, 8)}` : `${block.agentType}-${block.agentId.slice(0, 8)}`;
			const timestamp = new Date(block.timestamp).toLocaleTimeString();

			// Add code lens with agent info and actions
			lenses.push({
				range: range,
				command: {
					id: VIEW_REASONING_COMMAND,
					title: localize('ribix.agentAttribution', 'Written by {0} at {1}', agentName, timestamp),
					arguments: [block],
				},
			});

			// Add "View reasoning" link
			lenses.push({
				range: range,
				command: {
					id: VIEW_REASONING_COMMAND,
					title: localize('ribix.viewReasoning', '[View reasoning]'),
					arguments: [block],
				},
			});

			// Add "Reject this block" link
			lenses.push({
				range: range,
				command: {
					id: REJECT_BLOCK_COMMAND,
					title: localize('ribix.rejectBlock', '[Reject this block]'),
					arguments: [block],
				},
			});
		}

		return {
			lenses,
			dispose: () => {},
		};
	}

	private updateDecorations(model: ITextModel): void {
		const filePath = model.uri.fsPath;
		const blocks = this.agentBlocksByFile.get(filePath);
		if (!blocks || blocks.length === 0) {
			return;
		}

		const decorations: IModelDeltaDecoration[] = [];
		for (const block of blocks) {
			decorations.push({
				range: block.range,
				options: this.agentBlockDecorationType,
			});
		}

		model.deltaDecorations([], decorations);
	}

	private clearModelDecorations(model: ITextModel): void {
		model.deltaDecorations([], []);
	}

	private handleAgentChanges(): void {
		// Check for new file writes from agents
		const agents = this.agentService.getAllActiveAgents();
		for (const agent of agents) {
			// Track files written by this agent
			for (const filePath of agent.filesWritten) {
				// Check if we already have a block for this file from this agent
				const existingBlocks = this.agentBlocksByFile.get(filePath) || [];
				const hasBlockFromAgent = existingBlocks.some(b => b.agentId === agent.id);

				if (!hasBlockFromAgent) {
					// Get the checkpoint for this file write
					const checkpoints = this.checkpointService.getCheckpoints(undefined, agent.id, filePath);
					if (checkpoints.length > 0) {
						const checkpoint = checkpoints[0];

						// For now, we'll track the entire file as one block
						// In a more sophisticated implementation, we could track specific ranges
						const model = this.modelService.getModel(URI.file(filePath));
						if (model) {
							const lineCount = model.getLineCount();
							const block: AgentWrittenBlock = {
								agentId: agent.id,
								agentType: agent.type,
								filePath,
								range: new Range(1, 1, lineCount, 1),
								timestamp: checkpoint.timestamp,
								checkpointId: checkpoint.id,
								activityLogEntries: agent.activityLog,
							};

							this.trackAgentWrite(block);
						}
					}
				}
			}
		}
	}

	private showReasoningPanel(block: AgentWrittenBlock): void {
		// Create a webview panel to show the agent's reasoning
		const webview = this.webviewWorkbenchService.openWebview(
			{
				title: localize('ribix.reasoningTitle', 'Agent Reasoning - {0}', block.agentType),
				options: {
					enableFindWidget: true,
					retainContextWhenHidden: true,
				},
				contentOptions: {
					allowScripts: true,
				},
			},
			'ribix.reasoning',
			localize('ribix.reasoningTitle', 'Agent Reasoning - {0}', block.agentType),
			{ group: ACTIVE_GROUP_TYPE }
		);

		// Build HTML content for the reasoning panel
		const html = this.buildReasoningHtml(block);
		webview.webview.html = html;
	}

	private buildReasoningHtml(block: AgentWrittenBlock): string {
		const agent = this.agentService.getAgent(block.agentId);
		const agentName = agent ? `${block.agentType}-${block.agentId.slice(0, 8)}` : `${block.agentType}-${block.agentId.slice(0, 8)}`;
		const timestamp = new Date(block.timestamp).toLocaleString();

		let activityLogHtml = '';
		for (const entry of block.activityLogEntries) {
			const entryTime = new Date(entry.timestamp).toLocaleTimeString();
			activityLogHtml += `
				<div class="activity-entry">
					<div class="activity-time">${entryTime}</div>
					<div class="activity-action">${entry.action}</div>
					${entry.detail ? `<div class="activity-detail">${entry.detail}</div>` : ''}
					${entry.tool ? `<div class="activity-tool">Tool: ${entry.tool}</div>` : ''}
					${entry.filePath ? `<div class="activity-file">File: ${entry.filePath}</div>` : ''}
				</div>
			`;
		}

		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<style>
					body {
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
						padding: 20px;
						color: #F5F0E8;
						background-color: #01311F;
					}
					h1 {
						color: #C6AA58;
						margin-bottom: 10px;
					}
					.agent-info {
						margin-bottom: 20px;
						padding: 10px;
						background-color: #1E4A32;
						border-radius: 4px;
					}
					.activity-log {
						margin-top: 20px;
					}
					.activity-entry {
						padding: 10px;
						margin-bottom: 10px;
						background-color: #0d2618;
						border-left: 3px solid #C6AA58;
						border-radius: 4px;
					}
					.activity-time {
						color: #8A9E8A;
						font-size: 12px;
						margin-bottom: 4px;
					}
					.activity-action {
						font-weight: bold;
						margin-bottom: 4px;
					}
					.activity-detail {
						margin-bottom: 4px;
					}
					.activity-tool {
						color: #C6AA58;
						font-size: 12px;
					}
					.activity-file {
						color: #8A9E8A;
						font-size: 12px;
					}
				</style>
			</head>
			<body>
				<h1>Agent Reasoning</h1>
				<div class="agent-info">
					<div><strong>Agent:</strong> ${agentName}</div>
					<div><strong>Type:</strong> ${block.agentType}</div>
					<div><strong>Timestamp:</strong> ${timestamp}</div>
					<div><strong>File:</strong> ${block.filePath}</div>
				</div>
				<div class="activity-log">
					<h2>Activity Log</h2>
					${activityLogHtml || '<div>No activity log entries</div>'}
				</div>
			</body>
			</html>
		`;
	}

	private async rejectBlock(block: AgentWrittenBlock): Promise<void> {
		try {
			// Rollback the file to the checkpoint state
			await this.checkpointService.rollbackFile(block.checkpointId);

			// Clear the annotations for this file
			this.clearAnnotations(block.filePath);
		} catch (error) {
			console.error('Failed to reject block:', error);
			throw error;
		}
	}
}

registerSingleton(IRibixDiffAnnotationWidget, RibixDiffAnnotationWidget, InstantiationType.Delayed);