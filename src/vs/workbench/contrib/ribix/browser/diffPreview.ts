/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// #40 — Diff preview before agents apply file changes
//
// Wire-up notes:
//   1. In RibixAgentService.runOneTool(), inside the WRITE_TOOLS branch, call
//      previewAndConfirmChange() BEFORE executing the tool (before callTool[tool](validated)).
//      Example insertion point (ribixAgentService.ts line ~396):
//
//        if (RibixAgentService.WRITE_TOOLS.has(tool) && filePath) {
//          const releaseLock = await this.fileLockService.acquire(filePath, agent.id);
//          try {
//            await this.checkpointService.checkpoint(agent.missionId, agent.id, filePath);
//            this.addActivityLog(agent, 'Checkpoint created', filePath, null, filePath);
//
//            // TODO(#40): preview diff before write — inject a diff-preview service
//            // and call previewAndConfirmChange() here. The decision determines whether
//            // to proceed, skip, or cancel the whole mission.
//            // const decision = await diffPreviewService.previewAndConfirmChange(
//            //   filePath, newContent, oldContent
//            // );
//            // if (decision === 'skip') { return `Skipped write to ${filePath}.`; }
//            // if (decision === 'cancel') { throw new Error('User cancelled write.'); }
//
//            const { result } = await this.toolsService.callTool[tool](validated);
//            ...
//          } finally { releaseLock(); }
//        }
//
//   2. To retrieve oldContent for the diff, read the file via IFileService before the
//      write (the tool params for rewrite_file/edit_file already carry the URI).
//
//   3. The INotificationService or a custom modal can be used to surface the diff and
//      collect the user decision in a VS Code extension context. See ribixMissionCard.tsx
//      for a React-based approval modal example to extend for diff display.

/**
 * Decision returned by previewAndConfirmChange after the user reviews the diff.
 * - 'apply'  — proceed with the file write.
 * - 'skip'   — skip this specific write and continue the mission.
 * - 'cancel' — abort the whole mission.
 */
export type DiffDecision = 'apply' | 'skip' | 'cancel';

/**
 * A single hunk in a unified diff, ready for display.
 */
export interface DiffHunk {
	/** Starting line in the old file (1-based). */
	oldStart: number;
	/** Starting line in the new file (1-based). */
	newStart: number;
	/** Lines in this hunk, each prefixed with ' ' (context), '-' (removed), '+' (added). */
	lines: string[];
}

/**
 * Computes a unified diff between oldContent and newContent using a simple
 * line-level LCS approach. No external diff library required.
 *
 * Returns an array of DiffHunk objects — one per contiguous changed region.
 * Context lines (CONTEXT_LINES) are included around each changed region so the
 * output resembles `git diff --unified=3`.
 */
export function computeUnifiedDiff(oldContent: string, newContent: string): DiffHunk[] {
	const CONTEXT_LINES = 3;
	const oldLines = oldContent.split('\n');
	const newLines = newContent.split('\n');

	// Build LCS length table (Myers-style, compact variant)
	const m = oldLines.length;
	const n = newLines.length;
	const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (oldLines[i] === newLines[j]) {
				lcs[i][j] = 1 + lcs[i + 1][j + 1];
			} else {
				lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
			}
		}
	}

	// Walk the LCS table to produce edit operations
	type Op = { kind: 'context' | 'remove' | 'add'; oldIdx: number; newIdx: number; text: string };
	const ops: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < m || j < n) {
		if (i < m && j < n && oldLines[i] === newLines[j]) {
			ops.push({ kind: 'context', oldIdx: i, newIdx: j, text: oldLines[i] });
			i++;
			j++;
		} else if (j < n && (i >= m || lcs[i][j + 1] >= lcs[i + 1][j])) {
			ops.push({ kind: 'add', oldIdx: i, newIdx: j, text: newLines[j] });
			j++;
		} else {
			ops.push({ kind: 'remove', oldIdx: i, newIdx: j, text: oldLines[i] });
			i++;
		}
	}

	if (ops.length === 0) {
		return []; // Files are identical
	}

	// Group ops into hunks with context lines
	const changeIndices = ops
		.map((op, idx) => (op.kind !== 'context' ? idx : -1))
		.filter(idx => idx >= 0);

	if (changeIndices.length === 0) {
		return []; // No changes
	}

	const hunks: DiffHunk[] = [];
	let hunkStart = Math.max(0, changeIndices[0] - CONTEXT_LINES);

	// Merge nearby change regions into single hunks
	let regionStart = hunkStart;
	let prevEnd = -1;
	for (let ci = 0; ci < changeIndices.length; ci++) {
		const changeIdx = changeIndices[ci];
		const nextChange = changeIndices[ci + 1];
		const regionEnd = nextChange === undefined
			? Math.min(ops.length - 1, changeIdx + CONTEXT_LINES)
			: nextChange - changeIndices[ci] <= CONTEXT_LINES * 2 + 1
				? -1 // merge — don't close yet
				: Math.min(ops.length - 1, changeIdx + CONTEXT_LINES);

		if (regionEnd === -1) {
			continue; // this change merges with the next
		}

		if (prevEnd >= 0 && regionStart > prevEnd + 1) {
			regionStart = Math.max(0, changeIdx - CONTEXT_LINES);
		}

		// Build hunk lines for [regionStart, regionEnd]
		const hunkOps = ops.slice(regionStart, regionEnd + 1);
		const firstOldIdx = hunkOps.find(o => o.kind !== 'add')?.oldIdx ?? 0;
		const firstNewIdx = hunkOps.find(o => o.kind !== 'remove')?.newIdx ?? 0;

		const lines: string[] = hunkOps.map(op => {
			if (op.kind === 'add') { return `+${op.text}`; }
			if (op.kind === 'remove') { return `-${op.text}`; }
			return ` ${op.text}`;
		});

		hunks.push({ oldStart: firstOldIdx + 1, newStart: firstNewIdx + 1, lines });
		prevEnd = regionEnd;
		regionStart = regionEnd + 1;
	}

	return hunks;
}

/**
 * Formats an array of DiffHunk objects into a unified-diff string suitable for
 * display in the console or a modal, including standard @@ hunk headers.
 */
export function formatUnifiedDiff(filePath: string, hunks: DiffHunk[]): string {
	if (hunks.length === 0) {
		return `--- ${filePath}\n+++ ${filePath}\n(no changes)`;
	}

	const header = `--- ${filePath}\n+++ ${filePath}`;
	const body = hunks.map(hunk => {
		const oldCount = hunk.lines.filter(l => !l.startsWith('+')).length;
		const newCount = hunk.lines.filter(l => !l.startsWith('-')).length;
		const hunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
		return [hunkHeader, ...hunk.lines].join('\n');
	}).join('\n');

	return `${header}\n${body}`;
}

/**
 * Intercepts a proposed file write, computes and displays a unified diff, and
 * waits for the user to decide whether to apply, skip, or cancel the change.
 *
 * This is the primary integration point for #40. In the current implementation
 * the decision is logged to the console (visible in VS Code's developer console)
 * and defaults to 'apply' so existing agent behaviour is unchanged until the UI
 * approval flow is wired in. Replace the TODO section below with a real modal or
 * notification-based prompt.
 *
 * @param filePath   Absolute path of the file being modified.
 * @param newContent The content the agent wants to write.
 * @param oldContent The current content of the file (read before calling callTool).
 * @param confirm    Optional injected confirmation function for testing and UI wiring.
 *                   Receives the formatted diff string and returns the user's decision.
 *                   If omitted, defaults to auto-apply (non-interactive).
 * @returns  The user's decision: 'apply', 'skip', or 'cancel'.
 */
export async function previewAndConfirmChange(
	filePath: string,
	newContent: string,
	oldContent: string,
	confirm?: (diffText: string, filePath: string) => Promise<DiffDecision>,
): Promise<DiffDecision> {
	const hunks = computeUnifiedDiff(oldContent, newContent);

	// Identical content — no write needed.
	if (hunks.length === 0) {
		return 'skip';
	}

	const diffText = formatUnifiedDiff(filePath, hunks);

	// TODO(#40-ui): Replace this with a real VS Code notification/modal that shows
	// diffText and collects the user decision. Until then, log the diff prominently
	// and auto-apply so the agent loop is unblocked.
	//
	// Example using INotificationService:
	//   notificationService.prompt(Severity.Info, `Apply change to ${filePath}?`, [
	//     { label: 'Apply', run: () => resolve('apply') },
	//     { label: 'Skip', run: () => resolve('skip') },
	//     { label: 'Cancel mission', run: () => resolve('cancel') },
	//   ]);
	//
	// For ribixMissionCard.tsx: fire an event on a shared EventEmitter that the React
	// component listens to, display the diff in a <pre> block, and resolve with the
	// button the user clicks.

	if (confirm) {
		return confirm(diffText, filePath);
	}

	// Default: log and auto-apply (non-interactive mode — safe for batch runs).
	console.log(
		`[diffPreview] Proposed change to ${filePath}:\n${diffText}\n` +
		`[diffPreview] Auto-applying (no confirm handler provided). Wire confirm() for interactive review.`
	);
	return 'apply';
}
