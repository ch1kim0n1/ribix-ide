/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * editCodeZoneManager.ts
 *
 * CtrlK zone lifecycle helpers extracted from EditCodeService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { URI } from '../../../../base/common/uri.js';
import { AddCtrlKOpts } from './editCodeServiceInterface.js';
import { CtrlKZone, DiffArea } from '../common/editCodeServiceTypes.js';

/** Minimal context the zone-manager functions need from EditCodeService. */
export interface ZoneManagerContext {
	diffAreaOfId: Record<string, DiffArea>;
	diffAreasOfURI: Record<string, Set<string> | undefined>;
	findOverlappingDiffArea(opts: { startLine: number; endLine: number; uri: URI; filter?: (diffArea: DiffArea) => boolean }): DiffArea | null;
	addToHistory(uri: URI, opts?: { onWillUndo?: () => void }): { onFinishEdit: () => void };
	addDiffArea<T extends DiffArea>(diffArea: Omit<T, 'diffareaid'>): T;
	deleteCtrlKZone(ctrlKZone: CtrlKZone): void;
	refreshStylesAndDiffsInURI(uri: URI): void;
}

/**
 * Adds a new CtrlK input zone to the editor, or focuses an existing overlapping zone.
 * Returns the new zone's diffareaid, or undefined if creation was skipped.
 */
export function addCtrlKZone(
	{ startLine, endLine, editor }: AddCtrlKOpts,
	ctx: ZoneManagerContext,
): number | undefined {
	const uri = editor.getModel()?.uri;
	if (!uri) return;

	// If there's overlap with any other ctrlKZone, focus it instead of creating a new one.
	const overlappingCtrlKZone = ctx.findOverlappingDiffArea({
		startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'CtrlKZone',
	});
	if (overlappingCtrlKZone) {
		editor.revealLine(overlappingCtrlKZone.startLine);
		setTimeout(() => (overlappingCtrlKZone as CtrlKZone)._mountInfo?.textAreaRef.current?.focus(), 100);
		return;
	}

	const overlappingDiffZone = ctx.findOverlappingDiffArea({
		startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'DiffZone',
	});
	if (overlappingDiffZone) return;

	editor.revealLine(startLine);
	editor.setSelection({ startLineNumber: startLine, endLineNumber: startLine, startColumn: 1, endColumn: 1 });

	const { onFinishEdit } = ctx.addToHistory(uri);

	const adding: Omit<CtrlKZone, 'diffareaid'> = {
		type: 'CtrlKZone',
		startLine,
		endLine,
		editorId: editor.getId(),
		_URI: uri,
		_removeStylesFns: new Set(),
		_mountInfo: null,
		_linkedStreamingDiffZone: null,
	};
	const ctrlKZone = ctx.addDiffArea(adding);
	ctx.refreshStylesAndDiffsInURI(uri);
	onFinishEdit();

	return ctrlKZone.diffareaid;
}

/**
 * Removes (deletes) a CtrlK zone and adds the operation to undo history.
 */
export function removeCtrlKZone(
	{ diffareaid }: { diffareaid: number },
	ctx: ZoneManagerContext,
): void {
	const ctrlKZone = ctx.diffAreaOfId[diffareaid];
	if (!ctrlKZone) return;
	if (ctrlKZone.type !== 'CtrlKZone') return;

	const uri = ctrlKZone._URI;
	const { onFinishEdit } = ctx.addToHistory(uri);
	ctx.deleteCtrlKZone(ctrlKZone);
	ctx.refreshStylesAndDiffsInURI(uri);
	onFinishEdit();
}
