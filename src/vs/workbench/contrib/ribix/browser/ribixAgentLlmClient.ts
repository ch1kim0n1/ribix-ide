/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixAgentLlmClient.ts
 *
 * Low-level LLM communication helpers extracted from RibixAgentService.
 * Exports plain functions — does NOT register any VS Code singleton.
 */

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js';
import { ParsedToolCall } from '../common/ribixAgentLoopTypes.js';
import { AgentTurnMessage } from '../common/ribixAgentLoopTypes.js';
import { IRibixSettingsService } from '../common/ribixSettingsService.js';
import { aiProviderManager } from './aiProviderManager.js';

/**
 * Parses tool calls from an assistant turn. Agent prompts instruct the model to emit
 * tool calls as JSON fenced blocks containing a "tool" key:
 * ```json
 * {"tool": "read_file", "params": {"uri": "/abs/path/to/file"}}
 * ```
 */
export function parseToolCalls(llmResponse: string): ParsedToolCall[] {
	const toolCallPattern = /```json\s*(\{[\s\S]*?"tool"\s*:[\s\S]*?\})\s*```/g;
	const matches = [...llmResponse.matchAll(toolCallPattern)];
	const calls: ParsedToolCall[] = [];
	for (const match of matches) {
		try {
			const parsed = JSON.parse(match[1]) as { tool?: unknown; params?: unknown };
			if (typeof parsed.tool === 'string') {
				calls.push({
					tool: parsed.tool,
					params: (parsed.params ?? {}) as Record<string, string | undefined>,
				});
			}
		} catch {
			// ignore malformed tool-call block
		}
	}
	return calls;
}

/**
 * Sends the running message array to the model and resolves with the assistant text.
 *
 * Routing logic:
 *   - When the active provider is 'anthropic' (the default), the call goes through
 *     `ILLMMessageService`, the VS Code-native provider pipeline (streaming, model
 *     selection from settings, metering).
 *   - When the active provider is 'openai', 'ollama', or 'ribix', the call routes
 *     through `aiProviderManager.callLLM()`, which talks directly to those providers.
 *
 * The leading `system` message is extracted from the turn array and passed as a
 * `separateSystemMessage` to the native path, or prepended as a system-role message
 * on the aiProviderManager path.
 */
export async function callLlm(
	messages: AgentTurnMessage[],
	token: CancellationToken,
	llmMessageService: ILLMMessageService,
	settingsService: IRibixSettingsService,
): Promise<string> {
	const systemMessage = messages.find(m => m.role === 'system');
	const chatMessages: LLMChatMessage[] = [];
	for (const m of messages) {
		if (m.role === 'system') {
			continue;
		} else if (m.role === 'assistant') {
			chatMessages.push({ role: 'assistant', content: m.content });
		} else if (m.role === 'tool') {
			// Feed tool output back as a user turn so the model can react to it. Kept
			// provider-agnostic (text) rather than using native tool_call_id plumbing.
			chatMessages.push({ role: 'user', content: `[tool result: ${m.toolName}]\n${m.content}` });
		} else {
			chatMessages.push({ role: 'user', content: m.content });
		}
	}

	if (token.isCancellationRequested) {
		throw new Error('LLM call cancelled');
	}

	// Route non-Anthropic providers through aiProviderManager.
	// The Anthropic provider uses the VS Code-native ILLMMessageService pipeline
	// (streaming, settings-driven model selection, token metering).
	const activeProvider = aiProviderManager.getProvider();
	if (activeProvider !== 'anthropic') {
		const providerMessages = [
			...(systemMessage ? [{ role: 'system' as const, content: systemMessage.content }] : []),
			...chatMessages,
		];
		return aiProviderManager.callLLM(providerMessages as any, { maxTokens: 4096 });
	}

	// Anthropic path: use the VS Code-native ILLMMessageService.
	return new Promise((resolve, reject) => {
		if (token.isCancellationRequested) {
			reject(new Error('LLM call cancelled'));
			return;
		}

		const modelSelection = settingsService.state.modelSelectionOfFeature['Chat'];

		const requestId = llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			messages: chatMessages,
			separateSystemMessage: systemMessage?.content,
			chatMode: null,
			modelSelection,
			modelSelectionOptions: undefined,
			overridesOfModel: undefined,
			logging: { loggingName: 'ribix-agent' },
			onText: (_params) => { /* streaming — not used; wait for onFinalMessage */ },
			onFinalMessage: (params) => { resolve(params.fullText); },
			onError: (params) => { reject(new Error(params.message)); },
			onAbort: () => { reject(new Error('LLM call aborted')); },
		});

		if (!requestId) {
			reject(new Error('Failed to send LLM message'));
			return;
		}

		// Cancel the in-flight request if the cancellation token fires
		token.onCancellationRequested(() => {
			llmMessageService.abort(requestId);
		});
	});
}
