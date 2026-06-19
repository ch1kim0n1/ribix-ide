/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * editCodeApplier.ts
 *
 * Apply-phase helpers extracted from EditCodeService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { URI } from '../../../../base/common/uri.js';
import { DiffZone } from '../common/editCodeServiceTypes.js';
import { IEditCodeService, StartApplyingOpts } from './editCodeServiceInterface.js';
import { IVoidSettingsService } from '../common/ribixSettingsService.js';

/** Minimal context the applier functions need from EditCodeService. */
export interface ApplierContext {
	settingsService: IVoidSettingsService;
	fileLengthOfGivenURI(givenURI: URI | 'current'): number | null;
	getURIBeforeStartApplying(opts: StartApplyingOpts): URI | undefined;
	initializeWriteoverStream(opts: StartApplyingOpts): [DiffZone, Promise<void>] | undefined;
	initializeSearchAndReplaceStream(opts: StartApplyingOpts & { from: 'ClickApply' }): [DiffZone, Promise<void>] | undefined;
	startStreamingDiffZone(opts: {
		uri: URI;
		startBehavior: 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts';
		streamRequestIdRef: { current: string | null };
		linkedCtrlKZone: null;
		onWillUndo: () => void;
	}): { diffZone: DiffZone; onFinishEdit: () => Promise<void> } | undefined;
	onDidChangeStreamingInDiffZone: { fire(e: { uri: URI; diffareaid: number }): void };
	refreshStylesAndDiffsInURI(uri: URI): void;
	undoHistory(uri: URI): void;
	acceptOrRejectAllDiffAreas: IEditCodeService['acceptOrRejectAllDiffAreas'];
	writeURIText(uri: URI, text: string, range: 'wholeFileRange', opts: { shouldRealignDiffAreas: boolean }): void;
	instantlyApplySRBlocks(uri: URI, blocksStr: string): void;
}

/**
 * Decides which apply strategy to use (writeover vs search-and-replace) and starts
 * streaming.  Returns [URI, applyDonePromise] or null if nothing to apply.
 */
export function startApplying(
	opts: StartApplyingOpts,
	ctx: ApplierContext,
): [URI, Promise<void>] | null {
	let res: [DiffZone, Promise<void>] | undefined = undefined;

	if (opts.from === 'QuickEdit') {
		res = ctx.initializeWriteoverStream(opts); // rewrite
	} else if (opts.from === 'ClickApply') {
		if (ctx.settingsService.state.globalSettings.enableFastApply) {
			const numCharsInFile = ctx.fileLengthOfGivenURI(opts.uri);
			if (numCharsInFile === null) return null;
			if (numCharsInFile < 1000) {
				// slow apply for short files (especially important for empty files)
				res = ctx.initializeWriteoverStream(opts);
			} else {
				res = ctx.initializeSearchAndReplaceStream(opts); // fast apply
			}
		} else {
			res = ctx.initializeWriteoverStream(opts); // rewrite
		}
	}

	if (!res) return null;
	const [diffZone, applyDonePromise] = res;
	return [diffZone._URI, applyDonePromise];
}

/**
 * Instantly applies pre-computed search/replace blocks to the file without streaming.
 */
export function instantlyApplySearchReplaceBlocks(
	{ uri, searchReplaceBlocks }: { uri: URI; searchReplaceBlocks: string },
	ctx: ApplierContext,
): void {
	// start diffzone
	const res = ctx.startStreamingDiffZone({
		uri,
		streamRequestIdRef: { current: null },
		startBehavior: 'keep-conflicts',
		linkedCtrlKZone: null,
		onWillUndo: () => { },
	});
	if (!res) return;
	const { diffZone, onFinishEdit } = res;

	const onDone = () => {
		diffZone._streamState = { isStreaming: false };
		ctx.onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
		ctx.refreshStylesAndDiffsInURI(uri);
		onFinishEdit();

		// auto accept
		if (ctx.settingsService.state.globalSettings.autoAcceptLLMChanges) {
			ctx.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
		}
	};

	const onError = (e: { message: string; fullError: Error | null }) => {
		onDone();
		ctx.undoHistory(uri);
		throw e.fullError || new Error(e.message);
	};

	try {
		ctx.instantlyApplySRBlocks(uri, searchReplaceBlocks);
	} catch (e) {
		onError({ message: e + '', fullError: null });
	}

	onDone();
}

/**
 * Instantly rewrites the entire file content without streaming.
 */
export function instantlyRewriteFile(
	{ uri, newContent }: { uri: URI; newContent: string },
	ctx: ApplierContext,
): void {
	// start diffzone
	const res = ctx.startStreamingDiffZone({
		uri,
		streamRequestIdRef: { current: null },
		startBehavior: 'keep-conflicts',
		linkedCtrlKZone: null,
		onWillUndo: () => { },
	});
	if (!res) return;
	const { diffZone, onFinishEdit } = res;

	const onDone = () => {
		diffZone._streamState = { isStreaming: false };
		ctx.onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
		ctx.refreshStylesAndDiffsInURI(uri);
		onFinishEdit();

		// auto accept
		if (ctx.settingsService.state.globalSettings.autoAcceptLLMChanges) {
			ctx.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
		}
	};

	ctx.writeURIText(uri, newContent, 'wholeFileRange', { shouldRealignDiffAreas: true });
	onDone();
}
