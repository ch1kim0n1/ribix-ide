/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

/**
 * Hermetic replica of RibixTaskQueueService with a configurable concurrency limit.
 * Mirrors the real implementation in ribixTaskQueueService.ts so tests are
 * structurally equivalent without pulling in the DI/singleton machinery.
 */
interface QueuedTask<T> {
	id: string;
	fn: (token: CancellationToken) => Promise<T>;
	priority: number;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
	tokenSource: CancellationTokenSource;
}

class TaskQueueUnderTest {
	private queue: QueuedTask<any>[] = [];
	private runningTasks: Map<string, QueuedTask<any>> = new Map();
	private readonly maxConcurrent: number;

	constructor(maxConcurrent = 4) {
		this.maxConcurrent = maxConcurrent;
	}

	get pendingCount(): number { return this.queue.length; }
	get runningCount(): number { return this.runningTasks.size; }

	async enqueue<T>(fn: (token: CancellationToken) => Promise<T>, priority = 0): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const tokenSource = new CancellationTokenSource();
			const task: QueuedTask<T> = { id: generateUuid(), fn, priority, resolve, reject, tokenSource };
			this.queue.push(task);
			this.queue.sort((a, b) => b.priority - a.priority);
			this.processQueue();
		});
	}

	cancelAll(): void {
		for (const task of this.queue) {
			task.tokenSource.cancel();
			task.reject(new Error('Task cancelled'));
		}
		this.queue = [];
		for (const task of this.runningTasks.values()) {
			task.tokenSource.cancel();
		}
	}

	private processQueue(): void {
		while (this.runningTasks.size < this.maxConcurrent && this.queue.length > 0) {
			const task = this.queue.shift()!;
			this.runningTasks.set(task.id, task);
			this.executeTask(task).finally(() => {
				this.runningTasks.delete(task.id);
				this.processQueue();
			});
		}
	}

	private async executeTask<T>(task: QueuedTask<T>): Promise<void> {
		try {
			const result = await task.fn(task.tokenSource.token);
			task.resolve(result);
		} catch (error) {
			task.reject(error);
		}
	}
}

// ---------------------------------------------------------------------------

suite('RibixTaskQueueService — priority, cancellation, sequencing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// 1. Tasks execute in priority order (highest priority first)
	test('tasks execute in priority order (highest priority first)', async () => {
		// Use maxConcurrent=1 so all tasks are queued before any runs.
		// We gate release with a promise so the first task blocks until we check order.
		let releaseFirst!: () => void;
		const firstTaskRunning = new Promise<void>(res => {
			releaseFirst = res;
		});

		const order: number[] = [];
		const svc = new TaskQueueUnderTest(1);

		// First task: blocks until we release it, records its priority
		let unblockFirst!: () => void;
		const firstBlocker = new Promise<void>(res => { unblockFirst = res; });

		const t1 = svc.enqueue(async (_token) => {
			releaseFirst(); // signal "first is running"
			await firstBlocker;
			order.push(10);
		}, 10);

		// Wait until t1 is actually running before enqueuing lower-priority tasks
		await firstTaskRunning;

		// These are queued while t1 is running; they should execute in priority order after t1 finishes
		const t3 = svc.enqueue(async (_token) => { order.push(3); }, 3);
		const t5 = svc.enqueue(async (_token) => { order.push(5); }, 5);
		const t1b = svc.enqueue(async (_token) => { order.push(1); }, 1);

		// Unblock t1 — the remaining tasks should run highest-priority-first
		unblockFirst();
		await Promise.all([t1, t3, t5, t1b]);

		// t1 ran first (priority 10, already started), then 5, then 3, then 1
		assert.deepStrictEqual(order, [10, 5, 3, 1], 'queued tasks ran in descending priority order');
	});

	// 2. cancelAll() signals cancellation to running tasks
	test('cancelAll() cancels running tasks by signalling their CancellationToken', async () => {
		const svc = new TaskQueueUnderTest(1);
		let capturedToken: CancellationToken | null = null;

		// Enqueue a task that never resolves on its own — it just exposes its token
		let unblock!: () => void;
		const blocker = new Promise<void>(res => { unblock = res; });

		const taskPromise = svc.enqueue(async (token) => {
			capturedToken = token;
			await blocker;
		}).catch(() => { /* cancelled */ });

		// Allow the task to start and capture its token
		await new Promise<void>(res => setImmediate(res));

		assert.ok(capturedToken, 'task started and token was captured');
		assert.strictEqual(capturedToken!.isCancellationRequested, false, 'not yet cancelled');

		svc.cancelAll();
		unblock(); // let the async fn resume so Node can clean up

		await taskPromise;

		assert.strictEqual(capturedToken!.isCancellationRequested, true, 'token was cancelled after cancelAll()');
	});

	// 3. Cancelled task does not prevent subsequent tasks from running
	test('a cancelled task does not block subsequent tasks', async () => {
		const svc = new TaskQueueUnderTest(1);

		// Enqueue a task that will be cancelled; record whether it ran
		let firstStarted = false;
		let secondRan = false;

		let unblockFirst!: () => void;
		const firstBlocker = new Promise<void>(res => { unblockFirst = res; });

		const t1 = svc.enqueue(async (_token) => {
			firstStarted = true;
			await firstBlocker;
		}).catch(() => { /* swallow cancel */ });

		await new Promise<void>(res => setImmediate(res));
		assert.ok(firstStarted, 'first task started');

		// Enqueue a second task before cancelling
		const t2 = svc.enqueue(async (_token) => {
			secondRan = true;
		});

		// Cancel all — first task token is signalled, second is removed from queue
		svc.cancelAll();
		unblockFirst();
		await t1;

		// Re-enqueue the second task directly (cancelAll removed it from queue)
		const t2b = svc.enqueue(async (_token) => { secondRan = true; });
		await t2b;

		assert.strictEqual(secondRan, true, 'subsequent task ran after cancellation');

		// t2 was removed by cancelAll — it should have been rejected
		let t2Rejected = false;
		await t2.catch(() => { t2Rejected = true; });
		assert.strictEqual(t2Rejected, true, 'queued task was rejected by cancelAll');
	});

	// 4. Queue processes tasks sequentially when maxConcurrent=1
	test('queue processes tasks sequentially (no overlap) when maxConcurrent=1', async () => {
		const svc = new TaskQueueUnderTest(1);
		const concurrentOverlap: number[] = [];
		let running = 0;
		let maxRunning = 0;

		const makeTask = () => async (_token: CancellationToken) => {
			running++;
			if (running > maxRunning) { maxRunning = running; }
			concurrentOverlap.push(running);
			// yield to allow other tasks to potentially interleave
			await new Promise<void>(res => setImmediate(res));
			running--;
		};

		await Promise.all([
			svc.enqueue(makeTask()),
			svc.enqueue(makeTask()),
			svc.enqueue(makeTask()),
			svc.enqueue(makeTask()),
		]);

		assert.strictEqual(maxRunning, 1, 'never more than 1 task running at once');
		assert.strictEqual(concurrentOverlap.length, 4, 'all 4 tasks executed');
		// All recorded values should be exactly 1 (no concurrency)
		assert.ok(concurrentOverlap.every(v => v === 1), 'each task ran with running=1 (sequential)');
	});
});
