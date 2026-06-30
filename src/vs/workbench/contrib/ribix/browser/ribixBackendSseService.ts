/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IRibixSCMService } from '../common/ribixSCMTypes.js';
import { RibixApiClient } from '../common/ribixApiClient.js';
import { CloudFinding } from '../common/ribixAuthTypes.js';
import { AgentFinding, AgentFindingType } from '../common/ribixTypes.js';
import { IRibixMissionService } from './ribixMissionService.js';

/**
 * An IDE finding enriched with an origin badge so the UI can distinguish
 * locally-produced findings ('ide') from cloud-delivered ones ('cloud').
 */
export type TaggedFinding = AgentFinding & {
	/** 'ide' = produced by a local agent run; 'cloud' = received from backend SSE */
	origin: 'ide' | 'cloud';
	/** Opaque backend ID, present only for cloud findings */
	cloudId?: string;
};

/**
 * A mid-run destructive-action approval request surfaced by the backend (#107).
 * The agent wants to perform a destructive action (e.g. click DELETE on /account)
 * against a production target and is paused until the engineer approves or rejects.
 */
export type DestructiveApprovalRequest = {
	/** Opaque backend id used to send the approval/rejection back. */
	approvalId: string;
	missionId: string | null;
	/** The action the agent wants to perform, e.g. "click DELETE". */
	action: string;
	/** The target the action would hit, e.g. "/account" or a full URL. */
	target: string;
	/** Risk tier from the backend classifier, e.g. "prod", "staging", "low". */
	tier: string;
	/** Human-readable reasoning for why this was classified destructive. */
	reasoning: string;
};

/** The engineer's response to a destructive-action approval request (#107). */
export type DestructiveApprovalDecision = 'approve' | 'reject' | 'reject_all';

/** The app-states the FAFO engine can reach during a user-qa run (#108). */
export type AppStateKind =
	| 'empty'
	| 'loading'
	| 'error'
	| '404'
	| 'offline'
	| 'first-run'
	| 'post-delete'
	| 'validation-failed';

/** All app-states tracked by the state-coverage view, in display order (#108). */
export const ALL_APP_STATES: readonly AppStateKind[] = [
	'empty', 'loading', 'error', '404', 'offline', 'first-run', 'post-delete', 'validation-failed',
];

/** A single state-coverage entry: a state the run reached and how it scored (#108). */
export type StateCoverageEntry = {
	missionId: string | null;
	state: AppStateKind;
	/** Vision critique score 0–100 (higher is better). */
	score: number;
	/** Optional path to a thumbnail screenshot of the reached state. */
	screenshotPath?: string;
	/** Optional critique detail shown when the state is opened. */
	critique?: string;
};

export interface IRibixBackendSseService {
	readonly _serviceBrand: undefined;

	/**
	 * Emitted whenever a new cloud finding arrives over the SSE stream.
	 * Listeners can merge these into whatever store renders the activity feed.
	 */
	onDidReceiveCloudFinding: Event<TaggedFinding>;

	/**
	 * Attach IDE-origin findings with the 'ide' badge so they share the same
	 * TaggedFinding type used by the activity feed.
	 */
	tagIdeFindings(findings: AgentFinding[]): TaggedFinding[];

	/**
	 * Explicitly start the SSE subscription for the current workspace.
	 * Called automatically on construction if auth + workspace are ready;
	 * can be called again after a sign-in to re-establish the stream.
	 * No-op if already subscribed for the same repo.
	 */
	ensureSubscribed(): Promise<void>;

	/**
	 * Fired whenever the set of pending destructive-action approvals (#107) or the
	 * collected state-coverage entries (#108) change, so the Command Center UI re-renders.
	 */
	onDidChangeRunEvents: Event<void>;

	/** Currently-pending destructive-action approval requests (#107). */
	getPendingDestructiveApprovals(): DestructiveApprovalRequest[];

	/** State-coverage entries collected for a mission's user-qa run (#108). */
	getStateCoverage(missionId: string): StateCoverageEntry[];

	/**
	 * Send the engineer's decision for a destructive-action approval back to the backend (#107),
	 * then drop it from the pending set. 'reject_all' additionally tells the backend to skip all
	 * further destructive actions for the remainder of this run.
	 */
	respondToDestructiveApproval(approvalId: string, decision: DestructiveApprovalDecision): Promise<void>;
}

export const IRibixBackendSseService = createDecorator<IRibixBackendSseService>('ribixBackendSseService');

export class RibixBackendSseService extends Disposable implements IRibixBackendSseService {
	readonly _serviceBrand: undefined;

	private readonly _onDidReceiveCloudFinding = new Emitter<TaggedFinding>();
	readonly onDidReceiveCloudFinding = this._onDidReceiveCloudFinding.event;

	private readonly _onDidChangeRunEvents = new Emitter<void>();
	readonly onDidChangeRunEvents = this._onDidChangeRunEvents.event;

	/** Pending destructive-action approvals keyed by approvalId (#107). */
	private pendingApprovals = new Map<string, DestructiveApprovalRequest>();
	/** State-coverage entries keyed by missionId (#108). */
	private stateCoverage = new Map<string, StateCoverageEntry[]>();

	private ribixSCM: IRibixSCMService;
	private currentRepoFullName: string | null = null;
	private cancelStream: (() => void) | null = null;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IRibixAuthService private readonly authService: IRibixAuthService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
	) {
		super();
		this._register(this._onDidReceiveCloudFinding);
		this._register(this._onDidChangeRunEvents);
		this.ribixSCM = ProxyChannel.toService<IRibixSCMService>(mainProcessService.getChannel('ribix-channel-scm'));

		// Attempt to subscribe on construction; failures are suppressed.
		this.ensureSubscribed().catch(e => {
			console.warn('RibixBackendSseService: initial subscription failed:', e);
		});

		// Re-subscribe whenever auth state changes (e.g. sign-in after IDE open)
		this._register(
			this.authService.onDidChangeSession(() => {
				this.cancelCurrentStream();
				this.ensureSubscribed().catch(e => {
					console.warn('RibixBackendSseService: re-subscription failed after auth change:', e);
				});
			}),
		);
	}

	tagIdeFindings(findings: AgentFinding[]): TaggedFinding[] {
		return findings.map(f => ({ ...f, origin: 'ide' as const }));
	}

	getPendingDestructiveApprovals(): DestructiveApprovalRequest[] {
		return [...this.pendingApprovals.values()];
	}

	getStateCoverage(missionId: string): StateCoverageEntry[] {
		return this.stateCoverage.get(missionId) ?? [];
	}

	async respondToDestructiveApproval(approvalId: string, decision: DestructiveApprovalDecision): Promise<void> {
		const request = this.pendingApprovals.get(approvalId);
		// Drop optimistically so the panel clears even if the round-trip is slow.
		this.pendingApprovals.delete(approvalId);
		this._onDidChangeRunEvents.fire();

		try {
			const config = await this.authService.getRequiredConfig();
			const apiClient = new RibixApiClient();
			await apiClient.respondToApproval(config, {
				approvalId,
				decision,
				missionId: request?.missionId ?? undefined,
			});
		} catch (e) {
			console.warn('respondToDestructiveApproval: failed to send decision:', e);
		}
	}

	async ensureSubscribed(): Promise<void> {
		// Resolve auth config — skip silently if not signed in
		let config;
		try {
			config = await this.authService.getRequiredConfig();
		} catch {
			return;
		}

		// Resolve workspace path
		const workspacePath = this.getWorkspacePath();
		if (!workspacePath) {
			return;
		}

		// Resolve repoFullName
		let repoFullName: string | null = null;
		try {
			const remoteUrl = await this.ribixSCM.gitRemoteUrl(workspacePath);
			repoFullName = this.parseRepoFullName(remoteUrl);
		} catch {
			return; // No git remote — skip
		}

		if (!repoFullName) {
			return;
		}

		// Already subscribed to this repo
		if (this.currentRepoFullName === repoFullName && this.cancelStream !== null) {
			return;
		}

		// Cancel any previous stream
		this.cancelCurrentStream();
		this.currentRepoFullName = repoFullName;

		const apiClient = new RibixApiClient();
		this.cancelStream = apiClient.subscribeToFindingsStream(
			config,
			repoFullName,
			(cloudFinding: CloudFinding) => {
				const tagged = this.mapCloudFinding(cloudFinding);
				this._onDidReceiveCloudFinding.fire(tagged);
			},
			(error: Error) => {
				console.warn('RibixBackendSseService: stream error:', error);
				// Clear so ensureSubscribed() can retry on next call
				this.cancelStream = null;
				this.currentRepoFullName = null;
			},
			(type: string, payload: unknown) => {
				this.handleSseEvent(type, payload);
			},
		);
	}

	override dispose(): void {
		this.cancelCurrentStream();
		super.dispose();
	}

	private cancelCurrentStream(): void {
		if (this.cancelStream) {
			this.cancelStream();
			this.cancelStream = null;
		}
		this.currentRepoFullName = null;
	}

	private getWorkspacePath(): string | null {
		try {
			const workspace = this.workspaceContextService.getWorkspace();
			if (workspace.folders.length > 0) {
				return workspace.folders[0].uri.fsPath;
			}
		} catch {
			// ignore
		}
		return null;
	}

	private parseRepoFullName(remoteUrl: string): string | null {
		if (!remoteUrl) { return null; }
		const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
		if (sshMatch) { return sshMatch[1]; }
		const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
		if (httpsMatch) { return httpsMatch[1]; }
		return null;
	}

	/** Map a CloudFinding (backend shape) to a TaggedFinding (IDE shape). */
	private mapCloudFinding(cf: CloudFinding): TaggedFinding {
		// Map backend severity string to IDE RiskLevel
		let severity: 'low' | 'medium' | 'high' = 'medium';
		if (cf.severity === 'p0' || cf.severity === 'high') {
			severity = 'high';
		} else if (cf.severity === 'p2' || cf.severity === 'p3' || cf.severity === 'low') {
			severity = 'low';
		}

		// Map backend type to AgentFindingType if possible
		const knownTypes: AgentFindingType[] = [
			'data-loss-risk',
			'rate-limit-blind',
			'env-parity',
			'third-party-resilience',
			'legal-compliance',
			'copy-consistency',
			'observability-gap',
			'day-2-failure',
			'code-architecture',
			'onboarding-drop-off',
		];
		const findingType: AgentFindingType | undefined = knownTypes.includes(cf.type as AgentFindingType)
			? (cf.type as AgentFindingType)
			: undefined;

		const affectedFile = cf.affectedFiles?.[0] ?? '';

		return {
			severity,
			file: affectedFile,
			line: null,
			message: cf.title + (cf.description && cf.description !== cf.title ? ': ' + cf.description : ''),
			findingType,
			origin: 'cloud',
			cloudId: cf.id,
		};
	}

	/**
	 * Dispatch typed SSE events received from the findings stream.
	 * Handles finding:approved and finding:rejected to update mission state.
	 */
	private handleSseEvent(type: string, payload: unknown): void {
		if (typeof payload !== 'object' || payload === null) { return; }
		const data = (payload as { data?: unknown }).data;
		if (typeof data !== 'object' || data === null) { return; }
		const d = data as Record<string, unknown>;

		switch (type) {
			case 'finding:approved': {
				const missionId = typeof d.missionId === 'string' ? d.missionId : null;
				const findingId = typeof d.findingId === 'string' ? d.findingId : null;
				const prUrl = typeof d.prUrl === 'string' ? d.prUrl : null;
				if (missionId && findingId) {
					this.missionService.onFindingApproved(missionId, findingId, prUrl);
				}
				break;
			}
			case 'finding:rejected': {
				const missionId = typeof d.missionId === 'string' ? d.missionId : null;
				const findingId = typeof d.findingId === 'string' ? d.findingId : null;
				const reason = typeof d.reason === 'string' ? d.reason : null;
				if (missionId && findingId) {
					this.missionService.onFindingRejected(missionId, findingId, reason);
				}
				break;
			}
			case 'destructive_action_pending': {
				// Mid-run destructive-action approval request (#107).
				const approvalId = typeof d.approvalId === 'string' ? d.approvalId : null;
				if (!approvalId) { break; }
				this.pendingApprovals.set(approvalId, {
					approvalId,
					missionId: typeof d.missionId === 'string' ? d.missionId : null,
					action: typeof d.action === 'string' ? d.action : 'unknown action',
					target: typeof d.target === 'string' ? d.target : '',
					tier: typeof d.tier === 'string' ? d.tier : 'unknown',
					reasoning: typeof d.reasoning === 'string' ? d.reasoning : '',
				});
				this._onDidChangeRunEvents.fire();
				break;
			}
			case 'destructive_action_resolved': {
				// Backend resolved the request elsewhere (timeout / another client) — clear it (#107).
				const approvalId = typeof d.approvalId === 'string' ? d.approvalId : null;
				if (approvalId && this.pendingApprovals.delete(approvalId)) {
					this._onDidChangeRunEvents.fire();
				}
				break;
			}
			case 'state:coverage': {
				// A state-coverage critique entry from the FAFO engine (#108).
				const missionId = typeof d.missionId === 'string' ? d.missionId : null;
				const state = typeof d.state === 'string' ? d.state as AppStateKind : null;
				if (!missionId || !state || !ALL_APP_STATES.includes(state)) { break; }
				const entry: StateCoverageEntry = {
					missionId,
					state,
					score: typeof d.score === 'number' ? d.score : 0,
					screenshotPath: typeof d.screenshotPath === 'string' ? d.screenshotPath : undefined,
					critique: typeof d.critique === 'string' ? d.critique : undefined,
				};
				const existing = this.stateCoverage.get(missionId) ?? [];
				// Replace any prior entry for the same state so the latest score wins.
				const next = existing.filter(e => e.state !== state);
				next.push(entry);
				this.stateCoverage.set(missionId, next);
				this._onDidChangeRunEvents.fire();
				break;
			}
			default:
				break;
		}
	}
}

registerSingleton(IRibixBackendSseService, RibixBackendSseService, InstantiationType.Delayed);
