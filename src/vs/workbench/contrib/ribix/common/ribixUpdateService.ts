/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { RibixCheckUpdateResponse } from './ribixUpdateServiceTypes.js';



export interface IRibixUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<RibixCheckUpdateResponse>;
}


export const IRibixUpdateService = createDecorator<IRibixUpdateService>('RibixUpdateService');


// implemented by calling channel
export class RibixUpdateService implements IRibixUpdateService {

	readonly _serviceBrand: undefined;
	private readonly ribixUpdateService: IRibixUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.ribixUpdateService = ProxyChannel.toService<IRibixUpdateService>(mainProcessService.getChannel('ribix-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IRibixUpdateService['check'] = async (explicit) => {
		const res = await this.ribixUpdateService.check(explicit)
		return res
	}
}

registerSingleton(IRibixUpdateService, RibixUpdateService, InstantiationType.Eager);


