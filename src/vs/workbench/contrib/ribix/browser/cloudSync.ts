/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface MissionRecord {
	id: string;
	title: string;
	status: string;
	createdAt: string;
	agentCount: number;
}

export interface CodebaseGraph {
	workspaceId: string;
	/** Map of file path → list of symbol/owner identifiers for that file. */
	files: Record<string, string[]>;
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Backend endpoint paths (relative to apiUrl)
//
// TODO: Verify / create these routes in the backend (../Ribix or ribix-backend):
//   POST /cli/workspace/mission-history
//     Body:   { workspaceId: string; missions: MissionRecord[] }
//     Result: 200 OK | 4xx/5xx on error
//
//   GET  /cli/workspace/mission-history?workspaceId=<id>
//     Result: { missions: MissionRecord[] }
//
//   POST /cli/workspace/codebase-graph
//     Body:   CodebaseGraph
//     Result: 200 OK | 4xx/5xx on error
//
//   GET  /cli/workspace/codebase-graph?workspaceId=<id>
//     Result: CodebaseGraph | null
// ---------------------------------------------------------------------------

const ENDPOINTS = {
	missionHistory: '/cli/workspace/mission-history',
	codebaseGraph: '/cli/workspace/codebase-graph',
} as const;

export class RibixCloudSync {
	constructor(
		private readonly apiUrl: string,
		private readonly token: string,
	) {}

	// ---------------------------------------------------------------------------
	// Mission history
	// ---------------------------------------------------------------------------

	/**
	 * Pushes the full mission history for the current workspace to the backend.
	 * Silently no-ops when the token or apiUrl are empty.
	 */
	async pushMissionHistory(missions: MissionRecord[]): Promise<void> {
		if (!this.token || !this.apiUrl) {
			return;
		}
		await this._post(ENDPOINTS.missionHistory, { missions });
	}

	/**
	 * Fetches mission history for the current workspace from the backend.
	 * Returns an empty array on network or parse errors.
	 */
	async pullMissionHistory(): Promise<MissionRecord[]> {
		if (!this.token || !this.apiUrl) {
			return [];
		}
		try {
			const response = await this._get(ENDPOINTS.missionHistory);
			const body = await response.json() as { missions?: MissionRecord[] };
			return Array.isArray(body.missions) ? body.missions : [];
		} catch (e) {
			console.warn('RibixCloudSync.pullMissionHistory: error', e);
			return [];
		}
	}

	// ---------------------------------------------------------------------------
	// Codebase graph
	// ---------------------------------------------------------------------------

	/**
	 * Pushes a codebase ownership graph snapshot to the backend.
	 * Silently no-ops when the token or apiUrl are empty.
	 */
	async pushCodebaseGraph(graph: CodebaseGraph): Promise<void> {
		if (!this.token || !this.apiUrl) {
			return;
		}
		await this._post(ENDPOINTS.codebaseGraph, graph);
	}

	/**
	 * Fetches the stored codebase graph for this workspace.
	 * Returns null when none exists or on errors.
	 */
	async pullCodebaseGraph(): Promise<CodebaseGraph | null> {
		if (!this.token || !this.apiUrl) {
			return null;
		}
		try {
			const response = await this._get(ENDPOINTS.codebaseGraph);
			if (response.status === 404) {
				return null;
			}
			return await response.json() as CodebaseGraph;
		} catch (e) {
			console.warn('RibixCloudSync.pullCodebaseGraph: error', e);
			return null;
		}
	}

	// ---------------------------------------------------------------------------
	// HTTP helpers
	// ---------------------------------------------------------------------------

	private _buildHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.token}`,
		};
	}

	private async _post(path: string, body: unknown): Promise<Response> {
		const url = `${this.apiUrl}${path}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: this._buildHeaders(),
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`RibixCloudSync POST ${path} failed: ${response.status}`);
		}
		return response;
	}

	private async _get(path: string): Promise<Response> {
		const url = `${this.apiUrl}${path}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: this._buildHeaders(),
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(`RibixCloudSync GET ${path} failed: ${response.status}`);
		}
		return response;
	}
}

// ---------------------------------------------------------------------------
// Wire-up TODOs
// ---------------------------------------------------------------------------
//
// TODO (ribixMissionService.ts — completeMission):
//   After successfully completing a mission, push history to the backend:
//
//   const config = await this.authService.getRequiredConfig();
//   const sync = new RibixCloudSync(config.apiUrl, config.accessToken);
//   const missions = this.getAllMissions().map(m => ({
//     id: m.id, title: m.outcome, status: m.status,
//     createdAt: new Date(m.createdAt).toISOString(), agentCount: m.tasks?.length ?? 0,
//   }));
//   sync.pushMissionHistory(missions).catch(e => console.warn('cloudSync push failed:', e));
//
// TODO (ribixMissionService.ts — constructor / _loadPromise callback):
//   After missions are loaded and the user is authenticated, pull history from
//   the backend to hydrate missions from other devices:
//
//   const summary = await this.authService.getAuthSummary();
//   if (summary.status === 'signed_in') {
//     const config = await this.authService.getRequiredConfig();
//     const sync = new RibixCloudSync(config.apiUrl, config.accessToken);
//     const remote = await sync.pullMissionHistory();
//     // Merge remote records that don't exist locally.
//   }
// ---------------------------------------------------------------------------
