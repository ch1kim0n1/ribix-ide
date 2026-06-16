/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import Severity from '../../../../base/common/severity.js';
import { IAction } from '../../../../base/common/actions.js';
import { AgentFinding } from '../common/ribixTypes.js';

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const FIX_MEMORY_STORAGE_KEY = 'ribix.fixMemory.v1';

/** Maximum number of entries retained; oldest by appliedAt are trimmed when exceeded. */
const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixMemoryEntry {
	id: string;
	filePath: string;
	errorPattern: string;   // regex pattern that matches the error
	bugDescription: string;
	fixDiff: string;
	testCode: string;
	missionId: string;
	appliedAt: string;      // ISO timestamp
	successCount: number;   // how many times this fix was reused
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IFixMemoryService {
	readonly _serviceBrand: undefined;
	recordFix(entry: Omit<FixMemoryEntry, 'id' | 'successCount'>): Promise<void>;
	findSimilarFixes(filePath: string, errorMessage: string): Promise<FixMemoryEntry[]>;
	suggestFix(filePath: string, errorMessage: string): Promise<FixMemoryEntry | null>;
	showSuggestions(findings: AgentFinding[]): Promise<void>;
}

export const IFixMemoryService = createDecorator<IFixMemoryService>('fixMemoryService');

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FixMemoryService extends Disposable implements IFixMemoryService {
	readonly _serviceBrand: undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	async recordFix(entry: Omit<FixMemoryEntry, 'id' | 'successCount'>): Promise<void> {
		const entries = this.loadEntries();

		const newEntry: FixMemoryEntry = {
			...entry,
			id: generateUuid(),
			successCount: 0,
		};

		entries.push(newEntry);

		// Trim to MAX_ENTRIES, keeping the most recent by appliedAt.
		if (entries.length > MAX_ENTRIES) {
			entries.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
			entries.splice(0, entries.length - MAX_ENTRIES);
		}

		this.saveEntries(entries);
	}

	async findSimilarFixes(filePath: string, errorMessage: string): Promise<FixMemoryEntry[]> {
		const entries = this.loadEntries();

		const scored: Array<{ entry: FixMemoryEntry; score: number }> = [];

		for (const entry of entries) {
			const score = this.computeScore(filePath, errorMessage, entry);
			if (score > 0.3) {
				scored.push({ entry, score });
			}
		}

		// Sort by score descending, then successCount descending as a tiebreaker.
		scored.sort((a, b) => {
			if (b.score !== a.score) { return b.score - a.score; }
			return b.entry.successCount - a.entry.successCount;
		});

		return scored.map(s => s.entry);
	}

	async suggestFix(filePath: string, errorMessage: string): Promise<FixMemoryEntry | null> {
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

	async showSuggestions(findings: AgentFinding[]): Promise<void> {
		for (const finding of findings) {
			const match = await this.suggestFix(finding.file, finding.message);
			if (match) {
				const matchedEntry = match;
				const primaryAction: IAction = {
					id: 'ribix.viewFixSuggestion',
					label: 'View suggestion',
					tooltip: '',
					class: undefined,
					enabled: true,
					run: async () => {
						await this.incrementSuccessCount(matchedEntry.id);
					},
				};

				this.notificationService.notify({
					severity: Severity.Info,
					message: '💡 Ribix has fixed a similar bug before. View suggestion?',
					actions: {
						primary: [primaryAction],
					},
				});
			}
		}
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async incrementSuccessCount(entryId: string): Promise<void> {
		const entries = this.loadEntries();
		const idx = entries.findIndex(e => e.id === entryId);
		if (idx >= 0) {
			entries[idx].successCount++;
			this.saveEntries(entries);
		}
	}

	private computeScore(filePath: string, errorMessage: string, entry: FixMemoryEntry): number {
		// Regex match → perfect score
		if (entry.errorPattern) {
			try {
				if (new RegExp(entry.errorPattern).test(errorMessage)) {
					return 1.0;
				}
			} catch {
				// invalid regex — fall through to word overlap
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

	private loadEntries(): FixMemoryEntry[] {
		try {
			const raw = this.storageService.get(FIX_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE);
			if (!raw) { return []; }
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed as FixMemoryEntry[] : [];
		} catch {
			return [];
		}
	}

	private saveEntries(entries: FixMemoryEntry[]): void {
		this.storageService.store(
			FIX_MEMORY_STORAGE_KEY,
			JSON.stringify(entries),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
	}
}

registerSingleton(IFixMemoryService, FixMemoryService, InstantiationType.Delayed);
