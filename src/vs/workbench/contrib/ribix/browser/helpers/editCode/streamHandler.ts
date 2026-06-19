/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Handles streaming text from LLM and applying to diff zones
 * Extracted from editCodeService.ts to reduce god file size
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { DiffZone } from '../../../common/editCodeServiceTypes.js';
import { numLinesOfStr } from './diffAreaUtils.js';

type StreamLocationMutable = { line: number, col: number, addedSplitYet: boolean, originalCodeStartLine: number };

export interface StreamHandlerResult {
	appliedText: string;
	newLine: number;
	newCol: number;
	addedSplitYet: boolean;
}

// Handles streaming text and returns what should be applied
export const handleStreamedText = (
	originalCode: string,
	llmTextSoFar: string,
	deltaText: string,
	latestMutable: StreamLocationMutable
): StreamHandlerResult => {
	let { line, col, addedSplitYet, originalCodeStartLine } = latestMutable;

	let deltaTextToAdd = deltaText;

	// If we haven't added the original code split marker yet
	if (!addedSplitYet) {
		const originalCodeFirstLine = originalCode.split('\n')[0] ?? '';

		// Find where the first line of original code appears in llmTextSoFar
		const firstLineIdx = llmTextSoFar.indexOf(originalCodeFirstLine);
		if (firstLineIdx !== -1) {
			// LLM is rewriting the code - skip to after the original code
			const numLinesInLLMOutputBeforeOrig = numLinesOfStr(llmTextSoFar.substring(0, firstLineIdx + originalCodeFirstLine.length));
			originalCodeStartLine = numLinesInLLMOutputBeforeOrig;
			addedSplitYet = true;
		}
	}

	// Calculate current position in the diff zone
	let currentLineInDiffZone = line - originalCodeStartLine;

	// Handle newlines in delta
	const newlineIdx = deltaTextToAdd.indexOf('\n');
	if (newlineIdx !== -1) {
		// Multiple lines in delta - apply each line
		const lines = deltaTextToAdd.split('\n');
		let currentCol = col;

		for (let i = 0; i < lines.length; i++) {
			if (i > 0) {
				currentLineInDiffZone++;
				currentCol = 1;
			}
			currentCol += lines[i].length;
		}

		line = originalCodeStartLine + currentLineInDiffZone;
		col = currentCol;
	} else {
		// Single line delta
		col += deltaTextToAdd.length;
	}

	return {
		appliedText: deltaTextToAdd,
		newLine: line,
		newCol: col,
		addedSplitYet,
	};
};

// Update stream state in a diff zone
export const updateStreamState = (
	diffZone: DiffZone,
	streamState: StreamLocationMutable
): void => {
	diffZone._streamState = {
		...diffZone._streamState,
		line: streamState.line,
		col: streamState.col,
	} as any;
};

// Check if streaming should stop
export const shouldStopStreaming = (
	diffZone: DiffZone,
	model: ITextModel
): boolean => {
	// Stop if model is disposed or diff zone is no longer valid
	if (model.isDisposed()) return true;
	if (!diffZone._streamState.isStreaming) return true;

	const currentLineCount = model.getLineCount();
	if (diffZone.startLine > currentLineCount) return true;

	return false;
};

// Parse streamed LLM response to extract code
export const parseStreamedCode = (
	fullLLMText: string,
	originalCode: string
): { beforeCode: string; newCode: string; afterCode: string } | null => {
	// Try to find the original code boundaries
	const originalLines = originalCode.split('\n');
	const originalFirstLine = originalLines[0]?.trim();
	const originalLastLine = originalLines[originalLines.length - 1]?.trim();

	if (!originalFirstLine || !originalLastLine) return null;

	const lines = fullLLMText.split('\n');

	// Find the start of original code in the LLM output
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]?.trim() === originalFirstLine) {
			startIdx = i;
			break;
		}
	}

	if (startIdx === -1) return null;

	// Find the end of original code in the LLM output
	let endIdx = -1;
	for (let i = startIdx + originalLines.length - 1; i < lines.length; i++) {
		if (lines[i]?.trim() === originalLastLine) {
			endIdx = i;
			break;
		}
	}

	if (endIdx === -1) endIdx = startIdx + originalLines.length - 1;

	return {
		beforeCode: lines.slice(0, startIdx).join('\n'),
		newCode: lines.slice(startIdx, endIdx + 1).join('\n'),
		afterCode: lines.slice(endIdx + 1).join('\n'),
	};
};
