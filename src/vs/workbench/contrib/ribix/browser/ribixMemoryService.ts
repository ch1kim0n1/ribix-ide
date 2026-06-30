/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { MemoryEntry, MemoryEntryType } from '../common/ribixTypes.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { RibixApiClient } from '../common/ribixApiClient.js';

const RIBIX_MEMORY_STORAGE_KEY = 'ribix.memory.entries';

/**
 * An unresolved sync conflict: a server entry contradicts a local engineer note
 * (same id, differing content). Surfaced in the Memory tab for accept-mine / accept-theirs.
 */
export interface MemoryConflict {
	id: string;
	local: MemoryEntry;
	server: MemoryEntry;
}

/** Visible sync state for the Memory tab. */
export interface MemorySyncStatus {
	lastPulledAt: number | null;
	lastPushedAt: number | null;
	/** Number of local entries not yet pushed since the last push (best-effort). */
	pending: number;
	/** Unresolved conflicts awaiting an accept-mine / accept-theirs decision. */
	conflicts: MemoryConflict[];
}

export interface IRibixMemoryService {
	readonly _serviceBrand: undefined;

	// Read
	getEntries(type: MemoryEntryType, workspaceId: string): Promise<MemoryEntry[]>;
	searchEntries(query: string, workspaceId: string): Promise<MemoryEntry[]>;

	// Write
	writeEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>;
	updateEntry(id: string, updates: Partial<Pick<MemoryEntry, 'content' | 'metadata' | 'confidence'>>): Promise<void>;
	deleteEntry(id: string): Promise<void>;

	// Workspace scoping
	getWorkspaceId(): Promise<string>;

	// Memory sync
	syncFromOrg(): Promise<void>;
	syncToOrg(): Promise<void>;

	// Sync status + conflict resolution
	getSyncStatus(): MemorySyncStatus;
	/** Resolve a surfaced conflict by keeping the local ('mine') or server ('theirs') entry. */
	resolveConflictChoice(conflictId: string, choice: 'mine' | 'theirs'): void;

	// Events
	onDidChangeEntries: Event<void>;
}

export const IRibixMemoryService = createDecorator<IRibixMemoryService>('ribixMemoryService');

class RibixMemoryService extends Disposable implements IRibixMemoryService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeEntries = new Emitter<void>();
	readonly onDidChangeEntries = this._onDidChangeEntries.event;

	private entries: MemoryEntry[] = [];
	private workspaceId: string | null = null;
	private _initPromise: Promise<void>;

	// Sync status surfaced in the Memory tab.
	private lastPulledAt: number | null = null;
	private lastPushedAt: number | null = null;
	private conflicts: MemoryConflict[] = [];

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IRibixAuthService private readonly ribixAuthService: IRibixAuthService,
	) {
		super();
		this._initPromise = this.loadEntries().then(() => {
			this.syncFromOrg().catch(() => {});
		});
	}

	private async loadEntries(): Promise<void> {
		const stored = this.storageService.get(RIBIX_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE);
		if (stored) {
			try {
				this.entries = JSON.parse(stored as string);
			} catch (e) {
				console.error('Failed to parse stored memory entries:', e);
				this.entries = [];
			}
		}
	}

	private saveEntries(): void {
		this.storageService.store(RIBIX_MEMORY_STORAGE_KEY, JSON.stringify(this.entries), StorageScope.WORKSPACE, StorageTarget.USER);
		this._onDidChangeEntries.fire();
	}

	async getEntries(type: MemoryEntryType, workspaceId: string): Promise<MemoryEntry[]> {
		await this._initPromise;
		return this.entries.filter(entry => entry.type === type && entry.workspaceId === workspaceId);
	}

	async searchEntries(query: string, workspaceId: string): Promise<MemoryEntry[]> {
		await this._initPromise;
		const lowerQuery = query.toLowerCase();
		return this.entries.filter(entry => {
			if (entry.workspaceId !== workspaceId) return false;
			const contentMatch = entry.content.toLowerCase().includes(lowerQuery);
			const metadataMatch = Object.values(entry.metadata).some(
				val => typeof val === 'string' && val.toLowerCase().includes(lowerQuery)
			);
			return contentMatch || metadataMatch;
		});
	}

	async writeEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
		const now = Date.now();
		const newEntry: MemoryEntry = {
			...entry,
			id: generateUuid(),
			createdAt: now,
			updatedAt: now,
		};
		this.entries.push(newEntry);
		this.saveEntries();
		return newEntry;
	}

	async updateEntry(id: string, updates: Partial<Pick<MemoryEntry, 'content' | 'metadata' | 'confidence'>>): Promise<void> {
		const index = this.entries.findIndex(entry => entry.id === id);
		if (index === -1) {
			throw new Error(`Memory entry with id ${id} not found`);
		}
		this.entries[index] = {
			...this.entries[index],
			...updates,
			updatedAt: Date.now(),
		};
		this.saveEntries();
	}

	async deleteEntry(id: string): Promise<void> {
		const index = this.entries.findIndex(entry => entry.id === id);
		if (index === -1) {
			throw new Error(`Memory entry with id ${id} not found`);
		}
		this.entries.splice(index, 1);
		this.saveEntries();
	}

	async getWorkspaceId(): Promise<string> {
		await this._initPromise;
		if (this.workspaceId) {
			return this.workspaceId;
		}

		// Try to get git remote URL
		try {
			const workspaceFolders = this.workspaceContextService.getWorkspace();
			if (workspaceFolders.folders.length > 0) {
				const workspaceUri = workspaceFolders.folders[0].uri;

				// Use workspace URI as stable workspace identifier
				this.workspaceId = await this.stableHash(workspaceUri.toString());
				return this.workspaceId;
			}
		} catch (e) {
			console.error('Failed to get workspace ID:', e);
		}

		// Ultimate fallback
		this.workspaceId = 'default-workspace';
		return this.workspaceId;
	}

	private async stableHash(str: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(str);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
	}

	async syncFromOrg(): Promise<void> {
		try {
			const config = await this.ribixAuthService.getRequiredConfig();
			const workspaceId = await this.getWorkspaceId();

			const apiClient = new RibixApiClient();
			const response = await apiClient.getOrgMemory(config, { workspaceId });

			// Merge server entries with local entries
			const mergedEntries = this.mergeMemoryEntries(this.entries, response.entries);

			this.entries = mergedEntries;
			this.lastPulledAt = Date.now();
			this.saveEntries();
		} catch (e) {
			// If not signed in or API error, just log and continue
			console.warn('Failed to sync memory from org:', e);
		}
	}

	async syncToOrg(): Promise<void> {
		try {
			const config = await this.ribixAuthService.getRequiredConfig();
			const workspaceId = await this.getWorkspaceId();

			// Get only entries that haven't been synced (or all entries)
			const entriesToSync = this.entries.filter(entry => entry.workspaceId === workspaceId);

			const apiClient = new RibixApiClient();
			await apiClient.syncMemory(config, {
				workspaceId,
				entries: entriesToSync,
			});
			this.lastPushedAt = Date.now();
			this._onDidChangeEntries.fire();
		} catch (e) {
			// If not signed in or API error, just log and continue
			console.warn('Failed to sync memory to org:', e);
		}
	}

	getSyncStatus(): MemorySyncStatus {
		// Pending = local entries created/updated since the last successful push.
		const since = this.lastPushedAt ?? 0;
		const pending = this.entries.filter(e => e.updatedAt > since).length;
		return {
			lastPulledAt: this.lastPulledAt,
			lastPushedAt: this.lastPushedAt,
			pending,
			conflicts: [...this.conflicts],
		};
	}

	resolveConflictChoice(conflictId: string, choice: 'mine' | 'theirs'): void {
		const idx = this.conflicts.findIndex(c => c.id === conflictId);
		if (idx === -1) { return; }
		const conflict = this.conflicts[idx];
		const winner = choice === 'mine' ? conflict.local : conflict.server;

		const entryIdx = this.entries.findIndex(e => e.id === winner.id);
		if (entryIdx === -1) {
			this.entries.push(winner);
		} else {
			this.entries[entryIdx] = winner;
		}

		this.conflicts.splice(idx, 1);
		this.saveEntries();
	}

	private mergeMemoryEntries(localEntries: MemoryEntry[], serverEntries: MemoryEntry[]): MemoryEntry[] {
		const entryMap = new Map<string, MemoryEntry>();

		// Add local entries first
		for (const entry of localEntries) {
			entryMap.set(entry.id, entry);
		}

		// Drop any previously-surfaced conflicts that no longer have a matching server entry,
		// then recompute against this pull. Conflicts already pending for an id are preserved.
		const serverById = new Map(serverEntries.map(e => [e.id, e]));
		this.conflicts = this.conflicts.filter(c => serverById.has(c.id));

		// Merge server entries with conflict resolution
		for (const serverEntry of serverEntries) {
			const localEntry = entryMap.get(serverEntry.id);

			if (!localEntry) {
				// New entry from server
				entryMap.set(serverEntry.id, serverEntry);
			} else {
				// Conflict resolution. A server entry that contradicts a local engineer note
				// (same id, differing content) is surfaced for an explicit decision rather than
				// silently overwritten or silently discarded.
				const mergedEntry = this.resolveConflict(localEntry, serverEntry);
				entryMap.set(mergedEntry.id, mergedEntry);
			}
		}

		return Array.from(entryMap.values());
	}

	private resolveConflict(localEntry: MemoryEntry, serverEntry: MemoryEntry): MemoryEntry {
		// A server entry contradicts a local engineer note when the engineer authored the local
		// entry and the server content differs. Don't silently pick a winner — keep the local
		// (engineer) entry in place and surface the conflict for accept-mine / accept-theirs.
		if (localEntry.source === 'engineer' && localEntry.content !== serverEntry.content) {
			this.recordConflict(localEntry, serverEntry);
			return localEntry;
		}

		// Engineer entries otherwise win
		if (localEntry.source === 'engineer') {
			return localEntry;
		}
		if (serverEntry.source === 'engineer') {
			return serverEntry;
		}

		// Both are agent entries - newer wins
		if (localEntry.updatedAt > serverEntry.updatedAt) {
			return localEntry;
		}
		return serverEntry;
	}

	private recordConflict(local: MemoryEntry, server: MemoryEntry): void {
		const existing = this.conflicts.find(c => c.id === local.id);
		if (existing) {
			existing.local = local;
			existing.server = server;
		} else {
			this.conflicts.push({ id: local.id, local, server });
		}
	}
}

registerSingleton(IRibixMemoryService, RibixMemoryService, InstantiationType.Delayed);