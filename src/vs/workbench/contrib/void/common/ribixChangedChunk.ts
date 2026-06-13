/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure, I/O-free helpers for computing the "changed chunk" — the set of changed
 * files plus per-file changed line ranges — that the auto-on-change trigger
 * (ribixChangeWatcherService) scopes a QA mission to. Kept pure so it is cheap
 * to unit-test in the node tier.
 */

/** A closed, 1-based inclusive line range: [startLine, endLine]. */
export type LineRange = [number, number];

/** One changed file in a ChangedChunk. */
export type ChangedFile = { uri: string; ranges: LineRange[] };

/** What kind of IDE signal produced the change. */
export type ChangeTrigger = 'save' | 'commit';

/** The debounced, scoped batch handed to the mission layer. */
export type ChangedChunk = {
	trigger: ChangeTrigger;
	files: ChangedFile[];
	branch: string | null;
	detectedAt: number;
};

/** Path segments that are never worth auto-QA-ing (generated / vendored / VCS). */
export const IGNORED_PATH_SEGMENTS = ['node_modules', 'out', 'out-build', 'dist', 'build', '.git'] as const;

const LOCKFILE_NAMES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

/** True if a path should be excluded from auto-trigger (generated/vendored/lock/minified). */
export function isIgnoredPath(fsPath: string): boolean {
	const normalized = fsPath.replace(/\\/g, '/');
	const segments = normalized.split('/');
	for (const seg of segments) {
		if ((IGNORED_PATH_SEGMENTS as readonly string[]).includes(seg)) { return true; }
	}
	const base = segments[segments.length - 1] ?? '';
	if (LOCKFILE_NAMES.has(base)) { return true; }
	if (/\.min\.(js|css)$/.test(base)) { return true; }
	if (/\.(js|css)\.map$/.test(base)) { return true; }
	return false;
}

/** True when there are no changed ranges at all. */
export function rangesAreEmpty(ranges: LineRange[]): boolean {
	return ranges.length === 0;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified `git diff` body for one file into the new-file line ranges that
 * actually gained content. Pure deletions (new count 0) contribute no range.
 */
export function parseUnifiedDiffRanges(diff: string): LineRange[] {
	const ranges: LineRange[] = [];
	for (const line of diff.split('\n')) {
		const m = HUNK_HEADER.exec(line);
		if (!m) { continue; }
		const start = parseInt(m[1], 10);
		const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
		if (!Number.isFinite(start) || count <= 0) { continue; }
		ranges.push([start, start + count - 1]);
	}
	return ranges;
}

/**
 * Parse the output of IVoidSCMService.gitSampledDiffs — blocks delimited by
 * `==== <file> ====` headers — into per-file changed ranges. Files that yield no
 * ranges (deletion/whitespace-only) are dropped so they never spawn a mission.
 */
export function parseSampledDiffsToChunk(sampled: string): ChangedFile[] {
	if (!sampled.trim()) { return []; }
	const files: ChangedFile[] = [];
	const blocks = sampled.split(/^==== (.+?) ====$/m);
	// split() with a capture group yields: [pre, file1, body1, file2, body2, ...]
	for (let i = 1; i < blocks.length; i += 2) {
		const file = blocks[i].trim();
		const body = blocks[i + 1] ?? '';
		const ranges = parseUnifiedDiffRanges(body);
		if (ranges.length > 0) {
			files.push({ uri: file, ranges });
		}
	}
	return files;
}

/**
 * Save-scoped range computation: a cheap line-level diff of `before` vs `after`.
 * Returns the 1-based inclusive line spans in `after` whose (trimmed) content
 * differs from `before`. Whitespace-only changes are ignored. Used when there is
 * no git diff yet (the buffer was just saved).
 */
export function diffLineRanges(before: string, after: string): LineRange[] {
	const beforeLines = before.length === 0 ? [] : before.split('\n');
	const afterLines = after.length === 0 ? [] : after.split('\n');
	const ranges: LineRange[] = [];
	let runStart = -1;
	for (let i = 0; i < afterLines.length; i++) {
		const b = beforeLines[i];
		const a = afterLines[i];
		const changed = b === undefined || a.trim() !== b.trim();
		if (changed) {
			if (runStart === -1) { runStart = i + 1; }
		} else if (runStart !== -1) {
			ranges.push([runStart, i]);
			runStart = -1;
		}
	}
	if (runStart !== -1) {
		ranges.push([runStart, afterLines.length]);
	}
	return ranges;
}
