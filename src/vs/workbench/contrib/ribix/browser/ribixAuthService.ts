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
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { RibixApiClient, RibixApiError } from '../common/ribixApiClient.js';
import { RibixAuthSession, RibixConfig, RibixAuthSummary, OAuthTokenResponse } from '../common/ribixAuthTypes.js';

/**
 * #113: Typed, catchable error thrown when an authenticated config is required
 * but no valid session exists. Consumers (memory-sync, release/PR) already wrap
 * calls in try/catch and can `instanceof`-check this to tell "not signed in"
 * apart from transport failures.
 */
export class RibixAuthRequiredError extends Error {
	constructor(message = 'Sign in to Ribix to continue.') {
		super(message);
		this.name = 'RibixAuthRequiredError';
	}
}

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

	/**
	 * #113: Run an authenticated request with automatic single-retry on a 401.
	 * Passes a fresh config to `request`; if it throws a 401 RibixApiError, forces
	 * exactly one token refresh and retries once. A second 401 (or a failed refresh)
	 * surfaces a clean re-auth error so the caller can prompt sign-in once.
	 */
	requestWithAuth<T>(request: (config: RibixConfig) => Promise<T>): Promise<T>;

	// OAuth callback — called by the URL protocol handler when ribix-ide://oauth/callback fires
	handleOAuthCallback(code: string, state: string): Promise<void>;
}

export const IRibixAuthService = createDecorator<IRibixAuthService>('ribixAuthService');

class RibixAuthService extends Disposable implements IRibixAuthService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = new Emitter<RibixAuthSummary>();
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private pendingSignIn: PendingSignIn | null = null;
	private authChannel: IChannel;
	// #90: Proactive token refresh timer — refreshes 5 minutes before expiry.
	private refreshTimer: NodeJS.Timeout | null = null;
	private static readonly REFRESH_LEAD_TIME_MS = 5 * 60 * 1000; // 5 minutes
	// #113: Single in-flight refresh shared by all callers so concurrent requests
	// hitting an expired token trigger exactly one token exchange.
	private refreshInFlight: Promise<RibixConfig> | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		// Use electron-main channel for PKCE token exchange (needs Node.js crypto)
		this.authChannel = mainProcessService.getChannel('ribix-channel-ribixAuth');
	}

	async getAuthSummary(): Promise<RibixAuthSummary> {
		const session = await this.getCurrentSession();
		if (!session) {
			return {
				status: 'signed_out',
				isSignedIn: false,
				workspaceId: null,
				workspaceRole: null,
				githubInstallationId: null,
				expiresAt: null,
				plan: null,
			};
		}

		const now = Date.now();
		const expiresAt = new Date(session.expiresAt).getTime();
		if (expiresAt <= now) {
			return {
				status: 'expired',
				isSignedIn: false,
				workspaceId: session.workspaceId,
				workspaceRole: session.workspaceRole,
				githubInstallationId: session.githubInstallationId,
				expiresAt: session.expiresAt,
				plan: session.plan ?? null,
			};
		}

		return {
			status: 'signed_in',
			isSignedIn: true,
			workspaceId: session.workspaceId,
			workspaceRole: session.workspaceRole,
			githubInstallationId: session.githubInstallationId,
			expiresAt: session.expiresAt,
			plan: session.plan ?? null,
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
			this.logService.error('Failed to decrypt auth session:', e);
			return null;
		}
	}

	async getRequiredConfig(): Promise<RibixConfig> {
		const session = await this.getCurrentSession();
		if (!session) {
			throw new RibixAuthRequiredError('Sign in to Ribix to create a pull request.');
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
		const { codeVerifier, codeChallenge, state } = await this.authChannel.call<{ codeVerifier: string; codeChallenge: string; state: string }>('generatePKCE');

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
		// #90: Clear proactive refresh timer on sign-out.
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.storageService.remove(RIBIX_AUTH_SESSION_KEY, StorageScope.APPLICATION);
		const summary = await this.getAuthSummary();
		this._onDidChangeSession.fire(summary);
	}

	async refreshToken(): Promise<RibixConfig> {
		// #113: Coalesce concurrent refreshes — share a single in-flight exchange.
		// All callers awaiting an expired token resolve from the same promise, so
		// the token endpoint (and its refresh-token rotation) is hit exactly once.
		if (this.refreshInFlight) {
			return this.refreshInFlight;
		}
		const inFlight = this.doRefresh().finally(() => {
			this.refreshInFlight = null;
		});
		this.refreshInFlight = inFlight;
		return inFlight;
	}

	async requestWithAuth<T>(request: (config: RibixConfig) => Promise<T>): Promise<T> {
		const config = await this.getRequiredConfig();
		try {
			return await request(config);
		} catch (e) {
			if (e instanceof RibixApiError && e.status === 401) {
				// Hard 401 with a token we believed valid — force exactly one refresh
				// and retry once. Any failure here surfaces a clean re-auth error.
				let fresh: RibixConfig;
				try {
					fresh = await this.refreshToken();
				} catch {
					throw new RibixAuthRequiredError('Your Ribix session expired. Please sign in again.');
				}
				try {
					return await request(fresh);
				} catch (retryError) {
					if (retryError instanceof RibixApiError && retryError.status === 401) {
						throw new RibixAuthRequiredError('Your Ribix session expired. Please sign in again.');
					}
					throw retryError;
				}
			}
			throw e;
		}
	}

	private async doRefresh(): Promise<RibixConfig> {
		const session = await this.getCurrentSession();
		if (!session) {
			throw new RibixAuthRequiredError('Your Ribix session expired. Please sign in again.');
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
				plan: session.plan ?? 'free',
			};

			await this.saveSession(newSession);

			// #90: Schedule next proactive refresh.
			this.scheduleProactiveRefresh(newSession.expiresAt);

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

	/**
	 * #90: Schedule a proactive token refresh before the token expires.
	 * Fires REFRESH_LEAD_TIME_MS before the expiry time. If the token
	 * has already expired or is very close to expiry, refresh immediately.
	 */
	private scheduleProactiveRefresh(expiresAtIso: string): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}

		const expiresAt = new Date(expiresAtIso).getTime();
		const refreshAt = expiresAt - RibixAuthService.REFRESH_LEAD_TIME_MS;
		const delay = refreshAt - Date.now();

		if (delay <= 0) {
			// Token expires very soon — refresh immediately.
			this.refreshToken().catch(() => { /* silent — getValidConfig will retry */ });
			return;
		}

		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			this.refreshToken().catch(() => { /* silent — getValidConfig will retry */ });
		}, delay);
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

		// #113: PKCE state/verifier are single-use. Consume the pending sign-in
		// before the async token exchange so a replayed callback (same code/state)
		// finds no pending sign-in and is rejected by the guard above.
		clearTimeout(pending.timeout);
		this.pendingSignIn = null;

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
			pending.resolve();

			// #90: Schedule proactive token refresh before expiry.
			this.scheduleProactiveRefresh(session.expiresAt);

			const summary = await this.getAuthSummary();
			this._onDidChangeSession.fire(summary);
		} catch (exchangeError) {
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
		return 'ribix-ide://ribix.ribix-ide/oauth/callback';
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
			plan: 'free',
		};

		// Verify session with API and fetch plan
		const apiClient = new RibixApiClient();
		const sessionData = await apiClient.getSession({
			apiUrl: params.apiUrl,
			appUrl: params.appUrl,
			...session,
		});
		session.plan = (sessionData.plan as import('../common/ribixAuthTypes.js').RibixPlan) ?? 'free';

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