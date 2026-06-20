/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * editCodeDiffManager.ts
 *
 * Diff accept/reject helpers extracted from EditCodeService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { Diff, DiffArea, DiffZone, CtrlKZone } from '../common/editCodeServiceTypes.js';

/** Minimal context the diff-manager functions need from EditCodeService. */
export interface DiffManagerContext {
	diffOfId: Record<string, Diff>;
	diffAreaOfId: Record<string, DiffArea>;
	diffAreasOfURI: Record<string, Set<string> | undefined>;
	addToHistory(uri: URI, opts?: { onWillUndo?: () => void }): { onFinishEdit: () => void };
	deleteDiff(diff: Diff): void;
	deleteDiffZone(diffZone: DiffZone): void;
	deleteCtrlKZone(ctrlKZone: CtrlKZone): void;
	revertDiffZone(diffZone: DiffZone): void;
	refreshStylesAndDiffsInURI(uri: URI): void;
	writeURIText(uri: URI, text: string, range: IRange | 'wholeFileRange', opts: { shouldRealignDiffAreas: boolean }): void;
}

/**
 * Accept a single diff: updates originalCode to treat the new code as accepted,
 * removes the diff entry, and removes the parent DiffZone when empty.
 */
export async function acceptDiff(
	{ diffid }: { diffid: number },
	ctx: DiffManagerContext,
): Promise<void> {
	const diff = ctx.diffOfId[diffid];
	if (!diff) return;

	const { diffareaid } = diff;
	const diffArea = ctx.diffAreaOfId[diffareaid];
	if (!diffArea) return;
	if (diffArea.type !== 'DiffZone') return;

	const uri = diffArea._URI;
	const { onFinishEdit } = ctx.addToHistory(uri);

	const originalLines = diffArea.originalCode.split('\n');
	let newOriginalCode: string;

	if (diff.type === 'deletion') {
		newOriginalCode = [
			...originalLines.slice(0, (diff.originalStartLine - 1)),
			...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity),
		].join('\n');
	} else if (diff.type === 'insertion') {
		newOriginalCode = [
			...originalLines.slice(0, (diff.originalStartLine - 1)),
			diff.code,
			...originalLines.slice((diff.originalStartLine - 1), Infinity),
		].join('\n');
	} else if (diff.type === 'edit') {
		newOriginalCode = [
			...originalLines.slice(0, (diff.originalStartLine - 1)),
			diff.code,
			...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity),
		].join('\n');
	} else {
		throw new Error(`Ribix error: ${diff}.type not recognized`);
	}

	diffArea.originalCode = newOriginalCode;
	ctx.deleteDiff(diff);

	if (Object.keys(diffArea._diffOfId).length === 0) {
		ctx.deleteDiffZone(diffArea);
	}

	ctx.refreshStylesAndDiffsInURI(uri);
	onFinishEdit();
}

/**
 * Reject a single diff: reverts the file to the original code for that diff range,
 * removes the diff entry, and removes the parent DiffZone when empty.
 */
export async function rejectDiff(
	{ diffid }: { diffid: number },
	ctx: DiffManagerContext,
): Promise<void> {
	const diff = ctx.diffOfId[diffid];
	if (!diff) return;

	const { diffareaid } = diff;
	const diffArea = ctx.diffAreaOfId[diffareaid];
	if (!diffArea) return;
	if (diffArea.type !== 'DiffZone') return;

	const uri = diffArea._URI;
	const { onFinishEdit } = ctx.addToHistory(uri);

	let writeText: string;
	let toRange: IRange;

	if (diff.type === 'deletion') {
		if (diff.startLine - 1 === diffArea.endLine) {
			writeText = '\n' + diff.originalCode;
			toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.startLine - 1, endColumn: Number.MAX_SAFE_INTEGER };
		} else {
			writeText = diff.originalCode + '\n';
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.startLine, endColumn: 1 };
		}
	} else if (diff.type === 'insertion') {
		if (diff.endLine === diffArea.endLine) {
			writeText = '';
			toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.endLine, endColumn: 1 };
		} else {
			writeText = '';
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 };
		}
	} else if (diff.type === 'edit') {
		writeText = diff.originalCode;
		toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER };
	} else {
		throw new Error(`Ribix error: ${diff}.type not recognized`);
	}

	ctx.writeURIText(uri, writeText, toRange, { shouldRealignDiffAreas: true });
	ctx.deleteDiff(diff);

	if (Object.keys(diffArea._diffOfId).length === 0) {
		ctx.deleteDiffZone(diffArea);
	}

	ctx.refreshStylesAndDiffsInURI(uri);
	onFinishEdit();
}

/**
 * Accept or reject all diff areas on a URI in one batch operation.
 */
export async function acceptOrRejectAllDiffAreas(
	{ uri, behavior, removeCtrlKs, _addToHistory }: Parameters<IEditCodeService['acceptOrRejectAllDiffAreas']>[0],
	ctx: DiffManagerContext,
): Promise<void> {
	const diffareaids = ctx.diffAreasOfURI[uri.fsPath];
	if ((diffareaids?.size ?? 0) === 0) return;

	const { onFinishEdit } = _addToHistory === false
		? { onFinishEdit: () => { } }
		: ctx.addToHistory(uri);

	for (const diffareaid of diffareaids ?? []) {
		const diffArea = ctx.diffAreaOfId[diffareaid];
		if (!diffArea) continue;

		if (diffArea.type === 'DiffZone') {
			if (behavior === 'reject') {
				ctx.revertDiffZone(diffArea);
				ctx.deleteDiffZone(diffArea);
			} else if (behavior === 'accept') {
				ctx.deleteDiffZone(diffArea);
			}
		} else if (diffArea.type === 'CtrlKZone' && removeCtrlKs) {
			ctx.deleteCtrlKZone(diffArea);
		}
	}

	ctx.refreshStylesAndDiffsInURI(uri);
	onFinishEdit();
}
