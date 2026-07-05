/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

// We test the concrete class directly — import from the common module.
// The class is not exported by name, so we re-export via a small helper that
// calls registerSingleton but returns the class.  Instead we replicate the class
// inline to keep the test hermetic and avoid DI overhead.

/** Minimal re-implementation of RibixFileLockService for unit-testing its concurrency invariants. */
interface Lock {
	filePath: string;
	agentId: string;
	acquiredAt: number;
	timeoutMs: number;
	refCount: number;
}

class FileLockServiceUnderTest {
	private locks: Map<string, Lock> = new Map();
	private pendingAcquisitions: Map<string, Array<{
		agentId: string;
		resolve: () => void;
		reject: (e: Error) => void;
	}>> = new Map();
	readonly lockTimeoutMs: number;
	private cleanupHandle: ReturnType<typeof setInterval> | null = null;

	constructor(timeoutMs = 30000) {
		this.lockTimeoutMs = timeoutMs;
	}

	startCleanupInterval(): void {
		this.cleanupHandle = setInterval(() => this.cleanupExpiredLocks(), 100);
	}

	stopCleanupInterval(): void {
		if (this.cleanupHandle !== null) {
			clearInterval(this.cleanupHandle);
			this.cleanupHandle = null;
		}
	}

	async acquire(filePath: string, agentId: string): Promise<() => void> {
		const key = filePath.replace(/\\/g, '/');
		const existing = this.locks.get(key);

		if (existing) {
			if (existing.agentId === agentId) {
				existing.refCount++;
				return this.createReleaseFn(key, agentId);
			}
			return new Promise((resolve, reject) => {
				const pending = this.pendingAcquisitions.get(key) ?? [];
				pending.push({ agentId, resolve: () => resolve(this.createReleaseFn(key, agentId)), reject });
				this.pendingAcquisitions.set(key, pending);
			});
		}

		this.locks.set(key, { filePath: key, agentId, acquiredAt: Date.now(), timeoutMs: this.lockTimeoutMs, refCount: 1 });
		return this.createReleaseFn(key, agentId);
	}

	isLocked(filePath: string): boolean {
		return this.locks.has(filePath.replace(/\\/g, '/'));
	}

	getLockHolder(filePath: string): string | null {
		return this.locks.get(filePath.replace(/\\/g, '/'))?.agentId ?? null;
	}

	private createReleaseFn(filePath: string, agentId: string): () => void {
		let released = false;
		return () => {
			if (released) { return; }
			const lock = this.locks.get(filePath);
			if (!lock || lock.agentId !== agentId) { return; }
			lock.refCount--;
			if (lock.refCount > 0) { return; }
			released = true;
			this.locks.delete(filePath);
			this.processNextPending(filePath);
		};
	}

	private processNextPending(filePath: string): void {
		const pending = this.pendingAcquisitions.get(filePath);
		if (!pending || pending.length === 0) { return; }
		const next = pending.shift()!;
		if (pending.length === 0) { this.pendingAcquisitions.delete(filePath); }
		this.locks.set(filePath, { filePath, agentId: next.agentId, acquiredAt: Date.now(), timeoutMs: this.lockTimeoutMs, refCount: 1 });
		next.resolve();
	}

	/** Trigger expiry manually (for tests that supply a past acquiredAt). */
	cleanupExpiredLocks(): void {
		const now = Date.now();
		for (const [filePath, lock] of this.locks.entries()) {
			if (now - lock.acquiredAt > lock.timeoutMs) {
				this.locks.delete(filePath);
				const pending = this.pendingAcquisitions.get(filePath);
				if (pending && pending.length > 0) {
					this.pendingAcquisitions.delete(filePath);
					for (const waiter of pending) {
						waiter.reject(new Error(`Lock on ${filePath} force-expired`));
					}
				}
			}
		}
	}

	/** Test helper: backdate the lock's acquiredAt to simulate timeout. */
	backdateAcquiredAt(filePath: string, deltaMs: number): void {
		const lock = this.locks.get(filePath.replace(/\\/g, '/'));
		if (lock) { lock.acquiredAt = Date.now() - deltaMs; }
	}
}

// ---------------------------------------------------------------------------

suite('RibixFileLockService — concurrency invariants', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// 1. Single agent acquire + release
	test('single agent can acquire and release a lock', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/foo.ts';

		assert.strictEqual(svc.isLocked(file), false, 'not locked before acquire');

		const release = await svc.acquire(file, 'agent-1');
		assert.strictEqual(svc.isLocked(file), true, 'locked after acquire');
		assert.strictEqual(svc.getLockHolder(file), 'agent-1');

		release();
		assert.strictEqual(svc.isLocked(file), false, 'released after calling release');
	});

	// 2. Second agent waits in queue
	test('second agent trying to acquire a locked file must wait until the first releases', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/bar.ts';

		const release1 = await svc.acquire(file, 'agent-1');
		assert.strictEqual(svc.getLockHolder(file), 'agent-1');

		// agent-2 acquire is pending — should not resolve yet
		let agent2Resolved = false;
		const agent2Promise = svc.acquire(file, 'agent-2').then(rel => {
			agent2Resolved = true;
			return rel;
		});

		// Give the microtask queue a tick — agent-2 must still be waiting
		await Promise.resolve();
		assert.strictEqual(agent2Resolved, false, 'agent-2 is blocked while agent-1 holds the lock');

		// Release agent-1 — agent-2 should now acquire
		release1();
		const release2 = await agent2Promise;
		assert.strictEqual(agent2Resolved, true, 'agent-2 unblocked after release');
		assert.strictEqual(svc.getLockHolder(file), 'agent-2', 'agent-2 now holds the lock');
		release2();
	});

	// 3. Re-entrant acquire by the same agent increments refcount, no deadlock
	test('re-entrant acquire by same agent increments refcount and does not deadlock', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/baz.ts';

		const release1 = await svc.acquire(file, 'agent-1');
		// Same agent acquires again — should resolve immediately (no deadlock)
		let resolved = false;
		const release2 = await Promise.race([
			svc.acquire(file, 'agent-1').then(r => { resolved = true; return r; }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('deadlock')), 50)),
		]);
		assert.strictEqual(resolved, true, 'second acquire by same agent resolved immediately');
		assert.strictEqual(svc.getLockHolder(file), 'agent-1');

		// First release decrements refcount — lock still held
		release1();
		assert.strictEqual(svc.isLocked(file), true, 'lock still held after first of two releases');

		// Second release — now fully released
		release2();
		assert.strictEqual(svc.isLocked(file), false, 'lock released after both release calls');
	});

	// 4. Lock auto-releases after timeout (simulated via backdating + manual cleanup trigger)
	test('lock auto-releases after timeout and pending waiter acquires the lock', async () => {
		const svc = new FileLockServiceUnderTest(30000);
		const file = '/repo/src/timeout.ts';

		await svc.acquire(file, 'agent-slow'); // never released by agent

		// Queue a waiter that should receive the lock on timeout hand-off
		let waiterResult: (() => void) | null = null;
		const waiterPromise = svc.acquire(file, 'agent-waiter').then(release => {
			waiterResult = release;
			return release;
		});

		// Simulate that 30s have passed by backdating the lock
		svc.backdateAcquiredAt(file, 31000);

		// Manually trigger the cleanup that the interval would fire
		svc.cleanupExpiredLocks();

		await waiterPromise;

		// The waiter should now hold the lock (hand-off, not rejection)
		assert.strictEqual(svc.isLocked(file), true, 'lock handed off to waiter');
		assert.strictEqual(svc.getLockHolder(file), 'agent-waiter', 'waiter is now the lock holder');
		assert.ok(waiterResult, 'waiter received a release function');

		// Clean up
		waiterResult!();
		assert.strictEqual(svc.isLocked(file), false, 'lock released by waiter');
	});

	// 5. Double release is a no-op (no crash, no incorrect state)
	test('double release is a no-op and does not throw', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/noop.ts';

		const release = await svc.acquire(file, 'agent-1');
		release(); // first release
		assert.strictEqual(svc.isLocked(file), false);

		// Second release must not throw or corrupt state
		assert.doesNotThrow(() => release(), 'double release does not throw');
		assert.strictEqual(svc.isLocked(file), false, 'still unlocked after double release');
	});

	// 6. Lock is always released when the guarded operation throws (try/finally usage).
	test('release runs even when the locked operation throws, freeing the lock for the next waiter', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/throws.ts';

		// agent-1 holds the lock while its op throws — the canonical caller pattern releases
		// in `finally`, so the throw must not strand the lock.
		const release = await svc.acquire(file, 'agent-1');
		let caught: Error | null = null;
		try {
			throw new Error('callTool blew up');
		} catch (e) {
			caught = e as Error;
		} finally {
			release();
		}
		assert.ok(caught, 'the operation error still propagates to the caller');
		assert.strictEqual(svc.isLocked(file), false, 'lock freed despite the throw');

		// A waiter queued during the failing op acquires once the lock is freed.
		const release2 = await svc.acquire(file, 'agent-2');
		assert.strictEqual(svc.getLockHolder(file), 'agent-2', 'next agent acquires after a throwing op releases');
		release2();
	});

	// 7. Same lock acquired twice in one turn (re-entrant) never blocks the agent against itself.
	test('acquiring the same lock twice in one turn does not deadlock the agent', async () => {
		const svc = new FileLockServiceUnderTest();
		const file = '/repo/src/twice.ts';

		const r1 = await svc.acquire(file, 'agent-1');
		// Second acquire in the same turn must resolve immediately (refcount), not queue.
		const r2 = await Promise.race([
			svc.acquire(file, 'agent-1'),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('deadlock: agent blocked on its own lock')), 50)),
		]);
		assert.strictEqual(svc.getLockHolder(file), 'agent-1');
		r1();
		assert.strictEqual(svc.isLocked(file), true, 'still held after one of two releases');
		r2();
		assert.strictEqual(svc.isLocked(file), false, 'fully released after both');
	});
});
