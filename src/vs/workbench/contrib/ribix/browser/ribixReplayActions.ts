/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixReplayActions.ts
 *
 * Registers the `ribix.replayMission` command that:
 *   1. Lists available recordings via MissionReplayer.listRecordings()
 *   2. Shows a QuickPick so the engineer picks which mission to replay
 *   3. Opens the MissionReplayPanel (WebviewPanel) for the selected recording
 *      and auto-plays at 10× speed (controlled inside the panel's webview)
 *
 * Recordings are stored as `<missionId>.replay.jsonl` files in the VS Code
 * globalStorageHome/ribix-replay/ directory.  That directory is the same
 * `storageUri` passed to MissionRecorder.save() in ribixMissionService.ts.
 */

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { URI } from '../../../../base/common/uri.js';
import { MissionReplayer } from './missionReplay.js';
import { MissionReplayPanel } from './missionReplayPanel.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

export const RIBIX_REPLAY_MISSION_ACTION_ID = 'ribix.replayMission';

/** Sub-folder inside globalStorageHome where replay files are kept. */
const REPLAY_STORAGE_FOLDER = 'ribix-replay';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_REPLAY_MISSION_ACTION_ID,
			title: localize2('ribixReplayMission', 'Ribix: Replay Mission'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const profilesService = accessor.get(IUserDataProfilesService);
		const quickInputService = accessor.get(IQuickInputService);
		const openerService = accessor.get(IOpenerService);
		const notificationService = accessor.get(INotificationService);

		// Build the stable storage URI for replay files.
		const storageUri: URI = URI.joinPath(profilesService.defaultProfile.globalStorageHome, REPLAY_STORAGE_FOLDER);

		// Discover available recordings.
		const replayer = new MissionReplayer();
		let recordings: Awaited<ReturnType<MissionReplayer['listRecordings']>>;
		try {
			recordings = await replayer.listRecordings(storageUri);
		} catch {
			recordings = [];
		}

		if (recordings.length === 0) {
			notificationService.info('No mission recordings found. Recordings are created automatically when missions run.');
			return;
		}

		// Build QuickPick items — most-recent first (recordings are dir-order; sort by eventCount descending as rough proxy).
		const items = recordings.map(r => {
			const durationSec = Math.round(r.duration / 1000);
			return {
				label: r.missionId.substring(0, 8),
				description: `${r.eventCount} events · ${durationSec}s`,
				missionId: r.missionId,
			};
		});

		const picked = await quickInputService.pick(items, {
			placeHolder: 'Select a mission recording to replay',
			matchOnDescription: true,
		}) as (typeof items[number]) | undefined;

		if (!picked) { return; }

		try {
			await MissionReplayPanel.open(storageUri, picked.missionId, openerService);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			notificationService.error(`Failed to open replay for mission ${picked.missionId}: ${msg}`);
		}
	}
});
