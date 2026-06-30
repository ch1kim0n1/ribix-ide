/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelDecorationOptions, IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CodeLens, CodeLensList, CodeLensProvider } from '../../../../editor/common/languages.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IWebviewWorkbenchService } from '../../../contrib/webviewPanel/browser/webviewWorkbenchService.js';
import { ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { IRibixCheckpointService } from './ribixCheckpointService.js';
import { AgentActivityEntry } from '../common/ribixTypes.js';

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

/**
 * A visual / UX-vision note produced by the QA browser agent for a UI-touching change (#116).
 * Carries a textual critique plus an optional rendered-region screenshot. When the browser
 * tool was unavailable, `screenshotPath` is absent and the note degrades to text-only.
 */
export type UxVisionNote = {
	missionId: string;
	filePath: string;
	line: number | null;       // anchor line in the source file (null → top of file)
	severity: 'low' | 'medium' | 'high';
	message: string;           // critique
	suggestion?: string;       // annotated suggestion
	screenshotPath?: string;   // rendered-region screenshot; absent → text-only
};

// Interface for the diff annotation service
export interface IRibixDiffAnnotationWidget {
	readonly _serviceBrand: undefined;

	// Track agent-written blocks
	trackAgentWrite(block: AgentWrittenBlock): void;

	// Clear annotations for a file
	clearAnnotations(filePath: string): void;

	// UX-vision notes (#116) — surfaced as diff annotations and in mission detail.
	addUxVisionNotes(notes: UxVisionNote[]): void;
	getUxVisionNotes(missionId?: string): UxVisionNote[];
	clearUxVisionNotes(missionId: string): void;

	// Events
	onDidChangeAnnotations: Event<void>;
}

export const IRibixDiffAnnotationWidget = createDecorator<IRibixDiffAnnotationWidget>('ribixDiffAnnotationWidget');

// Command IDs
const VIEW_REASONING_COMMAND = 'ribix.viewReasoning';
const REJECT_BLOCK_COMMAND = 'ribix.rejectBlock';
const VIEW_UX_VISION_COMMAND = 'ribix.viewUxVision';

export class RibixDiffAnnotationWidget extends Disposable implements IRibixDiffAnnotationWidget, CodeLensProvider {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeAnnotations = new Emitter<void>();
	readonly onDidChangeAnnotations = this._onDidChangeAnnotations.event;

	private readonly _onDidChangeCodeLenses = new Emitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	// Track agent-written blocks by file path
	private readonly agentBlocksByFile = new Map<string, AgentWrittenBlock[]>();

	// UX-vision notes (#116), keyed by file path so they render as code lenses on the diff.
	private readonly uxVisionByFile = new Map<string, UxVisionNote[]>();

	// Decoration type for agent-written blocks (subtle Ribix gold left border)
	private readonly agentBlockDecorationType: IModelDecorationOptions;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
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
		this._register(CommandsRegistry.registerCommand(VIEW_REASONING_COMMAND, (_accessor, block: AgentWrittenBlock) => {
			this.showReasoningPanel(block);
		}));

		this._register(CommandsRegistry.registerCommand(REJECT_BLOCK_COMMAND, (_accessor, block: AgentWrittenBlock) => {
			this.rejectBlock(block);
		}));

		this._register(CommandsRegistry.registerCommand(VIEW_UX_VISION_COMMAND, (_accessor, note: UxVisionNote) => {
			this.showUxVisionPanel(note);
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

	addUxVisionNotes(notes: UxVisionNote[]): void {
		for (const note of notes) {
			const list = this.uxVisionByFile.get(note.filePath) ?? [];
			list.push(note);
			this.uxVisionByFile.set(note.filePath, list);
		}
		this._onDidChangeAnnotations.fire();
		this._onDidChangeCodeLenses.fire();
	}

	getUxVisionNotes(missionId?: string): UxVisionNote[] {
		const all: UxVisionNote[] = [];
		for (const list of this.uxVisionByFile.values()) {
			for (const note of list) {
				if (!missionId || note.missionId === missionId) {
					all.push(note);
				}
			}
		}
		return all;
	}

	clearUxVisionNotes(missionId: string): void {
		for (const [filePath, list] of this.uxVisionByFile) {
			const kept = list.filter(n => n.missionId !== missionId);
			if (kept.length === 0) {
				this.uxVisionByFile.delete(filePath);
			} else {
				this.uxVisionByFile.set(filePath, kept);
			}
		}
		this._onDidChangeAnnotations.fire();
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(model: ITextModel): CodeLensList | undefined {
		const filePath = model.uri.fsPath;
		const blocks = this.agentBlocksByFile.get(filePath);
		const uxNotes = this.uxVisionByFile.get(filePath);
		if ((!blocks || blocks.length === 0) && (!uxNotes || uxNotes.length === 0)) {
			return undefined;
		}

		const lenses: CodeLens[] = [];

		// UX-vision lenses (#116) — one per note, anchored to its line (or top of file).
		for (const note of uxNotes ?? []) {
			const line = note.line && note.line > 0 ? note.line : 1;
			const noteRange = new Range(line, 1, line, 1);
			const icon = note.screenshotPath ? '🖼' : '✎';
			lenses.push({
				range: noteRange,
				command: {
					id: VIEW_UX_VISION_COMMAND,
					title: localize('ribix.uxVision', '{0} UX-vision ({1}): {2}', icon, note.severity, note.message),
					arguments: [note],
				},
			});
		}

		for (const block of blocks ?? []) {
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
		const agents = this.agentService.getAllKnownAgents();
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
		const title = localize('ribix.reasoningTitle', 'Agent Reasoning - {0}', block.agentType);
		const webviewInput = this.webviewWorkbenchService.openWebview(
			{
				title,
				options: { enableFindWidget: true },
				contentOptions: { allowScripts: true },
				extension: undefined,
			},
			'ribix.reasoning',
			title,
			{ group: ACTIVE_GROUP }
		);

		const html = this.buildReasoningHtml(block);
		webviewInput.webview.setHtml(html);
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

	private showUxVisionPanel(note: UxVisionNote): void {
		const title = localize('ribix.uxVisionTitle', 'UX Vision - {0}', note.severity);
		const webviewInput = this.webviewWorkbenchService.openWebview(
			{
				title,
				options: { enableFindWidget: true },
				contentOptions: { allowScripts: false },
				extension: undefined,
			},
			'ribix.uxVision',
			title,
			{ group: ACTIVE_GROUP }
		);
		webviewInput.webview.setHtml(this.buildUxVisionHtml(note));
	}

	/**
	 * Builds the UX-vision detail HTML. Embeds the rendered-region screenshot when one is
	 * available; otherwise degrades gracefully to a text-only critique (#116).
	 */
	private buildUxVisionHtml(note: UxVisionNote): string {
		const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const screenshotHtml = note.screenshotPath
			? `<img class="shot" src="${URI.file(note.screenshotPath).toString()}" alt="Rendered region screenshot" />`
			: `<div class="text-only">Screenshot unavailable — browser tool did not capture this region. Showing text-only critique.</div>`;
		const suggestionHtml = note.suggestion
			? `<div class="suggestion"><strong>Suggestion:</strong> ${escape(note.suggestion)}</div>`
			: '';
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #F5F0E8; background-color: #01311F; }
					h1 { color: #C6AA58; margin-bottom: 10px; }
					.meta { color: #8A9E8A; font-size: 12px; margin-bottom: 16px; }
					.critique { padding: 12px; background-color: #0d2618; border-left: 3px solid #C6AA58; border-radius: 4px; margin-bottom: 16px; }
					.suggestion { padding: 12px; background-color: #1E4A32; border-radius: 4px; margin-bottom: 16px; }
					.shot { max-width: 100%; border: 1px solid #C6AA58; border-radius: 4px; }
					.text-only { color: #8A9E8A; font-style: italic; }
				</style>
			</head>
			<body>
				<h1>UX Vision</h1>
				<div class="meta">Severity: ${escape(note.severity)} &middot; File: ${escape(note.filePath)}${note.line ? `:${note.line}` : ''}</div>
				<div class="critique">${escape(note.message)}</div>
				${suggestionHtml}
				${screenshotHtml}
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