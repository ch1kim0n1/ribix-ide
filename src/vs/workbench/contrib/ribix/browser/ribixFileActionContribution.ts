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
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IRibixAgentService } from './ribixAgentService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { renderFindingsAsMarkers } from './ribixMarkerRendering.js';

export const RUN_ON_FILE_COMMAND_ID = 'ribix.runOnFile';

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

		// Render inline as Problems-panel markers, filtered through .ribixignore.
		const { visible, suppressed } = await renderFindingsAsMarkers(
			markerService, fileService, workspaceContextService, rawFindings, fsPath,
		);

		const suffix = suppressed > 0 ? ` (${suppressed} suppressed by .ribixignore)` : '';
		if (visible === 0) {
			notificationService.notify({ severity: Severity.Info, message: `Ribix: no findings in ${fileLabel}${suffix}.` });
		} else {
			notificationService.notify({
				severity: Severity.Info,
				message: `Ribix: ${visible} finding(s) in ${fileLabel}${suffix}. See the Problems panel.`,
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
