/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { RibixApiClient } from '../common/ribixApiClient.js';
import { RibixAuthSession, RibixConfig, RibixAuthSummary, OAuthTokenResponse } from '../common/ribixAuthTypes.js';

const RIBIX_AUTH_SESSION_KEY = 'ribix.auth.session';
const RIBIX_AUTH_URLS_KEY = 'ribix.auth.urls';
const OAUTH_CLIENT_ID = 'ribix-ide';
const OAUTH_SCOPE = 'ide:memory';

interface StoredUrls {
	apiUrl: string;
	appUrl: string;
}

interface PendingSignIn {
	apiUrl: string;
	appUrl: string;
	codeVerifier: string;
	state: string;
	resolve: () => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

export interface IRibixAuthService {
	readonly _serviceBrand: undefined;

	// Auth state
	getAuthSummary(): Promise<RibixAuthSummary>;
	getCurrentSession(): Promise<RibixAuthSession | null>;
	getRequiredConfig(): Promise<RibixConfig>;

	// Auth actions
	signIn(params?: { apiUrl?: string; appUrl?: string }): Promise<void>;
	signOut(): Promise<void>;

	// Events
	onDidChangeSession: Event<RibixAuthSummary>;

	// Session management
	refreshToken(): Promise<RibixConfig>;
}

export const IRibixAuthService = createDecorator<IRibixAuthService>('ribixAuthService');

class RibixAuthService extends Disposable implements IRibixAuthService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = new Emitter<RibixAuthSummary>();
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private pendingSignIn: PendingSignIn | null = null;
	private authChannel: any;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// Use electron-main channel for PKCE token exchange (needs Node.js crypto)
		this.authChannel = mainProcessService.getChannel('void-channel-ribixAuth');
	}

	async getAuthSummary(): Promise<RibixAuthSummary> {
		const session = await this.getCurrentSession();
		if (!session) {
			return {
				status: 'signed_out',
				workspaceId: null,
				workspaceRole: null,
				githubInstallationId: null,
				expiresAt: null,
			};
		}

		const now = Date.now();
		const expiresAt = new Date(session.expiresAt).getTime();
		if (expiresAt <= now) {
			return {
				status: 'expired',
				workspaceId: session.workspaceId,
				workspaceRole: session.workspaceRole,
				githubInstallationId: session.githubInstallationId,
				expiresAt: session.expiresAt,
			};
		}

		return {
			status: 'signed_in',
			workspaceId: session.workspaceId,
			workspaceRole: session.workspaceRole,
			githubInstallationId: session.githubInstallationId,
			expiresAt: session.expiresAt,
		};
	}

	async getCurrentSession(): Promise<RibixAuthSession | null> {
		const stored = this.storageService.get(RIBIX_AUTH_SESSION_KEY, StorageScope.APPLICATION);
		if (!stored) {
			return null;
		}

		try {
			const decrypted = await this.encryptionService.decrypt(stored as string);
			return JSON.parse(decrypted) as RibixAuthSession;
		} catch (e) {
			console.error('Failed to decrypt auth session:', e);
			return null;
		}
	}

	async getRequiredConfig(): Promise<RibixConfig> {
		const session = await this.getCurrentSession();
		if (!session) {
			throw new Error('Not signed in. Please sign in to continue.');
		}

		const urls = await this.getUrls();
		const now = Date.now();
		const expiresAt = new Date(session.expiresAt).getTime();

		if (expiresAt <= now + 60_000) {
			return this.refreshToken();
		}

		return {
			apiUrl: urls.apiUrl,
			appUrl: urls.appUrl,
			...session,
		};
	}

	async signIn(params?: { apiUrl?: string; appUrl?: string }): Promise<void> {
		const existingUrls = await this.getUrls();
		const apiUrl = params?.apiUrl?.trim() || existingUrls.apiUrl?.trim();
		const appUrl = params?.appUrl?.trim() || existingUrls.appUrl?.trim() || apiUrl;

		if (!apiUrl || !appUrl) {
			throw new Error('Ribix needs an API URL and app URL before sign-in can start.');
		}

		await this.saveUrls({ apiUrl, appUrl });

		if (this.pendingSignIn) {
			throw new Error('Ribix sign-in is already in progress.');
		}

		// Generate PKCE code verifier and challenge via electron-main channel
		const { codeVerifier, codeChallenge, state } = await this.authChannel.call('generatePKCE');

		const authorizeUrl = new URL('/oauth/authorize', appUrl);
		authorizeUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
		authorizeUrl.searchParams.set('redirect_uri', this.buildRedirectUri());
		authorizeUrl.searchParams.set('response_type', 'code');
		authorizeUrl.searchParams.set('scope', OAUTH_SCOPE);
		authorizeUrl.searchParams.set('code_challenge', codeChallenge);
		authorizeUrl.searchParams.set('code_challenge_method', 'S256');
		authorizeUrl.searchParams.set('state', state);

		const completion = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingSignIn = null;
				reject(new Error('Ribix sign-in timed out before the browser completed the callback.'));
			}, 2 * 60 * 1000);

			this.pendingSignIn = {
				apiUrl,
				appUrl,
				codeVerifier,
				state,
				resolve,
				reject,
				timeout,
			};
		});

		// Open the authorization URL in the default browser
		await this.authChannel.call('openExternal', authorizeUrl.toString());
		await completion;
	}

	async signOut(): Promise<void> {
		this.pendingSignIn = null;
		this.storageService.remove(RIBIX_AUTH_SESSION_KEY, StorageScope.APPLICATION);
		const summary = await this.getAuthSummary();
		this._onDidChangeSession.fire(summary);
	}

	async refreshToken(): Promise<RibixConfig> {
		const session = await this.getCurrentSession();
		if (!session) {
			throw new Error('No session to refresh. Please sign in again.');
		}

		const urls = await this.getUrls();

		// Use electron-main channel for token refresh (needs Node.js crypto)
		try {
			const tokenResponse = await this.authChannel.call('refreshToken', {
				refreshToken: session.refreshToken,
				appUrl: urls.appUrl,
			}) as OAuthTokenResponse;

			const newSession: RibixAuthSession = {
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token,
				expiresAt: new Date(Date.now() + (tokenResponse.expires_in || 3600) * 1000).toISOString(),
				workspaceId: session.workspaceId,
				workspaceRole: session.workspaceRole,
				githubInstallationId: session.githubInstallationId,
				userId: session.userId,
			};

			await this.saveSession(newSession);

			// Verify the new session with the API
			const apiClient = new RibixApiClient();
			await apiClient.getSession({
				apiUrl: urls.apiUrl,
				appUrl: urls.appUrl,
				...newSession,
			});

			return {
				apiUrl: urls.apiUrl,
				appUrl: urls.appUrl,
				...newSession,
			};
		} catch (e) {
			// Refresh failed, clear session
			await this.signOut();
			throw new Error('Session expired. Please sign in again.');
		}
	}

	async handleOAuthCallback(code: string, state: string): Promise<void> {
		if (!this.pendingSignIn) {
			throw new Error('No sign-in in progress.');
		}

		const pending = this.pendingSignIn;

		if (state !== pending.state) {
			clearTimeout(pending.timeout);
			this.pendingSignIn = null;
			pending.reject(new Error('Ribix sign-in returned an unexpected OAuth state.'));
			return;
		}

		try {
			// Use electron-main channel for token exchange (needs Node.js crypto)
			const tokenResponse = await this.authChannel.call('exchangeCode', {
				code,
				codeVerifier: pending.codeVerifier,
				redirectUri: this.buildRedirectUri(),
				appUrl: pending.appUrl,
			}) as OAuthTokenResponse;

			const session = await this.buildSessionFromTokens({
				apiUrl: pending.apiUrl,
				appUrl: pending.appUrl,
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token,
				expiresIn: tokenResponse.expires_in,
			});

			await this.saveSession(session);
			clearTimeout(pending.timeout);
			this.pendingSignIn = null;
			pending.resolve();

			const summary = await this.getAuthSummary();
			this._onDidChangeSession.fire(summary);
		} catch (exchangeError) {
			clearTimeout(pending.timeout);
			this.pendingSignIn = null;
			pending.reject(
				exchangeError instanceof Error
					? exchangeError
					: new Error('Ribix sign-in could not complete.'),
			);
		}
	}

	private async saveSession(session: RibixAuthSession): Promise<void> {
		const encrypted = await this.encryptionService.encrypt(JSON.stringify(session));
		this.storageService.store(RIBIX_AUTH_SESSION_KEY, encrypted, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private async getUrls(): Promise<StoredUrls> {
		const stored = this.storageService.get(RIBIX_AUTH_URLS_KEY, StorageScope.APPLICATION);
		if (!stored) {
			return { apiUrl: '', appUrl: '' };
		}
		return JSON.parse(stored) as StoredUrls;
	}

	private async saveUrls(urls: StoredUrls): Promise<void> {
		this.storageService.store(RIBIX_AUTH_URLS_KEY, JSON.stringify(urls), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private buildRedirectUri(): string {
		// In a browser environment, this would be the actual callback URL
		// For now, we'll use a placeholder that the electron-main channel will handle
		return 'ribix-ide://oauth/callback';
	}

	private async buildSessionFromTokens(params: {
		apiUrl: string;
		appUrl: string;
		accessToken: string;
		refreshToken: string;
		expiresIn?: number;
	}): Promise<RibixAuthSession> {
		// Decode JWT payload to get claims
		const claims = this.decodeJwtPayload(params.accessToken);
		if (
			!claims.workspace_id ||
			!claims.workspace_role ||
			!claims.githubInstallationId ||
			!claims.sub ||
			typeof claims.exp !== 'number'
		) {
			throw new Error('Ribix returned incomplete OAuth claims.');
		}

		const session: RibixAuthSession = {
			accessToken: params.accessToken,
			refreshToken: params.refreshToken,
			expiresAt: new Date(claims.exp * 1000).toISOString(),
			workspaceId: claims.workspace_id,
			workspaceRole: claims.workspace_role,
			githubInstallationId: claims.githubInstallationId,
			userId: claims.sub,
		};

		// Verify session with API
		const apiClient = new RibixApiClient();
		await apiClient.getSession({
			apiUrl: params.apiUrl,
			appUrl: params.appUrl,
			...session,
		});

		return session;
	}

	private decodeJwtPayload(token: string): {
		exp?: number;
		workspace_id?: string;
		workspace_role?: string;
		githubInstallationId?: string;
		sub?: string;
	} {
		const payload = token.split('.')[1];
		if (!payload) {
			throw new Error('Ribix returned an invalid access token.');
		}

		try {
			return JSON.parse(this.base64UrlDecode(payload));
		} catch (e) {
			throw new Error('Failed to decode JWT payload.');
		}
	}

	private base64UrlDecode(base64Url: string): string {
		// Add padding if needed
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const paddedBase64 = base64 + padding;

		try {
			return atob(paddedBase64);
		} catch (e) {
			throw new Error('Failed to decode base64url string.');
		}
	}
}

registerSingleton(IRibixAuthService, RibixAuthService, InstantiationType.Delayed);