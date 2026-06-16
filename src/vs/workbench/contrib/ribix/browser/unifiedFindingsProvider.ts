/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { IRibixBackendSseService, TaggedFinding } from './ribixBackendSseService.js';
import { AgentFinding } from '../common/ribixTypes.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FindingSource = 'mission' | 'backend';
export type FindingFilter = 'all' | 'mission' | 'backend';

export interface UnifiedFinding {
	id: string;
	sourceLabel: 'Mission' | 'Backend';
	source: FindingSource;
	severity: 'low' | 'medium' | 'high';
	file: string;
	line: number | null;
	message: string;
	findingType?: string;
	missionId?: string;   // set for mission findings
	cloudId?: string;     // set for backend findings
	receivedAt: number;   // ms timestamp
}

export interface BackendFinding {
	id: string;
	title: string;
	description: string;
	severity: string;
	type: string;
	affectedFiles: string[];
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IUnifiedFindingsProvider {
	readonly _serviceBrand: undefined;

	getFindings(): UnifiedFinding[];
	getFilter(): FindingFilter;
	setFilter(filter: FindingFilter): void;
	syncBackendFindings(apiUrl: string, token: string): Promise<BackendFinding[]>;
	startBackendStream(apiUrl: string, token: string, onFinding: (f: BackendFinding) => void): () => void;
	mergeFindings(missionFindings: AgentFinding[], missionId: string, backendFindings: BackendFinding[]): UnifiedFinding[];

	onDidChangeFindings: Event<void>;
}

export const IUnifiedFindingsProvider = createDecorator<IUnifiedFindingsProvider>('unifiedFindingsProvider');

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class UnifiedFindingsProvider extends Disposable implements IUnifiedFindingsProvider {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeFindings = new Emitter<void>();
	readonly onDidChangeFindings = this._onDidChangeFindings.event;

	/** Merged, deduplicated cache refreshed by rebuildCache(). */
	private unifiedCache: UnifiedFinding[] = [];
	/** Backend findings received from poll + SSE stream. */
	private backendFindingsCache: BackendFinding[] = [];
	/** Current active filter. */
	private filter: FindingFilter = 'all';
	/** Handle returned by setInterval for the poll loop. */
	private pollIntervalHandle: ReturnType<typeof setInterval> | null = null;

	private static readonly POLL_INTERVAL_MS = 60_000;

	constructor(
		@IRibixAuthService private readonly authService: IRibixAuthService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
		@IRibixBackendSseService private readonly backendSseService: IRibixBackendSseService,
	) {
		super();

		this._register(this._onDidChangeFindings);

		// Re-merge whenever mission state changes.
		this._register(
			this.missionService.onDidChangeMissions(() => {
				this.rebuildCache();
				this._onDidChangeFindings.fire();
			}),
		);

		// Merge cloud findings arriving over the live SSE stream.
		this._register(
			this.backendSseService.onDidReceiveCloudFinding((tagged: TaggedFinding) => {
				if (tagged.origin !== 'cloud') {
					return;
				}
				// Map the TaggedFinding to a BackendFinding and add to cache.
				const bf: BackendFinding = {
					id: tagged.cloudId ?? generateUuid(),
					title: tagged.message,
					description: tagged.message,
					severity: tagged.severity,
					type: tagged.findingType ?? 'code-architecture',
					affectedFiles: tagged.file ? [tagged.file] : [],
					createdAt: Date.now(),
				};
				// Deduplicate by id before appending.
				const existing = this.backendFindingsCache.findIndex(b => b.id === bf.id);
				if (existing >= 0) {
					this.backendFindingsCache[existing] = bf;
				} else {
					this.backendFindingsCache.push(bf);
				}
				this.rebuildCache();
				this._onDidChangeFindings.fire();
			}),
		);

		// Start initial poll immediately, then on a fixed interval.
		this.pollBackendFindings();
		this.pollIntervalHandle = setInterval(() => {
			this.pollBackendFindings();
		}, UnifiedFindingsProvider.POLL_INTERVAL_MS);
	}

	// ---------------------------------------------------------------------------
	// IUnifiedFindingsProvider
	// ---------------------------------------------------------------------------

	getFindings(): UnifiedFinding[] {
		switch (this.filter) {
			case 'mission':
				return this.unifiedCache.filter(f => f.source === 'mission');
			case 'backend':
				return this.unifiedCache.filter(f => f.source === 'backend');
			default:
				return this.unifiedCache.slice();
		}
	}

	getFilter(): FindingFilter {
		return this.filter;
	}

	setFilter(filter: FindingFilter): void {
		this.filter = filter;
		this._onDidChangeFindings.fire();
	}

	/**
	 * Fetch backend findings from GET /cli/findings.
	 * Returns an empty array on any error (network, auth, parse) — callers must not throw.
	 */
	async syncBackendFindings(apiUrl: string, token: string): Promise<BackendFinding[]> {
		try {
			const url = `${apiUrl.replace(/\/$/, '')}/cli/findings`;
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				console.warn(`UnifiedFindingsProvider: /cli/findings responded with ${response.status}`);
				return [];
			}

			const data = await response.json() as unknown;
			if (!Array.isArray(data)) {
				console.warn('UnifiedFindingsProvider: /cli/findings returned unexpected shape');
				return [];
			}

			return (data as BackendFinding[]).filter(item =>
				typeof item === 'object' && item !== null && typeof item.id === 'string',
			);
		} catch (e) {
			console.warn('UnifiedFindingsProvider: syncBackendFindings failed:', e);
			return [];
		}
	}

	/**
	 * Open an SSE connection to /cli/stream and call onFinding for each finding event.
	 * Returns a cleanup function that aborts the stream.
	 * Follows the same pattern as RibixApiClient.subscribeToFindingsStream.
	 */
	startBackendStream(apiUrl: string, token: string, onFinding: (f: BackendFinding) => void): () => void {
		const controller = new AbortController();
		const url = `${apiUrl.replace(/\/$/, '')}/cli/stream`;

		const run = async (): Promise<void> => {
			try {
				const response = await fetch(url, {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Accept': 'text/event-stream',
						'Content-Type': 'application/json',
					},
					signal: controller.signal,
				});

				if (!response.ok || !response.body) {
					console.warn(`UnifiedFindingsProvider: /cli/stream responded with ${response.status}`);
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					buffer += decoder.decode(value, { stream: true });

					// Process complete SSE message boundaries.
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventType = '';
					let eventData = '';

					for (const line of lines) {
						if (line.startsWith('event:')) {
							eventType = line.slice(6).trim();
						} else if (line.startsWith('data:')) {
							eventData += line.slice(5).trim();
						} else if (line === '' && eventData) {
							try {
								const parsed = JSON.parse(eventData) as unknown;
								if (
									eventType === 'finding' ||
									eventType === 'finding_discovered'
								) {
									const payload = parsed as { data?: BackendFinding } | BackendFinding;
									// Accept either { data: BackendFinding } or a bare BackendFinding.
									const finding = (payload as { data?: BackendFinding }).data ?? (payload as BackendFinding);
									if (finding && typeof finding.id === 'string') {
										onFinding(finding);
									}
								}
							} catch {
								// Malformed SSE event — skip silently.
							}
							eventType = '';
							eventData = '';
						}
					}
				}
			} catch (e: unknown) {
				if (e instanceof Error && e.name === 'AbortError') {
					// Normal cleanup — not an error.
					return;
				}
				console.warn('UnifiedFindingsProvider: stream error:', e);
			}
		};

		run();
		return () => controller.abort();
	}

	/**
	 * Convert mission findings and backend findings to a unified list.
	 * Mission and backend findings are assigned their respective source labels.
	 * Findings sharing the same id are deduplicated (newer receivedAt wins).
	 * Result is sorted by severity (high → medium → low) then by receivedAt descending.
	 */
	mergeFindings(missionFindings: AgentFinding[], missionId: string, backendFindings: BackendFinding[]): UnifiedFinding[] {
		const now = Date.now();
		const map = new Map<string, UnifiedFinding>();

		for (const f of missionFindings) {
			const id = generateUuid();
			const uf: UnifiedFinding = {
				id,
				sourceLabel: 'Mission',
				source: 'mission',
				severity: this.normalizeSeverity(f.severity),
				file: f.file,
				line: f.line,
				message: f.message,
				findingType: f.findingType,
				missionId,
				receivedAt: now,
			};
			// Mission findings always use generated IDs so they don't collide with backend IDs.
			map.set(id, uf);
		}

		for (const b of backendFindings) {
			const uf: UnifiedFinding = {
				id: b.id,
				sourceLabel: 'Backend',
				source: 'backend',
				severity: this.normalizeSeverity(b.severity),
				file: b.affectedFiles?.[0] ?? '',
				line: null,
				message: b.title + (b.description && b.description !== b.title ? ': ' + b.description : ''),
				findingType: b.type,
				cloudId: b.id,
				receivedAt: b.createdAt ?? now,
			};
			const existing = map.get(b.id);
			if (!existing || uf.receivedAt >= existing.receivedAt) {
				map.set(b.id, uf);
			}
		}

		return [...map.values()].sort((a, b) => {
			const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
			const aDiff = (severityRank[a.severity] ?? 1) - (severityRank[b.severity] ?? 1);
			if (aDiff !== 0) { return aDiff; }
			return b.receivedAt - a.receivedAt;
		});
	}

	// ---------------------------------------------------------------------------
	// Disposable
	// ---------------------------------------------------------------------------

	override dispose(): void {
		if (this.pollIntervalHandle !== null) {
			clearInterval(this.pollIntervalHandle);
			this.pollIntervalHandle = null;
		}
		super.dispose();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/**
	 * Poll the backend for findings if the user is signed in.
	 * Silently skips when not authenticated.
	 */
	private pollBackendFindings(): void {
		this.authService.getRequiredConfig().then(async config => {
			const results = await this.syncBackendFindings(config.apiUrl, config.accessToken);
			this.backendFindingsCache = results;
			this.rebuildCache();
			this._onDidChangeFindings.fire();
		}).catch(() => {
			// Not signed in or auth error — skip silently.
		});
	}

	/**
	 * Rebuild the unified cache from all missions and the current backend cache.
	 * Deduplicates across mission boundaries (same backend id wins with newer receivedAt).
	 */
	private rebuildCache(): void {
		const missions = this.missionService.getAllMissions();
		const globalMap = new Map<string, UnifiedFinding>();

		for (const mission of missions) {
			if (!mission.result) {
				continue;
			}

			// Map plain reviewer finding strings to AgentFinding shape.
			const missionFindings: AgentFinding[] = mission.result.reviewerFindings.map(text => ({
				severity: 'medium' as const,
				file: '',
				line: null,
				message: text,
			}));

			if (missionFindings.length === 0 && this.backendFindingsCache.length === 0) {
				continue;
			}

			const merged = this.mergeFindings(missionFindings, mission.id, this.backendFindingsCache);
			for (const uf of merged) {
				const existing = globalMap.get(uf.id);
				if (!existing || uf.receivedAt >= existing.receivedAt) {
					globalMap.set(uf.id, uf);
				}
			}
		}

		// When there are no completed missions, backend findings still surface.
		if (missions.every(m => !m.result) && this.backendFindingsCache.length > 0) {
			const backendOnly = this.mergeFindings([], '', this.backendFindingsCache);
			for (const uf of backendOnly) {
				if (!globalMap.has(uf.id)) {
					globalMap.set(uf.id, uf);
				}
			}
		}

		this.unifiedCache = [...globalMap.values()].sort((a, b) => {
			const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
			const aDiff = (severityRank[a.severity] ?? 1) - (severityRank[b.severity] ?? 1);
			if (aDiff !== 0) { return aDiff; }
			return b.receivedAt - a.receivedAt;
		});
	}

	/**
	 * Coerce any severity string to the canonical 'low' | 'medium' | 'high' union.
	 * Unknown values and backend p-codes fall through to a reasonable default.
	 */
	private normalizeSeverity(severity: string | undefined): 'low' | 'medium' | 'high' {
		switch (severity) {
			case 'high':
			case 'p0':
				return 'high';
			case 'low':
			case 'p2':
			case 'p3':
				return 'low';
			default:
				return 'medium';
		}
	}
}

registerSingleton(IUnifiedFindingsProvider, UnifiedFindingsProvider, InstantiationType.Delayed);
