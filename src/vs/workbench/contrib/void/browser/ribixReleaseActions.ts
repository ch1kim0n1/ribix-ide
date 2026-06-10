/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { localize2 } from '../../../../nls.js';

const PREPARE_RELEASE_ACTION_ID = 'ribix.prepareRelease';

registerAction2(class extends Action2 {
	constructor(
	) {
		super({
			id: PREPARE_RELEASE_ACTION_ID,
			f1: true,
			title: localize2('ribixPrepareRelease', 'Ribix: Prepare Release'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const missionService = accessor.get(IRibixMissionService);

		// For now, we'll prepare release for the most recently completed mission
		// In a full UI implementation, this would be triggered from a specific mission card
		const missions = missionService.getAllMissions();
		const completedMission = missions.find(m => m.state === 'complete');

		if (!completedMission) {
			throw new Error('No completed mission found to prepare release for');
		}

		await missionService.prepareRelease(completedMission.id);
	}
});