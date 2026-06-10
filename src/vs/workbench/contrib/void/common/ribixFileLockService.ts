/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export interface IRibixFileLockService {
	readonly _serviceBrand: undefined;
	acquire(filePath: string, agentId: string): Promise<() => void>;
	isLocked(filePath: string): boolean;
	getLockHolder(filePath: string): string | null;
	onDidChangeLocks: Event<void>;
}

export const IRibixFileLockService = createDecorator<IRibixFileLockService>('ribixFileLockService');

interface Lock {
	filePath: string;
	agentId: string;
	acquiredAt: number;
	timeoutMs: number;
}

class RibixFileLockService extends Disposable implements IRibixFileLockService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeLocks = new Emitter<void>();
	readonly onDidChangeLocks = this._onDidChangeLocks.event;

	private locks: Map<string, Lock> = new Map();
	private pendingAcquisitions: Map<string, Array<{ agentId: string; resolve: () => void; reject: (error: Error) => void }>> = new Map();
	private readonly lockTimeoutMs: number = 30000; // 30 seconds

	constructor() {
		super();
		// Start cleanup interval
		const interval = setInterval(() => this.cleanupExpiredLocks(), 5000);
		this._register({ dispose: () => clearInterval(interval) });
	}

	async acquire(filePath: string, agentId: string): Promise<() => void> {
		const normalizedPath = this.normalizePath(filePath);

		// Check if already locked by another agent
		const existingLock = this.locks.get(normalizedPath);
		if (existingLock && existingLock.agentId !== agentId) {
			// Queue the acquisition
			return new Promise((resolve, reject) => {
				const pending = this.pendingAcquisitions.get(normalizedPath) || [];
				pending.push({ agentId, resolve: () => resolve(this.createReleaseFn(normalizedPath, agentId)), reject });
				this.pendingAcquisitions.set(normalizedPath, pending);
			});
		}

		// Acquire the lock
		this.locks.set(normalizedPath, {
			filePath: normalizedPath,
			agentId,
			acquiredAt: Date.now(),
			timeoutMs: this.lockTimeoutMs,
		});
		this._onDidChangeLocks.fire();

		return this.createReleaseFn(normalizedPath, agentId);
	}

	private createReleaseFn(filePath: string, agentId: string): () => void {
		return () => {
			const lock = this.locks.get(filePath);
			if (lock && lock.agentId === agentId) {
				this.locks.delete(filePath);
				this._onDidChangeLocks.fire();

				// Process pending acquisitions
				const pending = this.pendingAcquisitions.get(filePath);
				if (pending && pending.length > 0) {
					const next = pending.shift()!;
					if (pending.length === 0) {
						this.pendingAcquisitions.delete(filePath);
					}
					this.locks.set(filePath, {
						filePath,
						agentId: next.agentId,
						acquiredAt: Date.now(),
						timeoutMs: this.lockTimeoutMs,
					});
					this._onDidChangeLocks.fire();
					next.resolve();
				}
			}
		};
	}

	isLocked(filePath: string): boolean {
		return this.locks.has(this.normalizePath(filePath));
	}

	getLockHolder(filePath: string): string | null {
		const lock = this.locks.get(this.normalizePath(filePath));
		return lock ? lock.agentId : null;
	}

	private cleanupExpiredLocks(): void {
		const now = Date.now();
		for (const [filePath, lock] of this.locks.entries()) {
			if (now - lock.acquiredAt > lock.timeoutMs) {
				console.warn(`Lock expired for ${filePath} held by ${lock.agentId}`);
				this.locks.delete(filePath);
				this._onDidChangeLocks.fire();

				// Process pending acquisitions
				const pending = this.pendingAcquisitions.get(filePath);
				if (pending && pending.length > 0) {
					const next = pending.shift()!;
					if (pending.length === 0) {
						this.pendingAcquisitions.delete(filePath);
					}
					this.locks.set(filePath, {
						filePath,
						agentId: next.agentId,
						acquiredAt: Date.now(),
						timeoutMs: this.lockTimeoutMs,
					});
					this._onDidChangeLocks.fire();
					next.resolve();
				}
			}
		}
	}

	private normalizePath(filePath: string): string {
		// Normalize path to handle different OS path separators
		return filePath.replace(/\\/g, '/');
	}
}

registerSingleton(IRibixFileLockService, RibixFileLockService, InstantiationType.Delayed);