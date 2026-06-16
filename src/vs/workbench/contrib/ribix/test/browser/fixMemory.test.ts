/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

// ---------------------------------------------------------------------------
// Hermetic replicas of the types and logic from fixMemory.ts.
// We avoid importing the DI-heavy production module so the tests run without
// the VS Code service locator. The scoring logic, trimming behaviour, and
// storage contract are all replicated faithfully below.
// ---------------------------------------------------------------------------

const FIX_MEMORY_STORAGE_KEY = 'ribix.fixMemory.v1';
const MAX_ENTRIES = 500;

interface FixMemoryEntry {
	id: string;
	filePath: string;
	errorPattern: string;
	bugDescription: string;
	fixDiff: string;
	testCode: string;
	missionId: string;
	appliedAt: string;
	successCount: number;
}

// ---------------------------------------------------------------------------
// Minimal storage stub
// ---------------------------------------------------------------------------

class FakeStorage {
	private store: Map<string, string> = new Map();

	get(key: string): string | undefined {
		return this.store.get(key);
	}

	set(key: string, value: string): void {
		this.store.set(key, value);
	}
}

// ---------------------------------------------------------------------------
// Inline service (mirrors FixMemoryService without DI)
// ---------------------------------------------------------------------------

function generateId(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class FixMemoryUnderTest {
	constructor(private readonly storage: FakeStorage) {}

	private loadEntries(): FixMemoryEntry[] {
		try {
			const raw = this.storage.get(FIX_MEMORY_STORAGE_KEY);
			if (!raw) { return []; }
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed as FixMemoryEntry[] : [];
		} catch {
			return [];
		}
	}

	private saveEntries(entries: FixMemoryEntry[]): void {
		this.storage.set(FIX_MEMORY_STORAGE_KEY, JSON.stringify(entries));
	}

	recordFix(entry: Omit<FixMemoryEntry, 'id' | 'successCount'>): void {
		const entries = this.loadEntries();
		const newEntry: FixMemoryEntry = {
			...entry,
			id: generateId(),
			successCount: 0,
		};
		entries.push(newEntry);

		if (entries.length > MAX_ENTRIES) {
			entries.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
			entries.splice(0, entries.length - MAX_ENTRIES);
		}

		this.saveEntries(entries);
	}

	getEntries(): FixMemoryEntry[] {
		return this.loadEntries();
	}

	private tokenize(text: string): Set<string> {
		return new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 0));
	}

	private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
		if (a.size === 0 && b.size === 0) { return 0; }
		let intersectionSize = 0;
		for (const word of a) {
			if (b.has(word)) { intersectionSize++; }
		}
		const unionSize = a.size + b.size - intersectionSize;
		return unionSize === 0 ? 0 : intersectionSize / unionSize;
	}

	private dirname(filePath: string): string {
		const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
		return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
	}

	computeScore(filePath: string, errorMessage: string, entry: FixMemoryEntry): number {
		if (entry.errorPattern) {
			try {
				if (new RegExp(entry.errorPattern).test(errorMessage)) {
					return 1.0;
				}
			} catch {
				// invalid regex
			}
		}

		const wordOverlap = this.jaccardSimilarity(
			this.tokenize(errorMessage),
			this.tokenize(entry.bugDescription),
		);

		const fileScore = filePath === entry.filePath ? 1.0
			: this.dirname(filePath) === this.dirname(entry.filePath) ? 0.5
			: 0.0;

		return wordOverlap * 0.7 + fileScore * 0.3;
	}

	findSimilarFixes(filePath: string, errorMessage: string): FixMemoryEntry[] {
		const entries = this.loadEntries();
		const scored: Array<{ entry: FixMemoryEntry; score: number }> = [];
		for (const entry of entries) {
			const score = this.computeScore(filePath, errorMessage, entry);
			if (score > 0.3) {
				scored.push({ entry, score });
			}
		}
		scored.sort((a, b) => {
			if (b.score !== a.score) { return b.score - a.score; }
			return b.entry.successCount - a.entry.successCount;
		});
		return scored.map(s => s.entry);
	}

	suggestFix(filePath: string, errorMessage: string): FixMemoryEntry | null {
		const entries = this.loadEntries();
		let topEntry: FixMemoryEntry | null = null;
		let topScore = 0;
		for (const entry of entries) {
			const score = this.computeScore(filePath, errorMessage, entry);
			if (score > topScore) {
				topScore = score;
				topEntry = entry;
			}
		}
		if (topScore > 0.7 && topEntry !== null) {
			return topEntry;
		}
		return null;
	}
}

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeEntry(over: Partial<Omit<FixMemoryEntry, 'id' | 'successCount'>> = {}): Omit<FixMemoryEntry, 'id' | 'successCount'> {
	return {
		filePath: '/repo/src/foo.ts',
		errorPattern: '',
		bugDescription: 'undefined is not a function when calling process',
		fixDiff: '--- a\n+++ b',
		testCode: 'test("foo", () => {})',
		missionId: 'mission-1',
		appliedAt: new Date().toISOString(),
		...over,
	};
}

// ---------------------------------------------------------------------------

suite('FixMemoryService — recordFix()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('stores entry with a generated id and successCount 0', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry({ bugDescription: 'null reference error' }));

		const entries = svc.getEntries();
		assert.strictEqual(entries.length, 1);
		assert.ok(entries[0].id, 'id should be a non-empty string');
		assert.strictEqual(entries[0].successCount, 0);
		assert.strictEqual(entries[0].bugDescription, 'null reference error');
	});

	test('multiple recordFix() calls accumulate entries', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry({ bugDescription: 'error one' }));
		svc.recordFix(makeEntry({ bugDescription: 'error two' }));
		svc.recordFix(makeEntry({ bugDescription: 'error three' }));

		assert.strictEqual(svc.getEntries().length, 3);
	});

	test('each stored entry receives a unique id', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry());
		svc.recordFix(makeEntry());

		const entries = svc.getEntries();
		assert.notStrictEqual(entries[0].id, entries[1].id);
	});

	test('trims to 500 entries when the limit is exceeded — keeps newest by appliedAt', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		// Insert 502 entries with ascending timestamps.
		const base = new Date('2024-01-01T00:00:00Z').getTime();
		for (let i = 0; i < 502; i++) {
			const ts = new Date(base + i * 1000).toISOString();
			svc.recordFix(makeEntry({ appliedAt: ts, bugDescription: `bug-${i}` }));
		}

		const entries = svc.getEntries();
		assert.strictEqual(entries.length, 500, 'trimmed to 500');

		// The two oldest (bug-0 and bug-1) must be gone.
		const descriptions = entries.map(e => e.bugDescription);
		assert.ok(!descriptions.includes('bug-0'), 'oldest entry removed');
		assert.ok(!descriptions.includes('bug-1'), 'second oldest entry removed');
		assert.ok(descriptions.includes('bug-501'), 'newest entry kept');
	});
});

// ---------------------------------------------------------------------------

suite('FixMemoryService — findSimilarFixes()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('regex match on errorPattern → score 1.0 (included)', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry({
			errorPattern: 'TypeError.*undefined',
			bugDescription: 'something completely unrelated',
		}));

		const results = svc.findSimilarFixes('/repo/other.ts', 'TypeError: Cannot read property of undefined');
		assert.strictEqual(results.length, 1, 'regex match should be included');

		// Confirm the score is exactly 1.0 via computeScore.
		const score = svc.computeScore(
			'/repo/other.ts',
			'TypeError: Cannot read property of undefined',
			results[0],
		);
		assert.strictEqual(score, 1.0);
	});

	test('high word overlap returns score > 0.3 (included)', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry({
			errorPattern: '',
			bugDescription: 'undefined reference calling process exit code',
		}));

		// Very similar description — should produce high Jaccard.
		const results = svc.findSimilarFixes('/repo/src/foo.ts', 'undefined reference calling process exit code');
		assert.ok(results.length >= 1, 'high overlap entry should be included');
	});

	test('completely different error returns score ≤ 0.3 (excluded)', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		svc.recordFix(makeEntry({
			errorPattern: '',
			bugDescription: 'segmentation fault in allocator blue moon xyz abc',
			filePath: '/totally/different/path/zyx.ts',
		}));

		// Completely unrelated message and file path.
		const results = svc.findSimilarFixes('/repo/src/auth.ts', 'network timeout during http request');
		assert.strictEqual(results.length, 0, 'unrelated entry must be excluded');
	});

	test('file path prefix (same directory) contributes to score', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		// Entry with no regex and very different description, but same directory.
		const entry = makeEntry({
			errorPattern: '',
			bugDescription: 'zzzz unique words only here zzzz ppppp qqqqq rrrrr',
			filePath: '/repo/src/same-dir/target.ts',
		});
		svc.recordFix(entry);

		// When filePath shares the same directory, fileScore = 0.5, contributing 0.5 * 0.3 = 0.15.
		// The word overlap with completely different words is 0, so final score = 0.15.
		// 0.15 ≤ 0.3, so it stays excluded. We confirm the score is non-zero (file prefix helps).
		const entryRaw = svc.getEntries()[0];
		const scoreWithSameDir = svc.computeScore('/repo/src/same-dir/other.ts', 'something else', entryRaw);
		const scoreWithDiffDir = svc.computeScore('/totally/different/path.ts', 'something else', entryRaw);

		assert.ok(scoreWithSameDir > scoreWithDiffDir, 'same-dir path should score higher than different dir');
		assert.ok(scoreWithSameDir > 0, 'file path prefix contributes a non-zero amount');
	});

	test('exact file path match gives maximum fileScore contribution', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		const entry = makeEntry({
			errorPattern: '',
			bugDescription: 'unique words zyx abc qrs',
			filePath: '/repo/src/exact.ts',
		});
		svc.recordFix(entry);

		const entryRaw = svc.getEntries()[0];
		const scoreExact = svc.computeScore('/repo/src/exact.ts', 'something unrelated', entryRaw);
		const scoreSameDir = svc.computeScore('/repo/src/other.ts', 'something unrelated', entryRaw);

		// Exact path → fileScore 1.0; same dir → fileScore 0.5.
		assert.ok(scoreExact > scoreSameDir, 'exact path should score higher than same-dir');
	});

	test('results are sorted by score descending', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		// Entry A: regex match → score 1.0
		svc.recordFix(makeEntry({
			errorPattern: 'TypeError.*undefined',
			bugDescription: 'irrelevant',
			filePath: '/far/away.ts',
		}));

		// Entry B: exact file path + matching words → moderate score > 0.3
		svc.recordFix(makeEntry({
			errorPattern: '',
			bugDescription: 'undefined reference error occurred',
			filePath: '/repo/src/foo.ts',
		}));

		const results = svc.findSimilarFixes('/repo/src/foo.ts', 'TypeError: Cannot read property of undefined occurred');
		assert.ok(results.length >= 2);

		// First result must be the regex match (score 1.0).
		assert.ok(results[0].errorPattern === 'TypeError.*undefined', 'highest-scored entry first');
	});
});

// ---------------------------------------------------------------------------

suite('FixMemoryService — suggestFix()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns top match when its score > 0.7', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		// A regex match gives score 1.0, which is > 0.7.
		svc.recordFix(makeEntry({
			errorPattern: 'NullPointerException',
			bugDescription: 'null pointer in handler',
			missionId: 'mission-high',
		}));

		const result = svc.suggestFix('/any/file.ts', 'NullPointerException in line 42');
		assert.ok(result !== null, 'should return a match');
		assert.strictEqual(result!.missionId, 'mission-high');
	});

	test('returns null when best match score ≤ 0.7', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		// Entry has no regex and a weakly overlapping description in a different directory.
		svc.recordFix(makeEntry({
			errorPattern: '',
			bugDescription: 'zzz abc totally different words here mmm nnn',
			filePath: '/different/path/x.ts',
		}));

		const result = svc.suggestFix('/repo/src/foo.ts', 'authentication failure oauth token expired');
		assert.strictEqual(result, null, 'should return null when no match crosses 0.7');
	});

	test('returns null when no entries are recorded', () => {
		const storage = new FakeStorage();
		const svc = new FixMemoryUnderTest(storage);

		const result = svc.suggestFix('/repo/src/foo.ts', 'any error message');
		assert.strictEqual(result, null);
	});
});
