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
	/** Re-entrancy refcount — same agent may acquire the same file multiple times. */
	refCount: number;
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
		const existingLock = this.locks.get(normalizedPath);

		if (existingLock) {
			if (existingLock.agentId === agentId) {
				// Re-entrant: same agent acquires again — bump refcount and return a
				// release function that only deletes the lock when the count reaches zero.
				existingLock.refCount++;
				this._onDidChangeLocks.fire();
				return this.createReleaseFn(normalizedPath, agentId);
			} else {
				// Different agent holds the lock — queue this acquisition.
				return new Promise((resolve, reject) => {
					const pending = this.pendingAcquisitions.get(normalizedPath) || [];
					pending.push({ agentId, resolve: () => resolve(this.createReleaseFn(normalizedPath, agentId)), reject });
					this.pendingAcquisitions.set(normalizedPath, pending);
				});
			}
		}

		// No existing lock — acquire fresh.
		this.locks.set(normalizedPath, {
			filePath: normalizedPath,
			agentId,
			acquiredAt: Date.now(),
			timeoutMs: this.lockTimeoutMs,
			refCount: 1,
		});
		this._onDidChangeLocks.fire();

		return this.createReleaseFn(normalizedPath, agentId);
	}

	private createReleaseFn(filePath: string, agentId: string): () => void {
		let released = false;
		return () => {
			if (released) { return; } // guard against double-release
			const lock = this.locks.get(filePath);
			if (!lock || lock.agentId !== agentId) { return; }

			lock.refCount--;
			if (lock.refCount > 0) {
				// Still held by the same agent at an outer re-entrant level.
				this._onDidChangeLocks.fire();
				return;
			}

			released = true;
			this.locks.delete(filePath);
			this._onDidChangeLocks.fire();

			// Hand off to the next waiter, if any.
			this.processNextPending(filePath);
		};
	}

	/** Assigns the lock to the next queued waiter, or clears the pending list. */
	private processNextPending(filePath: string): void {
		const pending = this.pendingAcquisitions.get(filePath);
		if (!pending || pending.length === 0) { return; }

		const next = pending.shift()!;
		if (pending.length === 0) {
			this.pendingAcquisitions.delete(filePath);
		}
		this.locks.set(filePath, {
			filePath,
			agentId: next.agentId,
			acquiredAt: Date.now(),
			timeoutMs: this.lockTimeoutMs,
			refCount: 1,
		});
		this._onDidChangeLocks.fire();
		next.resolve();
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
				console.warn(`Lock expired for ${filePath} held by ${lock.agentId} (refCount=${lock.refCount})`);
				this.locks.delete(filePath);
				this._onDidChangeLocks.fire();

				// Reject all pending waiters for this path — the lock timed out while
				// an agent was holding it, so we cannot safely hand it to a waiter.
				// Each waiter should handle the rejection and retry if needed.
				const pending = this.pendingAcquisitions.get(filePath);
				if (pending && pending.length > 0) {
					this.pendingAcquisitions.delete(filePath);
					for (const waiter of pending) {
						waiter.reject(new Error(`Lock on ${filePath} was force-expired (held by ${lock.agentId}); retry acquisition`));
					}
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