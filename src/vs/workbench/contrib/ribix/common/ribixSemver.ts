/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure semver-bump heuristics used by ribixMissionService.determineSemverBump.
 * Strategy: parse conventional-commit prefixes from `git log`, fall back to diff
 * heuristics over the sampled diff, and take the max bump found. Default `patch`.
 */

export type SemverBump = 'patch' | 'minor' | 'major';

const RANK: Record<SemverBump, number> = { patch: 0, minor: 1, major: 2 };

/** Return the greater of two bumps (major > minor > patch). */
export function maxBump(a: SemverBump, b: SemverBump): SemverBump {
	return RANK[a] >= RANK[b] ? a : b;
}

// gitLog format is `%h|%s|%ad` per line (see voidSCMMainService.gitLog).
// We also scan the whole text for BREAKING CHANGE footers.
const CONVENTIONAL = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?(!)?:/i;

/**
 * Derive a semver bump from a conventional-commit `git log` block.
 * - `feat:` -> minor
 * - `fix:` / `chore:` / others -> patch
 * - `!` bang or a `BREAKING CHANGE` footer anywhere -> major
 * Takes the max across all commits; safe default is `patch`.
 */
export function semverBumpFromConventionalCommits(gitLog: string): SemverBump {
	if (/BREAKING[ -]CHANGE/i.test(gitLog)) {
		return 'major';
	}
	let bump: SemverBump = 'patch';
	for (const rawLine of gitLog.split('\n')) {
		// gitLog lines are `hash|subject|date`; the subject is field index 1.
		const parts = rawLine.split('|');
		const subject = (parts.length >= 2 ? parts[1] : rawLine).trim();
		const m = CONVENTIONAL.exec(subject);
		if (!m) { continue; }
		if (m[3] === '!') { return 'major'; }
		const type = m[1].toLowerCase();
		if (type === 'feat') { bump = maxBump(bump, 'minor'); }
		else { bump = maxBump(bump, 'patch'); }
	}
	return bump;
}

/**
 * Fallback heuristic over a sampled unified diff:
 * - a removed `export` (public-API deletion/rename) -> major
 * - an added `export` (new public surface) -> minor
 * - otherwise -> patch
 */
export function semverBumpFromDiff(diff: string): SemverBump {
	let bump: SemverBump = 'patch';
	for (const line of diff.split('\n')) {
		if (/^-\s*export\b/.test(line)) { return 'major'; }
		if (/^\+\s*export\b/.test(line)) { bump = maxBump(bump, 'minor'); }
	}
	return bump;
}
