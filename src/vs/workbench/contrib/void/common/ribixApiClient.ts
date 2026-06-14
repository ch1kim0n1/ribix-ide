/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { RibixConfig, SyncMemoryRequest, SyncMemoryResponse, CreatePRRequest, CreatePRResponse, GetOrgMemoryRequest, GetOrgMemoryResponse, GetMissionsRequest, GetMissionsResponse, SubmitFindingsRequest, SubmitFindingsResponse, SubmittedFinding } from './ribixAuthTypes.js';
import { AgentFinding, RiskLevel } from './ribixTypes.js';

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

	/**
	 * Map an IDE RiskLevel to a backend severity code.
	 * 'high' → 'p0', 'medium' → 'p1', 'low' → 'p2'. Unknown input defaults to 'p3'.
	 */
	private static mapSeverity(severity: RiskLevel | string): 'p0' | 'p1' | 'p2' | 'p3' {
		switch (severity) {
			case 'high': return 'p0';
			case 'medium': return 'p1';
			case 'low': return 'p2';
			default: return 'p3';
		}
	}

	/**
	 * Submit IDE-generated findings to the backend after a mission completes.
	 * Maps AgentFinding[] → SubmittedFinding[] and POST to /cli/findings/submit.
	 */
	async submitFindings(
		config: RibixConfig,
		repoFullName: string,
		findings: AgentFinding[],
		missionId: string,
	): Promise<SubmitFindingsResponse> {
		const mapped: SubmittedFinding[] = findings.map(f => ({
			title: f.message.substring(0, 120),
			description: f.message,
			severity: RibixApiClient.mapSeverity(f.severity),
			type: f.findingType ?? 'code-architecture',
			source: 'ide' as const,
			affectedFiles: f.file ? [f.file] : [],
			evidence: f.line !== null ? `${f.file}:${f.line}` : f.file,
			agentType: 'reviewer',
			missionId,
		}));

		const request: SubmitFindingsRequest = { repoFullName, findings: mapped };
		return this.post<SubmitFindingsResponse>(config, '/cli/findings/submit', request);
	}

	/**
	 * Subscribe to the backend SSE stream for cloud-originated findings.
	 * Calls onFinding for each finding event, onError on stream errors.
	 * Returns a cleanup function that aborts the stream.
	 *
	 * Non-blocking by design: if the backend is unreachable, onError is called
	 * with the error and the stream silently stops — the IDE continues normally.
	 */
	subscribeToFindingsStream(
		config: RibixConfig,
		repoFullName: string,
		onFinding: (finding: import('./ribixAuthTypes.js').CloudFinding) => void,
		onError?: (error: Error) => void,
	): () => void {
		const controller = new AbortController();
		const url = `${config.apiUrl.replace(/\/$/, '')}/cli/findings/stream?repoFullName=${encodeURIComponent(repoFullName)}`;

		const run = async (): Promise<void> => {
			try {
				const requestId = generateUuid();
				const response = await this.fetchImpl(url, {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${config.accessToken}`,
						'Accept': 'text/event-stream',
						'x-ribix-request-id': requestId,
					},
					signal: controller.signal,
				});

				if (!response.ok || !response.body) {
					const msg = `Findings stream responded with ${response.status}`;
					onError?.(new Error(msg));
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					buffer += decoder.decode(value, { stream: true });

					// Process complete SSE lines
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventData = '';
					for (const line of lines) {
						if (line.startsWith('data:')) {
							eventData += line.slice(5).trim();
						} else if (line === '' && eventData) {
							try {
								const finding = JSON.parse(eventData) as import('./ribixAuthTypes.js').CloudFinding;
								onFinding(finding);
							} catch {
								// Malformed SSE event — skip
							}
							eventData = '';
						}
					}
				}
			} catch (e: unknown) {
				if (e instanceof Error && e.name === 'AbortError') {
					// Normal cleanup — not an error
					return;
				}
				onError?.(e instanceof Error ? e : new Error(String(e)));
			}
		};

		run();
		return () => controller.abort();
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