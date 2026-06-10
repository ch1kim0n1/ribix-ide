/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { RibixConfig, SyncMemoryRequest, SyncMemoryResponse, CreatePRRequest, CreatePRResponse, GetOrgMemoryRequest, GetOrgMemoryResponse, GetMissionsRequest, GetMissionsResponse } from './ribixAuthTypes.js';

export class RibixApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message?: string,
	) {
		super(message ?? code);
		this.name = 'RibixApiError';
	}
}

type JsonBody = unknown;

function buildHeaders(config: RibixConfig, requestId: string): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		'Authorization': `Bearer ${config.accessToken}`,
		'x-ribix-request-id': requestId,
	};
}

async function parsePayload(response: Response): Promise<unknown> {
	const text = await response.text().catch(() => '');
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

export class RibixApiClient {
	constructor(private readonly fetchImpl: typeof fetch = fetch) {}

	async syncMemory(config: RibixConfig, request: SyncMemoryRequest): Promise<SyncMemoryResponse> {
		return this.post<SyncMemoryResponse>(
			config,
			'/api/v1/memory/sync',
			request,
		);
	}

	async createPR(config: RibixConfig, request: CreatePRRequest): Promise<CreatePRResponse> {
		return this.post<CreatePRResponse>(
			config,
			'/api/v1/pr/create',
			request,
		);
	}

	async getOrgMemory(config: RibixConfig, request: GetOrgMemoryRequest): Promise<GetOrgMemoryResponse> {
		return this.get<GetOrgMemoryResponse>(
			config,
			`/api/v1/memory/org?workspaceId=${encodeURIComponent(request.workspaceId)}`,
		);
	}

	async getMissions(config: RibixConfig, request: GetMissionsRequest): Promise<GetMissionsResponse> {
		const params = new URLSearchParams();
		params.set('workspaceId', request.workspaceId);
		if (request.limit !== undefined) {
			params.set('limit', request.limit.toString());
		}
		if (request.offset !== undefined) {
			params.set('offset', request.offset.toString());
		}
		return this.get<GetMissionsResponse>(
			config,
			`/api/v1/missions?${params.toString()}`,
		);
	}

	async getSession(config: RibixConfig): Promise<{
		clientId: string;
		workspaceId: string;
		workspaceRole: string;
		githubInstallationId: string;
		scopes: string[];
		userId: string;
	}> {
		const requestId = generateUuid();
		const response = await this.fetchImpl(
			`${config.apiUrl.replace(/\/$/, '')}/api/v1/session`,
			{
				method: 'GET',
				headers: buildHeaders(config, requestId),
			},
		);
		const payload = await parsePayload(response);

		if (!response.ok) {
			const code =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error?: unknown }).error ?? 'unknown_error')
					: `http_${response.status}`;

			throw new RibixApiError(
				response.status,
				code,
				typeof payload === 'string'
					? payload
					: `Ribix session request failed with ${response.status}.`,
			);
		}

		return payload as {
			clientId: string;
			workspaceId: string;
			workspaceRole: string;
			githubInstallationId: string;
			scopes: string[];
			userId: string;
		};
	}

	private async post<T>(config: RibixConfig, path: string, body: JsonBody): Promise<T> {
		const requestId = generateUuid();
		const response = await this.fetchImpl(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
			method: 'POST',
			headers: buildHeaders(config, requestId),
			body: JSON.stringify(body),
		});
		const payload = await parsePayload(response);

		if (!response.ok) {
			const code =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error?: unknown }).error ?? 'unknown_error')
					: `http_${response.status}`;

			throw new RibixApiError(
				response.status,
				code,
				typeof payload === 'string'
					? payload
					: `Ribix request failed with ${response.status}.`,
			);
		}

		return payload as T;
	}

	private async get<T>(config: RibixConfig, path: string): Promise<T> {
		const requestId = generateUuid();
		const response = await this.fetchImpl(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
			method: 'GET',
			headers: buildHeaders(config, requestId),
		});
		const payload = await parsePayload(response);

		if (!response.ok) {
			const code =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error?: unknown }).error ?? 'unknown_error')
					: `http_${response.status}`;

			throw new RibixApiError(
				response.status,
				code,
				typeof payload === 'string'
					? payload
					: `Ribix request failed with ${response.status}.`,
			);
		}

		return payload as T;
	}
}