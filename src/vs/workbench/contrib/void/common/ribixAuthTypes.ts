/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { MemoryEntry } from './ribixTypes.js';

// Auth session types
export interface RibixAuthSession {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
	workspaceId: string;
	workspaceRole: string;
	githubInstallationId: string;
	userId: string;
}

export interface RibixConfig {
	apiUrl: string;
	appUrl: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
	workspaceId: string;
	workspaceRole: string;
	githubInstallationId: string;
	userId: string;
}

export interface RibixAuthSummary {
	status: 'signed_out' | 'signed_in' | 'expired';
	workspaceId: string | null;
	workspaceRole: string | null;
	githubInstallationId: string | null;
	expiresAt: string | null;
}

// API request/response types
export interface SyncMemoryRequest {
	workspaceId: string;
	entries: MemoryEntry[];
}

export interface SyncMemoryResponse {
	mergedEntries: MemoryEntry[];
	conflictsResolved: number;
}

export interface CreatePRRequest {
	workspaceId: string;
	branchName: string;
	title: string;
	description: string;
	baseBranch?: string;
}

export interface CreatePRResponse {
	prUrl: string;
	prNumber: number;
}

export interface GetOrgMemoryRequest {
	workspaceId: string;
}

export interface GetOrgMemoryResponse {
	entries: MemoryEntry[];
}

export interface GetMissionsRequest {
	workspaceId: string;
	limit?: number;
	offset?: number;
}

export interface GetMissionsResponse {
	missions: {
		id: string;
		outcome: string;
		state: string;
		createdAt: number;
		completedAt: number | null;
		result: {
			summary: string;
			filesChanged: string[];
			testReport: string | null;
			reviewerFindings: string[];
			commitSha: string | null;
			prUrl: string | null;
		} | null;
	}[];
	total: number;
}

// OAuth types
export interface OAuthTokenRequest {
	grant_type: 'authorization_code' | 'refresh_token';
	client_id: string;
	code?: string;
	redirect_uri?: string;
	code_verifier?: string;
	refresh_token?: string;
}

export interface OAuthTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in?: number;
}

export interface OAuthAuthorizeParams {
	client_id: string;
	redirect_uri: string;
	response_type: 'code';
	scope: string;
	code_challenge: string;
	code_challenge_method: 'S256';
	state: string;
}