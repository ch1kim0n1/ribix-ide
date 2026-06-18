/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * chatThreadCheckpointing.ts
 *
 * Checkpoint navigation helpers extracted from ChatThreadService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { URI } from '../../../../base/common/uri.js';
import { CheckpointEntry } from '../common/chatThreadServiceTypes.js';
import { VoidFileSnapshot } from '../common/editCodeServiceTypes.js';
import { ThreadsState, ThreadStreamState, ThreadType } from './chatThreadService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';

/** Minimal context checkpoint functions need from ChatThreadService. */
export interface CheckpointContext {
	state: ThreadsState;
	streamState: ThreadStreamState;
	editCodeService: IEditCodeService;
	addMessageToThread(threadId: string, message: CheckpointEntry): void;
	editMessageInThread(threadId: string, messageIdx: number, newMessage: CheckpointEntry): void;
	setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void;
}

/** Returns the voidFileSnapshot and optionally user-modified snapshot for a checkpoint/uri. */
export function getCheckpointInfo(
	checkpointMessage: CheckpointEntry,
	fsPath: string,
	opts: { includeUserModifiedChanges: boolean },
): { voidFileSnapshot: VoidFileSnapshot | null } {
	const voidFileSnapshot = checkpointMessage.voidFileSnapshotOfURI
		? checkpointMessage.voidFileSnapshotOfURI[fsPath] ?? null
		: null;

	if (!opts.includeUserModifiedChanges) {
		return { voidFileSnapshot };
	}

	const userModifiedVoidFileSnapshot =
		fsPath in checkpointMessage.userModifications.voidFileSnapshotOfURI
			? checkpointMessage.userModifications.voidFileSnapshotOfURI[fsPath] ?? null
			: null;

	return { voidFileSnapshot: userModifiedVoidFileSnapshot ?? voidFileSnapshot };
}

/** Returns the last checkpoint message at or before messageIdx, plus its index. */
export function getCheckpointBeforeMessage(
	{ threadId, messageIdx }: { threadId: string; messageIdx: number },
	ctx: CheckpointContext,
): [CheckpointEntry, number] | undefined {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return undefined;
	for (let i = messageIdx; i >= 0; i--) {
		const message = thread.messages[i];
		if (message.role === 'checkpoint') {
			return [message as CheckpointEntry, i];
		}
	}
	return undefined;
}

/**
 * Returns, for each fsPath that had a checkpoint between loIdx and hiIdx,
 * the last checkpoint index in that range.
 */
export function getCheckpointsBetween(
	{ threadId, loIdx, hiIdx }: { threadId: string; loIdx: number; hiIdx: number },
	ctx: CheckpointContext,
): { lastIdxOfURI: { [fsPath: string]: number } } {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return { lastIdxOfURI: {} };
	const lastIdxOfURI: { [fsPath: string]: number } = {};
	for (let i = loIdx; i <= hiIdx; i += 1) {
		const message = thread.messages[i];
		if (message?.role !== 'checkpoint') continue;
		const checkpoint = message as CheckpointEntry;
		for (const fsPath in checkpoint.voidFileSnapshotOfURI) {
			lastIdxOfURI[fsPath] = i;
		}
	}
	return { lastIdxOfURI };
}

/** Reads the checkpoint the thread is currently positioned at. */
export function readCurrentCheckpoint(
	threadId: string,
	ctx: CheckpointContext,
): [CheckpointEntry, number] | undefined {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;
	const { currCheckpointIdx } = thread.state;
	if (currCheckpointIdx === null) return;
	const checkpoint = thread.messages[currCheckpointIdx];
	if (!checkpoint) return;
	if (checkpoint.role !== 'checkpoint') return;
	return [checkpoint as CheckpointEntry, currCheckpointIdx];
}

/**
 * Ensures the current position is standing on a checkpoint (creates one if needed).
 * Returns without modifying state if already on a checkpoint.
 */
export function makeUsStandOnCheckpoint(
	{ threadId }: { threadId: string },
	ctx: CheckpointContext,
	addUserCheckpoint: (opts: { threadId: string }) => void,
): void {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;
	if (thread.state.currCheckpointIdx === null) {
		const lastMsg = thread.messages[thread.messages.length - 1];
		if (lastMsg?.role !== 'checkpoint') addUserCheckpoint({ threadId });
		ctx.setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 });
	}
}

/**
 * Records any user-made file changes into the checkpoint we're currently standing on.
 */
export function addUserModificationsToCurrCheckpoint(
	{ threadId }: { threadId: string },
	ctx: CheckpointContext,
	computeNewCheckpointInfo: (opts: { threadId: string }) => { voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined } } | undefined,
): void {
	const { voidFileSnapshotOfURI } = computeNewCheckpointInfo({ threadId }) ?? {};
	const res = readCurrentCheckpoint(threadId, ctx);
	if (!res) return;
	const [checkpoint, checkpointIdx] = res;
	ctx.editMessageInThread(threadId, checkpointIdx, {
		...checkpoint,
		userModifications: { voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {} },
	});
}

/**
 * Jumps to the checkpoint immediately before messageIdx, restoring file snapshots
 * for all files that changed between the current and target checkpoint positions.
 */
export function jumpToCheckpointBeforeMessageIdx(
	opts: { threadId: string; messageIdx: number; jumpToUserModified: boolean },
	ctx: CheckpointContext,
	addUserCheckpoint: (opts: { threadId: string }) => void,
	computeNewCheckpointInfo: (opts: { threadId: string }) => { voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined } } | undefined,
): void {
	const { threadId, messageIdx, jumpToUserModified } = opts;

	// ensure we're on a checkpoint so the user can jump forward again
	makeUsStandOnCheckpoint({ threadId }, ctx, addUserCheckpoint);

	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;
	if (ctx.streamState[threadId]?.isRunning) return;

	const c = getCheckpointBeforeMessage({ threadId, messageIdx }, ctx);
	if (c === undefined) return;

	const fromIdx = thread.state.currCheckpointIdx;
	if (fromIdx === null) return;

	const [, toIdx] = c;
	if (toIdx === fromIdx) return;

	// save user modifications at the current checkpoint before jumping
	addUserModificationsToCurrCheckpoint({ threadId }, ctx, computeNewCheckpointInfo);

	// UNDO direction: revert everything between toIdx+1 and fromIdx
	if (toIdx < fromIdx) {
		const { lastIdxOfURI } = getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx }, ctx);

		const idxes = function* () {
			for (let k = toIdx; k >= 0; k -= 1) yield k;       // look backwards first
			for (let k = toIdx + 1; k < thread.messages.length; k += 1) yield k; // then forwards
		};

		for (const fsPath in lastIdxOfURI) {
			for (const k of idxes()) {
				const message = thread.messages[k];
				if (message.role !== 'checkpoint') continue;
				const res = getCheckpointInfo(message as CheckpointEntry, fsPath, { includeUserModifiedChanges: jumpToUserModified });
				if (!res) continue;
				const { voidFileSnapshot } = res;
				if (!voidFileSnapshot) continue;
				ctx.editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot);
				break;
			}
		}
	}

	// REDO direction: apply everything between fromIdx+1 and toIdx
	if (toIdx > fromIdx) {
		const { lastIdxOfURI } = getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx }, ctx);
		for (const fsPath in lastIdxOfURI) {
			for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
				const message = thread.messages[k];
				if (message.role !== 'checkpoint') continue;
				const res = getCheckpointInfo(message as CheckpointEntry, fsPath, { includeUserModifiedChanges: jumpToUserModified });
				if (!res) continue;
				const { voidFileSnapshot } = res;
				if (!voidFileSnapshot) continue;
				ctx.editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot);
				break;
			}
		}
	}

	ctx.setThreadState(threadId, { currCheckpointIdx: toIdx });
}
