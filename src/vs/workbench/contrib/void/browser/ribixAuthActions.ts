/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { IURLService, IURLHandler, IOpenURLOptions } from '../../../../platform/url/common/url.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

export const RIBIX_SIGN_IN_ACTION_ID = 'ribix.auth.signIn';
export const RIBIX_SIGN_OUT_ACTION_ID = 'ribix.auth.signOut';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_SIGN_IN_ACTION_ID,
			title: localize2('ribixSignIn', 'Ribix: Sign In'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const auth = accessor.get(IRibixAuthService);
		const notificationService = accessor.get(INotificationService);

		try {
			await auth.signIn();
			notificationService.info('Successfully signed in to Ribix.');
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to sign in to Ribix.';
			notificationService.error(message);
		}
	}
});

// Register OAuth callback URL handler so ribix-ide://oauth/callback completes sign-in
class RibixOAuthURLHandlerContribution extends Disposable implements IURLHandler {
	static readonly ID = 'ribix.oauthUrlHandler';

	constructor(
		@IRibixAuthService private readonly authService: IRibixAuthService,
		@IURLService urlService: IURLService,
	) {
		super();
		this._register(urlService.registerHandler(this));
	}

	async handleURL(uri: URI, _options?: IOpenURLOptions): Promise<boolean> {
		if (uri.scheme !== 'ribix-ide' || uri.path !== '/oauth/callback') {
			return false;
		}
		const params = new URLSearchParams(uri.query);
		const code = params.get('code');
		const state = params.get('state');
		if (code && state) {
			await this.authService.handleOAuthCallback(code, state);
		}
		return true;
	}
}

registerWorkbenchContribution2(
	RibixOAuthURLHandlerContribution.ID,
	RibixOAuthURLHandlerContribution,
	WorkbenchPhase.BlockStartup
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_SIGN_OUT_ACTION_ID,
			title: localize2('ribixSignOut', 'Ribix: Sign Out'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const auth = accessor.get(IRibixAuthService);
		const notificationService = accessor.get(INotificationService);

		try {
			await auth.signOut();
			notificationService.info('Successfully signed out from Ribix.');
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to sign out from Ribix.';
			notificationService.error(message);
		}
	}
});