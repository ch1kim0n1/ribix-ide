/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import Severity from '../../../../base/common/severity.js';
import { localize2 } from '../../../../nls.js';
import { AutoTriggerMode, IRibixChangeWatcherService } from './ribixChangeWatcherService.js';

const CYCLE_ACTION_ID = 'ribix.autoTrigger.cycleMode';

const NEXT_MODE: Record<AutoTriggerMode, AutoTriggerMode> = {
	off: 'ask',
	ask: 'auto',
	auto: 'off',
};

const MODE_LABEL: Record<AutoTriggerMode, string> = {
	off: 'off (manual only)',
	ask: 'ask (prepare, await approval)',
	auto: 'auto (run unattended)',
};

/**
 * Cycles the auto-on-change trigger mode off -> ask -> auto -> off. Surfaced in the
 * Command Palette and intended to back a toggle in the Command Center header. Uses a
 * non-blocking Info toast to confirm the new mode (never a modal).
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CYCLE_ACTION_ID,
			f1: true,
			title: localize2('ribixCycleAutoTrigger', 'Ribix: Cycle Auto-on-Change Mode'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const watcher = accessor.get(IRibixChangeWatcherService);
		const notification = accessor.get(INotificationService);
		const next = NEXT_MODE[watcher.mode];
		watcher.setMode(next);
		notification.notify({
			severity: Severity.Info,
			message: `Ribix auto-on-change: ${MODE_LABEL[next]}.`,
		});
	}
});
