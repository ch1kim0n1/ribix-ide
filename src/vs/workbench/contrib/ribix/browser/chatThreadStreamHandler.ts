/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * chatThreadStreamHandler.ts
 *
 * Stream-handling helpers extracted from ChatThreadService.
 * Exports plain functions — does NOT register any VS Code singleton.
 *
 * Each function receives the service state/callbacks it needs rather than keeping
 * class-level state, preserving the parent class as the single source of truth.
 */

import { ChatMessage } from '../common/chatThreadServiceTypes.js';
import { StagingSelectionItem } from '../common/chatThreadServiceTypes.js';
import { ThreadsState, ThreadStreamState, ThreadType } from './chatThreadService.js';
import { chat_userMessageContent } from '../common/prompt/prompts.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { ToolName } from '../common/toolsServiceTypes.js';
import { ToolMessage } from '../common/chatThreadServiceTypes.js';

type UserMessageType = ChatMessage & { role: 'user' };
type UserMessageState = UserMessageType['state'];

const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
};

/** Minimal context the stream-handler functions need from ChatThreadService. */
export interface StreamHandlerContext {
	state: ThreadsState;
	streamState: ThreadStreamState;
	abortRunning(threadId: string): Promise<void>;
	addUserCheckpoint(opts: { threadId: string }): void;
	addMessageToThread(threadId: string, message: ChatMessage): void;
	setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean): void;
	storeAllThreads(threads: { [id: string]: undefined | ThreadType }): void;
	setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void;
	wrapRunAgentToNotify(p: Promise<void>, threadId: string): void;
	runChatAgent(opts: {
		threadId: string;
		modelSelection: ModelSelection | null;
		modelSelectionOptions: ModelSelectionOptions | undefined;
		callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' };
	}): Promise<void>;
	currentModelSelectionProps(): { modelSelection: ModelSelection | null; modelSelectionOptions: ModelSelectionOptions | undefined };
	directoryStrService: IDirectoryStrService;
	fileService: IFileService;
}

/**
 * Internal implementation: adds a user message and starts the streaming agent loop.
 * This is the shared core used by both addUserMessageAndStreamResponse and
 * editUserMessageAndStreamResponse.
 */
export async function addUserMessageAndStreamResponseImpl(
	{ userMessage, _chatSelections, threadId }: { userMessage: string; _chatSelections?: StagingSelectionItem[]; threadId: string },
	ctx: StreamHandlerContext,
): Promise<void> {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;

	// interrupt existing stream
	if (ctx.streamState[threadId]?.isRunning) {
		await ctx.abortRunning(threadId);
	}

	// add dummy checkpoint before first message to keep checkpoint invariant consistent
	if (thread.messages.length === 0) {
		ctx.addUserCheckpoint({ threadId });
	}

	// add user's message to chat history
	const instructions = userMessage;
	const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections;

	const userMessageContent = await chat_userMessageContent(instructions, currSelns, {
		directoryStrService: ctx.directoryStrService,
		fileService: ctx.fileService,
	});
	const userHistoryElt: ChatMessage = {
		role: 'user',
		content: userMessageContent,
		displayContent: instructions,
		selections: currSelns,
		state: defaultMessageState,
	};
	ctx.addMessageToThread(threadId, userHistoryElt);

	ctx.setThreadState(threadId, { currCheckpointIdx: null }); // no longer at a checkpoint

	ctx.wrapRunAgentToNotify(
		ctx.runChatAgent({ threadId, ...ctx.currentModelSelectionProps() }),
		threadId,
	);

	// scroll to bottom
	ctx.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
		m.scrollToBottom();
	});
}

/**
 * Adds a new user message (truncating any future messages if at a checkpoint) and
 * starts the streaming agent loop.
 */
export async function addUserMessageAndStreamResponse(
	{ userMessage, _chatSelections, threadId }: { userMessage: string; _chatSelections?: StagingSelectionItem[]; threadId: string },
	ctx: StreamHandlerContext,
): Promise<void> {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;

	// if there's a current checkpoint, delete all messages after it
	if (thread.state.currCheckpointIdx !== null) {
		const checkpointIdx = thread.state.currCheckpointIdx;
		const newMessages = thread.messages.slice(0, checkpointIdx + 1);

		const newThreads = {
			...ctx.state.allThreads,
			[threadId]: {
				...thread,
				lastModified: new Date().toISOString(),
				messages: newMessages,
			},
		};
		ctx.storeAllThreads(newThreads);
		ctx.setState({ allThreads: newThreads });
	}

	await addUserMessageAndStreamResponseImpl({ userMessage, _chatSelections, threadId }, ctx);
}

/**
 * Edits an existing user message at messageIdx and re-streams the response.
 * Clears all messages from messageIdx onward before re-adding.
 */
export async function editUserMessageAndStreamResponse(
	{ userMessage, messageIdx, threadId }: { userMessage: string; messageIdx: number; threadId: string },
	ctx: StreamHandlerContext,
): Promise<void> {
	const thread = ctx.state.allThreads[threadId];
	if (!thread) return;

	if (thread.messages?.[messageIdx]?.role !== 'user') {
		throw new Error(`Error: editing a message with role !=='user'`);
	}

	// get prev staging selections before clearing the message
	const currSelns = (thread.messages[messageIdx] as ChatMessage & { role: 'user' }).state.stagingSelections || [];

	// clear messages up to the index
	const slicedMessages = thread.messages.slice(0, messageIdx);
	ctx.setState({
		allThreads: {
			...ctx.state.allThreads,
			[thread.id]: {
				...thread,
				messages: slicedMessages,
			},
		},
	});

	await addUserMessageAndStreamResponseImpl({ userMessage, _chatSelections: currSelns, threadId }, ctx);
}
