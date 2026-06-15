/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixFileActionContribution.ts
 *
 * Right-click → "Run Ribix on this file": runs Ribix detection on a single file without
 * spinning up a full mission. Registers the `ribix.runOnFile` command and surfaces it in
 * the editor context menu. On trigger it spawns a scoped Reviewer agent against the active
 * file, filters the resulting findings through `.ribixignore`, and renders them inline as
 * Problems-panel markers (plus a summary toast).
 */

import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import Severity from '../../../../base/common/severity.js';
import { localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IMarkerService, IMarkerData, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { AgentFinding, RiskLevel } from '../common/ribixTypes.js';
import { loadSuppressionRules, filterSuppressed, EMPTY_SUPPRESSION_RULES, SuppressionRules } from '../common/ribixSuppression.js';

export const RUN_ON_FILE_COMMAND_ID = 'ribix.runOnFile';

/** Marker owner so we can clear/replace prior Ribix markers on the same file. */
const RIBIX_MARKER_OWNER = 'ribix';

/** Map a Ribix RiskLevel to a Problems-panel marker severity. */
function markerSeverityForRisk(severity: RiskLevel): MarkerSeverity {
	switch (severity) {
		case 'high': return MarkerSeverity.Error;
		case 'medium': return MarkerSeverity.Warning;
		case 'low': return MarkerSeverity.Info;
		default: return MarkerSeverity.Info;
	}
}

/** Convert an AgentFinding into an editor marker. Findings without a line anchor to line 1. */
function findingToMarker(finding: AgentFinding): IMarkerData {
	const line = finding.line && finding.line > 0 ? finding.line : 1;
	return {
		severity: markerSeverityForRisk(finding.severity),
		message: finding.findingType ? `[${finding.findingType}] ${finding.message}` : finding.message,
		source: 'Ribix',
		startLineNumber: line,
		startColumn: 1,
		endLineNumber: line,
		endColumn: 1,
	};
}

/**
 * Loads `.ribixignore` for the workspace folder containing `fileUri`. Best-effort: returns
 * an empty rule set when there is no workspace or no ignore file.
 */
async function loadRulesForFile(
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService,
	fileUri: URI,
): Promise<SuppressionRules> {
	try {
		const folder = workspaceContextService.getWorkspaceFolder(fileUri);
		const root = folder?.uri ?? workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!root) { return EMPTY_SUPPRESSION_RULES; }
		return await loadSuppressionRules(fileService, root);
	} catch {
		return EMPTY_SUPPRESSION_RULES;
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RUN_ON_FILE_COMMAND_ID,
			f1: true,
			title: localize2('ribixRunOnFile', 'Run Ribix on this file'),
		});
	}

	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const agentService = accessor.get(IRibixAgentService);
		const missionService = accessor.get(IRibixMissionService);
		const markerService = accessor.get(IMarkerService);
		const fileService = accessor.get(IFileService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);

		// Resolve the target file: the menu passes the resource; fall back to the active editor.
		const fileUri = resourceArg ?? EditorResourceAccessor.getCanonicalUri(editorService.activeEditor);
		if (!fileUri) {
			notificationService.notify({ severity: Severity.Warning, message: 'Ribix: no active file to analyze.' });
			return;
		}

		const fsPath = fileUri.fsPath;
		const fileLabel = fsPath.split(/[\\/]/).pop() ?? fsPath;

		// Create a lightweight scoped mission so the run is traceable in the Command Center,
		// then run a single Reviewer agent against just this file. Mission creation can throw
		// at the concurrency cap — fall back to an ad-hoc id so the single-file run still works.
		let missionId: string;
		try {
			const mission = await missionService.createMission(
				`Run Ribix on ${fileLabel}`,
				{ attachedFiles: [fsPath], attachedSelections: [], issueUrls: [], notes: `Single-file detection on ${fsPath}` },
			);
			missionId = mission.id;
		} catch {
			missionId = `adhoc-file-${Date.now()}`;
		}

		notificationService.notify({ severity: Severity.Info, message: `Ribix: analyzing ${fileLabel}…` });

		const taskDescription =
			`Review ONLY the file ${fsPath}. Read it, then report concrete findings (bugs, ai-smell, ` +
			`day-2 failures, observability gaps, and the other detection categories) as a fenced JSON ` +
			`array of {severity, file, line, message, findingType}. Do not modify any file.`;

		let agentId: string;
		try {
			agentId = await agentService.spawnAgent(
				missionId,
				`task-file-${Date.now()}`,
				'reviewer',
				taskDescription,
				{ attachedContext: `Scoped single-file run on ${fsPath}` },
			);
		} catch (e) {
			notificationService.notify({ severity: Severity.Error, message: `Ribix: failed to start analysis: ${e instanceof Error ? e.message : String(e)}` });
			return;
		}

		// Wait for THIS agent to finish.
		const result = await new Promise<{ agentId: string; status: 'complete' | 'failed' }>(resolve => {
			const listener = agentService.onDidCompleteAgent(e => {
				if (e.agentId !== agentId) { return; }
				listener.dispose();
				resolve(e);
			});
		});

		if (result.status === 'failed') {
			notificationService.notify({ severity: Severity.Error, message: `Ribix: analysis of ${fileLabel} failed.` });
			return;
		}

		const agent = agentService.getAgent(agentId);
		const rawFindings = agent?.output?.findings ?? [];

		// Anchor findings without a file to the analyzed file so markers land on it.
		const scopedFindings: AgentFinding[] = rawFindings.map(f => ({ ...f, file: f.file || fsPath }));

		// Respect .ribixignore for the immediate IDE display.
		const rules = await loadRulesForFile(fileService, workspaceContextService, fileUri);
		const visibleFindings = filterSuppressed(scopedFindings, rules);

		// Render inline as Problems-panel markers (replaces any prior Ribix markers on this file).
		markerService.remove(RIBIX_MARKER_OWNER, [fileUri]);
		if (visibleFindings.length > 0) {
			markerService.changeOne(RIBIX_MARKER_OWNER, fileUri, visibleFindings.map(findingToMarker));
		}

		const suppressedCount = scopedFindings.length - visibleFindings.length;
		const suffix = suppressedCount > 0 ? ` (${suppressedCount} suppressed by .ribixignore)` : '';
		if (visibleFindings.length === 0) {
			notificationService.notify({ severity: Severity.Info, message: `Ribix: no findings in ${fileLabel}${suffix}.` });
		} else {
			notificationService.notify({
				severity: Severity.Info,
				message: `Ribix: ${visibleFindings.length} finding(s) in ${fileLabel}${suffix}. See the Problems panel.`,
			});
		}
	}
});

// Surface in the editor right-click context menu under the navigation group.
MenuRegistry.appendMenuItem(MenuId.EditorContext, {
	command: {
		id: RUN_ON_FILE_COMMAND_ID,
		title: localize2('ribixRunOnFileMenu', 'Run Ribix on this file'),
	},
	group: 'navigation',
	order: 1.5,
});

// Also surface in the Explorer right-click menu so it works without opening the file.
MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	command: {
		id: RUN_ON_FILE_COMMAND_ID,
		title: localize2('ribixRunOnFileExplorer', 'Run Ribix on this file'),
	},
	group: 'navigation',
	order: 20,
});
