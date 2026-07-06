/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixGdprActions.ts
 *
 * #150: Registers the `ribix.deleteAllAgentRunData` command that implements the
 * GDPR right-to-be-forgotten for local agent run data. When invoked, it:
 *   1. Shows a confirmation dialog (deletion is irreversible).
 *   2. Calls IRibixAgentService.deleteAllAgentRunData() which clears:
 *      - In-memory completed/failed agents
 *      - Queued agent spawn requests
 *      - Persisted JSON files on disk (globalStorageHome/ribix-agent-runs/)
 *      - Workspace storage index
 *   3. Notifies the user on success.
 *
 * This command does NOT abort currently-running agents. Users should abort active
 * missions first if they want a complete wipe.
 */

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IRibixAgentService } from './ribixAgentService.js';

export const RIBIX_DELETE_AGENT_DATA_ACTION_ID = 'ribix.deleteAllAgentRunData';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_DELETE_AGENT_DATA_ACTION_ID,
			title: localize2('ribixDeleteAgentRunData', 'Ribix: Delete All Local Agent Run Data (GDPR)'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const notificationService = accessor.get(INotificationService);
		const agentService = accessor.get(IRibixAgentService);

		// Confirm — deletion is irreversible.
		const confirmed = await dialogService.confirm({
			title: 'Delete All Local Agent Run Data',
			message: 'This will permanently delete all completed and failed agent run records stored on this machine, including persisted JSON files and workspace storage entries. This action cannot be undone. Currently running agents will not be affected.',
			primaryButton: 'Delete',
			type: 'warning',
		});

		if (!confirmed.confirmed) {
			return;
		}

		try {
			await agentService.deleteAllAgentRunData();
			notificationService.info('All local agent run data has been deleted.');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			notificationService.error(`Failed to delete agent run data: ${msg}`);
		}
	}
});
