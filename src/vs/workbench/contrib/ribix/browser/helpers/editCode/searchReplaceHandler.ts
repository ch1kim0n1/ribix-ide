/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Handles search/replace block parsing and application
 * Extracted from editCodeService.ts to reduce god file size
 */

import { URI } from '../../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ExtractedSearchReplaceBlock } from '../../../common/helpers/extractCodeFromResult.js';

export interface SearchReplaceResult {
	success: boolean;
	uri: URI;
	numReplacements: number;
	errors: string[];
}

// Apply a single search/replace block to the model
export const applySearchReplaceBlock = (
	block: ExtractedSearchReplaceBlock,
	model: ITextModel,
	startingLine?: number
): { success: boolean; appliedLine: number; error?: string } => {
	const fullText = model.getValue();
	const searchText = block.orig;
	const replaceText = block.final;

	// Find the search text
	let searchIdx: number;
	if (startingLine !== undefined) {
		// Start search from a specific line
		const linesBefore = fullText.split('\n').slice(0, startingLine - 1).join('\n');
		const startOffset = linesBefore.length + (startingLine > 1 ? 1 : 0);
		searchIdx = fullText.indexOf(searchText, startOffset);
	} else {
		searchIdx = fullText.indexOf(searchText);
	}

	if (searchIdx === -1) {
		return {
			success: false,
			appliedLine: -1,
			error: `Search text not found: "${searchText.substring(0, 50)}..."`,
		};
	}

	// Get the position for the replacement
	const startPos = model.getPositionAt(searchIdx);
	const endPos = model.getPositionAt(searchIdx + searchText.length);

	// Apply the replacement
	model.applyEdits([
		{
			range: {
				startLineNumber: startPos.lineNumber,
				startColumn: startPos.column,
				endLineNumber: endPos.lineNumber,
				endColumn: endPos.column,
			},
			text: replaceText,
		},
	]);

	return {
		success: true,
		appliedLine: startPos.lineNumber,
	};
};

// Apply multiple search/replace blocks
export const applySearchReplaceBlocks = (
	blocks: ExtractedSearchReplaceBlock[],
	model: ITextModel,
	uri: URI
): SearchReplaceResult => {
	const result: SearchReplaceResult = {
		success: true,
		uri,
		numReplacements: 0,
		errors: [],
	};

	let lastAppliedLine = 1;

	for (const block of blocks) {
		const blockResult = applySearchReplaceBlock(block, model, lastAppliedLine);

		if (blockResult.success) {
			result.numReplacements++;
			lastAppliedLine = blockResult.appliedLine + 1;
		} else {
			result.success = false;
			if (blockResult.error) {
				result.errors.push(blockResult.error);
			}
		}
	}

	return result;
};

// Validate search/replace blocks before applying
export const validateSearchReplaceBlocks = (
	blocks: ExtractedSearchReplaceBlock[],
	model: ITextModel
): { valid: boolean; errors: string[] } => {
	const errors: string[] = [];
	const fullText = model.getValue();

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];

		if (!block.orig) {
			errors.push(`Block ${i + 1}: Missing search content`);
			continue;
		}

		if (!fullText.includes(block.orig)) {
			errors.push(`Block ${i + 1}: Search text not found in file`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
};

// Error content formatter for invalid blocks
export const formatInvalidBlockError = (
	block: ExtractedSearchReplaceBlock,
	index: number,
	model: ITextModel
): string => {
	const lines: string[] = [];
	lines.push(`// Error in search/replace block ${index + 1}:`);
	lines.push('');
	lines.push('// Original content:');
	lines.push(block.orig);
	lines.push('');
	lines.push('// Replacement content:');
	lines.push(block.final);
	lines.push('');

	return lines.join('\n');
};
