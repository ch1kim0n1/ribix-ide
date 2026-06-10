/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { OAuthTokenResponse } from '../common/ribixAuthTypes.js';

const OAUTH_CLIENT_ID = 'ribix-ide';

export class RibixAuthChannel implements IServerChannel {
	constructor(
		@IOpenerService private readonly openerService: IOpenerService,
	) {}

	listen(_: unknown, event: string): unknown {
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'generatePKCE') {
				return this.generatePKCE();
			}
			else if (command === 'exchangeCode') {
				return this.exchangeAuthorizationCode(params);
			}
			else if (command === 'refreshToken') {
				return this.refreshToken(params);
			}
			else if (command === 'openExternal') {
				return this.openExternal(params);
			}
			else {
				throw new Error(`Ribix auth channel: command "${command}" not recognized.`);
			}
		}
		catch (e) {
			console.error('Ribix auth channel: Call Error:', e);
			throw e;
		}
	}

	private generatePKCE(): { codeVerifier: string; codeChallenge: string; state: string } {
		const codeVerifier = randomBytes(32).toString('base64url');
		const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
		const state = randomBytes(16).toString('hex');

		return {
			codeVerifier,
			codeChallenge,
			state,
		};
	}

	private async exchangeAuthorizationCode(params: {
		code: string;
		codeVerifier: string;
		redirectUri: string;
		appUrl: string;
	}): Promise<OAuthTokenResponse> {
		const tokenUrl = new URL('/oauth/token', params.appUrl);

		const response = await fetch(tokenUrl.toString(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: OAUTH_CLIENT_ID,
				code: params.code,
				redirect_uri: params.redirectUri,
				code_verifier: params.codeVerifier,
			}),
		});

		const tokenPayload = (await response.json().catch(() => null)) as
			| OAuthTokenResponse
			| { error?: string }
			| null;

		if (!response.ok || !tokenPayload || !('access_token' in tokenPayload)) {
			const errorCode =
				tokenPayload && typeof tokenPayload === 'object' && 'error' in tokenPayload
					? String(tokenPayload.error ?? 'unknown_error')
					: 'unknown_error';
			throw new Error(`Ribix sign-in token exchange failed: ${errorCode}`);
		}

		return tokenPayload;
	}

	private async refreshToken(params: { refreshToken: string; appUrl: string }): Promise<OAuthTokenResponse> {
		const tokenUrl = new URL('/oauth/token', params.appUrl);

		const response = await fetch(tokenUrl.toString(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: OAUTH_CLIENT_ID,
				refresh_token: params.refreshToken,
			}),
		});

		const payload = (await response.json().catch(() => null)) as
			| OAuthTokenResponse
			| { error?: string }
			| null;

		if (!response.ok || !payload || !('access_token' in payload)) {
			const errorCode =
				payload && typeof payload === 'object' && 'error' in payload
					? String(payload.error ?? 'unknown_error')
					: 'unknown_error';
			throw new Error(`Ribix token refresh failed: ${errorCode}`);
		}

		return payload;
	}

	private async openExternal(url: string): Promise<void> {
		await this.openerService.open(URI.parse(url));
	}
}