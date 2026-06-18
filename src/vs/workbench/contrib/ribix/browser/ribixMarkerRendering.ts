/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixMarkerRendering.ts
 *
 * Shared helpers for rendering Ribix AgentFindings as VS Code Problems-panel
 * markers. Extracted so both the manual "Run Ribix on this file" action and
 * the auto-on-save trigger (G-AUTOTRIGGER) surface findings through the same
 * path, with identical severity mapping and `.ribixignore` suppression.
 */

import { URI } from '../../../../base/common/uri.js';
import { IMarkerService, IMarkerData, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { AgentFinding, RiskLevel } from '../common/ribixTypes.js';
import { loadSuppressionRules, filterSuppressed, EMPTY_SUPPRESSION_RULES, SuppressionRules } from '../common/ribixSuppression.js';

/** Marker owner so we can clear/replace prior Ribix markers on the same file. */
export const RIBIX_MARKER_OWNER = 'ribix';

/** Map a Ribix RiskLevel to a Problems-panel marker severity. */
export function markerSeverityForRisk(severity: RiskLevel): MarkerSeverity {
	switch (severity) {
		case 'high': return MarkerSeverity.Error;
		case 'medium': return MarkerSeverity.Warning;
		case 'low': return MarkerSeverity.Info;
		default: return MarkerSeverity.Info;
	}
}

/** Convert an AgentFinding into an editor marker. Findings without a line anchor to line 1. */
export function findingToMarker(finding: AgentFinding): IMarkerData {
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
export async function loadRulesForFile(
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

/**
 * Render a set of findings as Problems-panel markers, grouped per file.
 *
 * - Anchors findings whose `file` is empty to `fallbackFile` (used by single-file runs).
 * - Filters through `.ribixignore` so suppressed findings never reach the panel.
 * - Replaces any prior Ribix markers on each touched file (no stale squiggles).
 *
 * Returns the per-file counts so callers can build an accurate summary toast.
 */
export async function renderFindingsAsMarkers(
	markerService: IMarkerService,
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService,
	findings: AgentFinding[],
	fallbackFile?: string,
): Promise<{ visible: number; suppressed: number; perFile: Map<string, number> }> {
	const perFile = new Map<string, AgentFinding[]>();
	for (const f of findings) {
		const file = f.file || fallbackFile;
		if (!file) { continue; }
		const list = perFile.get(file) ?? [];
		list.push({ ...f, file });
		perFile.set(file, list);
	}

	let visible = 0;
	let suppressed = 0;
	for (const [file, list] of perFile) {
		const fileUri = URI.file(file);
		const rules = await loadRulesForFile(fileService, workspaceContextService, fileUri);
		const visibleFindings = filterSuppressed(list, rules);
		suppressed += list.length - visibleFindings.length;
		markerService.remove(RIBIX_MARKER_OWNER, [fileUri]);
		if (visibleFindings.length > 0) {
			markerService.changeOne(RIBIX_MARKER_OWNER, fileUri, visibleFindings.map(findingToMarker));
			visible += visibleFindings.length;
		}
	}

	return { visible, suppressed, perFile: new Map([...perFile.entries()].map(([f, l]) => [f, l.length])) };
}
