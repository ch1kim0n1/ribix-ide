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
import { URI } from '../../../../base/common/uri.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MemoryEntry, MemoryEntryType } from '../common/ribixTypes.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { RibixApiClient } from '../common/ribixApiClient.js';

const RIBIX_MEMORY_STORAGE_KEY = 'ribix.memory.entries';

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
	private voidSCM: IVoidSCMService;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IRibixAuthService private readonly ribixAuthService: IRibixAuthService,
	) {
		super();
		this.voidSCM = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));
		this.loadEntries();
		// Sync from org on workspace open
		this.syncFromOrg();
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
		return this.entries.filter(entry => entry.type === type && entry.workspaceId === workspaceId);
	}

	async searchEntries(query: string, workspaceId: string): Promise<MemoryEntry[]> {
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
		if (this.workspaceId) {
			return this.workspaceId;
		}

		// Try to get git remote URL
		try {
			const workspaceFolders = this.workspaceContextService.getWorkspace();
			if (workspaceFolders.folders.length > 0) {
				const workspaceUri = workspaceFolders.folders[0].uri;
				const path = workspaceUri.fsPath;

				// Try to get git remote URL from voidSCM
				try {
					const remoteUrl = await this.voidSCM.gitRemoteUrl(path);
					if (remoteUrl) {
						// Simple hash of the remote URL (in production, use proper SHA-256)
						this.workspaceId = this.simpleHash(remoteUrl);
						return this.workspaceId;
					}
				} catch (e) {
					// Fall through to workspace URI hash
				}

				// Fallback to workspace URI hash
				this.workspaceId = this.simpleHash(workspaceUri.toString());
				return this.workspaceId;
			}
		} catch (e) {
			console.error('Failed to get workspace ID:', e);
		}

		// Ultimate fallback
		this.workspaceId = 'default-workspace';
		return this.workspaceId;
	}

	private simpleHash(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(16);
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
		} catch (e) {
			// If not signed in or API error, just log and continue
			console.warn('Failed to sync memory to org:', e);
		}
	}

	private mergeMemoryEntries(localEntries: MemoryEntry[], serverEntries: MemoryEntry[]): MemoryEntry[] {
		const entryMap = new Map<string, MemoryEntry>();

		// Add local entries first
		for (const entry of localEntries) {
			entryMap.set(entry.id, entry);
		}

		// Merge server entries with conflict resolution
		for (const serverEntry of serverEntries) {
			const localEntry = entryMap.get(serverEntry.id);

			if (!localEntry) {
				// New entry from server
				entryMap.set(serverEntry.id, serverEntry);
			} else {
				// Conflict resolution
				const mergedEntry = this.resolveConflict(localEntry, serverEntry);
				entryMap.set(mergedEntry.id, mergedEntry);
			}
		}

		return Array.from(entryMap.values());
	}

	private resolveConflict(localEntry: MemoryEntry, serverEntry: MemoryEntry): MemoryEntry {
		// Engineer entries always win
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
}

registerSingleton(IRibixMemoryService, RibixMemoryService, InstantiationType.Delayed);