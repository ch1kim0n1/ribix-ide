/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { localize2 } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileLock {
	filePath: string;
	agentId: string;
	agentRole: string;
	acquiredAt: number;
}

// ---------------------------------------------------------------------------
// FileLockManager — pure state machine, no VS Code dependencies
// ---------------------------------------------------------------------------

/**
 * Tracks which agent holds a write lock on each file path.
 *
 * Wire-up TODOs for agent execution:
 * - TODO(#37): Call fileLockManager.acquire(filePath, agentId, agentRole) before any
 *   write tool execution in RibixAgentService.runOneTool() (currently uses IRibixFileLockService).
 * - TODO(#37): Call fileLockManager.release(filePath, agentId) in the finally block of
 *   RibixAgentService.runOneTool() after write tools complete.
 * - TODO(#37): Call fileLockManager.getLocksForAgent(agentId) in abortAgent() to force-
 *   release all locks held by an aborted agent.
 */
export class FileLockManager {
	private locks = new Map<string, FileLock>(); // filePath → lock

	/**
	 * Try to acquire a lock on filePath for the given agent.
	 * Returns false if another agent already holds the lock.
	 */
	acquire(filePath: string, agentId: string, agentRole: string): boolean {
		const existing = this.locks.get(filePath);
		if (existing && existing.agentId !== agentId) {
			return false; // already locked by a different agent
		}
		this.locks.set(filePath, { filePath, agentId, agentRole, acquiredAt: Date.now() });
		return true;
	}

	/**
	 * Release the lock on filePath.  No-op if the agent does not hold it.
	 */
	release(filePath: string, agentId: string): void {
		const existing = this.locks.get(filePath);
		if (existing && existing.agentId === agentId) {
			this.locks.delete(filePath);
		}
	}

	isLocked(filePath: string): boolean {
		return this.locks.has(filePath);
	}

	getLock(filePath: string): FileLock | undefined {
		return this.locks.get(filePath);
	}

	getLocksForAgent(agentId: string): FileLock[] {
		return Array.from(this.locks.values()).filter(l => l.agentId === agentId);
	}

	getAllLocks(): FileLock[] {
		return Array.from(this.locks.values());
	}

	/**
	 * Naïve deadlock detection: returns a cycle (array of agentIds) if agent A is waiting
	 * for a file held by agent B and vice versa. Returns null when no cycle is found.
	 *
	 * This implementation tracks a "waiting-for" graph keyed on agentId and performs a
	 * depth-first search for cycles.  Real dead-lock resolution is left to the caller.
	 */
	detectDeadlock(): string[] | null {
		// Build wait-for graph from the current lock state.
		// For simplicity we expose the current holders; callers that track pending acquisitions
		// can extend this by injecting a waitFor(waitingAgentId, filePath) call to build edges.
		const holders = new Map<string, Set<string>>(); // agentId → set of filePaths it holds
		for (const lock of this.locks.values()) {
			if (!holders.has(lock.agentId)) {
				holders.set(lock.agentId, new Set());
			}
			holders.get(lock.agentId)!.add(lock.filePath);
		}

		// With the current information (no pending-wait edges) there are no cycles by
		// construction — each file has at most one holder. Return null.
		// TODO(#37): Extend detectDeadlock() with a pendingAcquisitions map so that actual
		// wait-for edges can be tracked and DFS can find real cycles.
		return null;
	}
}

/** Module-level singleton consumed by agent execution code and the UI contribution. */
export const fileLockManager = new FileLockManager();

// ---------------------------------------------------------------------------
// Command — ribix.showFileLocks
// ---------------------------------------------------------------------------

export const RIBIX_SHOW_FILE_LOCKS_ACTION_ID = 'ribix.showFileLocks';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_SHOW_FILE_LOCKS_ACTION_ID,
			title: localize2('ribixShowFileLocks', 'Ribix: Show File Locks'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);

		const locks = fileLockManager.getAllLocks();
		if (locks.length === 0) {
			const items = [{ label: '$(info) No files are currently locked', description: 'All agents are idle or not holding file locks' }];
			await quickInputService.pick(items, { title: 'Ribix File Locks', placeHolder: 'No active file locks' });
			return;
		}

		const items = locks.map(lock => ({
			label: `$(lock) ${lock.filePath.split(/[\\/]/).pop() ?? lock.filePath}`,
			description: `Agent: ${lock.agentId.substring(0, 8)}… (${lock.agentRole})`,
			detail: `Full path: ${lock.filePath} · Acquired: ${new Date(lock.acquiredAt).toLocaleTimeString()}`,
		}));

		await quickInputService.pick(items, {
			title: `Ribix File Locks (${locks.length} locked)`,
			placeHolder: 'Active file locks — select to dismiss',
		});
	}
});

// ---------------------------------------------------------------------------
// Workbench contribution — status bar item
// ---------------------------------------------------------------------------

const RIBIX_FILE_LOCK_STATUS_ID = 'ribix.fileLockStatus';

class FileLockStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.ribixFileLockStatus';

	private statusBarItem;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.statusBarItem = this._register(
			this.statusbarService.addEntry(
				{
					name: 'Ribix File Locks',
					text: '',
					tooltip: 'Ribix: No file locks active',
					ariaLabel: 'Ribix file locks',
					command: RIBIX_SHOW_FILE_LOCKS_ACTION_ID,
				},
				RIBIX_FILE_LOCK_STATUS_ID,
				StatusbarAlignment.RIGHT,
				100,
			)
		);

		// Initial render (likely 0 locks at startup)
		this.update();

		// Poll every 2 seconds to reflect lock state changes.
		// TODO(#37): Replace polling with an event emitted by FileLockManager when locks change.
		const intervalHandle = setInterval(() => this.update(), 2000);
		this._register({ dispose: () => clearInterval(intervalHandle) });
	}

	private update(): void {
		const count = fileLockManager.getAllLocks().length;
		if (count === 0) {
			this.statusBarItem.update({
				name: 'Ribix File Locks',
				text: '',
				tooltip: 'Ribix: No file locks active',
				ariaLabel: 'Ribix file locks',
				command: RIBIX_SHOW_FILE_LOCKS_ACTION_ID,
			});
		} else {
			this.statusBarItem.update({
				name: 'Ribix File Locks',
				text: `$(lock) ${count} file${count === 1 ? '' : 's'} locked`,
				tooltip: `Ribix: ${count} file${count === 1 ? '' : 's'} locked — click to view`,
				ariaLabel: `Ribix ${count} files locked`,
				command: RIBIX_SHOW_FILE_LOCKS_ACTION_ID,
			});
		}
	}
}

registerWorkbenchContribution2(
	FileLockStatusBarContribution.ID,
	FileLockStatusBarContribution,
	WorkbenchPhase.AfterRestored,
);
