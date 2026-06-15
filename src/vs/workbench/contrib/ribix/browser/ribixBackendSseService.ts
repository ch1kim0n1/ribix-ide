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
import { IVoidSCMService } from '../common/voidSCMTypes.js';
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
}

export const IRibixBackendSseService = createDecorator<IRibixBackendSseService>('ribixBackendSseService');

export class RibixBackendSseService extends Disposable implements IRibixBackendSseService {
	readonly _serviceBrand: undefined;

	private readonly _onDidReceiveCloudFinding = new Emitter<TaggedFinding>();
	readonly onDidReceiveCloudFinding = this._onDidReceiveCloudFinding.event;

	private voidSCM: IVoidSCMService;
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
		this.voidSCM = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));

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
			const remoteUrl = await this.voidSCM.gitRemoteUrl(workspacePath);
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
			default:
				break;
		}
	}
}

registerSingleton(IRibixBackendSseService, RibixBackendSseService, InstantiationType.Delayed);
