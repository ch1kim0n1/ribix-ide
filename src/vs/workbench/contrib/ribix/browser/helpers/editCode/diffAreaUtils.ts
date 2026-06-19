/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Utility functions for DiffArea operations
 * Extracted from editCodeService.ts to reduce god file size
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { EndOfLinePreference } from '../../../../../../editor/common/model.js';
import { DiffArea } from '../../../common/editCodeServiceTypes.js';

export const numLinesOfStr = (str: string): number => str.split('\n').length;

// Helper function to remove whitespace except newlines
export const removeWhitespaceExceptNewlines = (str: string): string => {
	return str.replace(/[^\S\n]+/g, '');
};

// finds block.orig in fileContents and return its range in file
// startingAtLine is 1-indexed and inclusive
// returns 1-indexed lines
export const findTextInCode = (
	text: string,
	fileContents: string,
	canFallbackToRemoveWhitespace: boolean,
	opts: { startingAtLine?: number; returnType: 'lines' }
): readonly [number, number] | 'Not found' | 'Not unique' => {
	const returnAns = (fileContents: string, idx: number): readonly [number, number] => {
		const startLine = numLinesOfStr(fileContents.substring(0, idx + 1));
		const numLines = numLinesOfStr(text);
		const endLine = startLine + numLines - 1;
		return [startLine, endLine] as const;
	};

	const startingAtLineIdx = (fileContents: string): number =>
		opts?.startingAtLine !== undefined
			? fileContents.split('\n').slice(0, opts.startingAtLine).join('\n').length
			: 0;

	// idx = starting index in fileContents
	let idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

	// if idx was found
	if (idx !== -1) {
		return returnAns(fileContents, idx);
	}

	if (!canFallbackToRemoveWhitespace) {
		return 'Not found' as const;
	}

	// try to find it ignoring all whitespace this time
	text = removeWhitespaceExceptNewlines(text);
	fileContents = removeWhitespaceExceptNewlines(fileContents);
	idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

	if (idx === -1) return 'Not found' as const;
	const lastIdx = fileContents.lastIndexOf(text);
	if (lastIdx !== idx) return 'Not unique' as const;

	return returnAns(fileContents, idx);
};

// Realign diff areas after content changes
export const realignDiffAreas = (
	diffAreas: DiffArea[],
	changeText: string,
	changeRange: { startLineNumber: number; endLineNumber: number }
): void => {
	const numNewlines = numLinesOfStr(changeText) - 1;
	const numLinesDeleted = changeRange.endLineNumber - changeRange.startLineNumber;
	const deltaNewlines = numNewlines - numLinesDeleted;

	for (const diffArea of diffAreas) {
		// if completely before change, do nothing
		if (diffArea.endLine < changeRange.startLineNumber) {
			continue;
		}
		// if completely after change, shift by delta
		if (diffArea.startLine > changeRange.endLineNumber) {
			diffArea.startLine += deltaNewlines;
			diffArea.endLine += deltaNewlines;
			continue;
		}
		// if overlapping with change, adjust endLine only
		diffArea.endLine += deltaNewlines;
	}
};

// Get the current text of a diff area from the model
export const getDiffAreaText = (diffArea: DiffArea, model: ITextModel): string => {
	const fullFileText = model.getValue(EndOfLinePreference.LF);
	return fullFileText
		.split('\n')
		.slice(diffArea.startLine - 1, diffArea.endLine)
		.join('\n');
};

// Check if two ranges overlap
export const rangesOverlap = (
	startLine1: number,
	endLine1: number,
	startLine2: number,
	endLine2: number
): boolean => {
	return startLine1 <= endLine2 && startLine2 <= endLine1;
};

// Find overlapping diff area
export const findOverlappingDiffArea = (
	startLine: number,
	endLine: number,
	diffAreas: DiffArea[],
	filter?: (diffArea: DiffArea) => boolean
): DiffArea | null => {
	for (const diffArea of diffAreas) {
		if (filter && !filter(diffArea)) continue;
		if (rangesOverlap(startLine, endLine, diffArea.startLine, diffArea.endLine)) {
			return diffArea;
		}
	}
	return null;
};
