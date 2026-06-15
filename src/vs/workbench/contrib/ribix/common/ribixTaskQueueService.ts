/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export interface IRibixTaskQueueService {
	readonly _serviceBrand: undefined;
	enqueue<T>(fn: (token: CancellationToken) => Promise<T>, priority?: number): Promise<T>;
	cancelAll(): void;
	onDidChangeQueue: Event<void>;
	readonly pendingCount: number;
	readonly runningCount: number;
}

export const IRibixTaskQueueService = createDecorator<IRibixTaskQueueService>('ribixTaskQueueService');

interface QueuedTask<T> {
	id: string;
	fn: (token: CancellationToken) => Promise<T>;
	priority: number;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
	tokenSource: CancellationTokenSource;
}

class RibixTaskQueueService extends Disposable implements IRibixTaskQueueService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeQueue = new Emitter<void>();
	readonly onDidChangeQueue = this._onDidChangeQueue.event;

	private queue: QueuedTask<any>[] = [];
	/** Running tasks keyed by id, value is the task (so we can cancel its token). */
	private runningTasks: Map<string, QueuedTask<any>> = new Map();
	private maxConcurrent: number = 4;

	constructor() {
		super();
	}

	get pendingCount(): number {
		return this.queue.length;
	}

	get runningCount(): number {
		return this.runningTasks.size;
	}

	async enqueue<T>(fn: (token: CancellationToken) => Promise<T>, priority: number = 0): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const tokenSource = new CancellationTokenSource();
			const task: QueuedTask<T> = {
				id: generateUuid(),
				fn,
				priority,
				resolve,
				reject,
				tokenSource,
			};

			this.queue.push(task);
			// Sort by priority (higher first)
			this.queue.sort((a, b) => b.priority - a.priority);
			this._onDidChangeQueue.fire();

			this.processQueue();
		});
	}

	cancelAll(): void {
		// Cancel and reject all pending (queued but not started) tasks.
		for (const task of this.queue) {
			task.tokenSource.cancel();
			task.reject(new Error('Task cancelled'));
		}
		this.queue = [];

		// Signal cancellation to all running tasks via their CancellationToken.
		// The executing fn is responsible for observing token.isCancellationRequested;
		// we cannot force-terminate already-running async work, but the token gives
		// them the cooperative cancellation signal.
		for (const task of this.runningTasks.values()) {
			task.tokenSource.cancel();
		}

		this._onDidChangeQueue.fire();
	}

	private async processQueue(): Promise<void> {
		while (this.runningTasks.size < this.maxConcurrent && this.queue.length > 0) {
			const task = this.queue.shift()!;
			this.runningTasks.set(task.id, task);
			this._onDidChangeQueue.fire();

			this.executeTask(task).finally(() => {
				this.runningTasks.delete(task.id);
				this._onDidChangeQueue.fire();
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

registerSingleton(IRibixTaskQueueService, RibixTaskQueueService, InstantiationType.Delayed);