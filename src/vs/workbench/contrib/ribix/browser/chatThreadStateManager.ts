/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * chatThreadStateManager.ts
 *
 * Thread state CRUD helpers extracted from ChatThreadService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { generateUuid } from '../../../../base/common/uuid.js';
import { deepClone } from '../../../../base/common/objects.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';
import { ThreadsState, ThreadStreamState, ThreadType } from './chatThreadService.js';

type ChatThreads = { [id: string]: undefined | ThreadType };
type UserMessageType = ChatMessage & { role: 'user' };
type UserMessageState = UserMessageType['state'];

const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
};

export function newThreadObject(): ThreadType {
	const now = new Date().toISOString();
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set(),
	} satisfies ThreadType;
}

/** Minimal context the state-manager functions need from ChatThreadService. */
export interface StateManagerContext {
	state: ThreadsState;
	streamState: ThreadStreamState;
	setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean): void;
	storeAllThreads(threads: ChatThreads): void;
	setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void;
}

/** Returns the current thread, throwing if it does not exist. */
export function getCurrentThread(ctx: StateManagerContext): ThreadType {
	const thread = ctx.state.allThreads[ctx.state.currentThreadId];
	if (!thread) throw new Error(`Current thread should never be undefined`);
	return thread;
}

/** Switches the active thread. */
export function switchToThread(threadId: string, ctx: StateManagerContext): void {
	ctx.setState({ currentThreadId: threadId });
}

/** Opens a new empty thread, or switches to an existing empty one. */
export function openNewThread(ctx: StateManagerContext): void {
	const { allThreads: currentThreads } = ctx.state;
	// if an empty thread already exists, switch to it
	for (const threadId in currentThreads) {
		if (currentThreads[threadId]!.messages.length === 0) {
			switchToThread(threadId, ctx);
			return;
		}
	}
	// otherwise create a new thread
	const newThread = newThreadObject();
	const newThreads: ChatThreads = { ...currentThreads, [newThread.id]: newThread };
	ctx.storeAllThreads(newThreads);
	ctx.setState({ allThreads: newThreads, currentThreadId: newThread.id });
}

/** Permanently deletes a thread. */
export function deleteThread(threadId: string, ctx: StateManagerContext): void {
	const { allThreads: currentThreads } = ctx.state;
	const newThreads = { ...currentThreads };
	delete newThreads[threadId];
	ctx.storeAllThreads(newThreads);
	ctx.setState({ ...ctx.state, allThreads: newThreads });
}

/** Duplicates a thread under a new ID. */
export function duplicateThread(threadId: string, ctx: StateManagerContext): void {
	const { allThreads: currentThreads } = ctx.state;
	const threadToDuplicate = currentThreads[threadId];
	if (!threadToDuplicate) return;
	const newThread = { ...deepClone(threadToDuplicate), id: generateUuid() };
	const newThreads = { ...currentThreads, [newThread.id]: newThread };
	ctx.storeAllThreads(newThreads);
	ctx.setState({ allThreads: newThreads });
}

/** Returns the state of a specific user message in the current thread. */
export function getCurrentMessageState(messageIdx: number, ctx: StateManagerContext): UserMessageState {
	const currMessage = getCurrentThread(ctx)?.messages?.[messageIdx];
	if (!currMessage || currMessage.role !== 'user') return defaultMessageState;
	return currMessage.state;
}

/** Returns the state object of the current thread. */
export function getCurrentThreadState(ctx: StateManagerContext): ThreadType['state'] {
	return getCurrentThread(ctx).state;
}
