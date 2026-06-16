/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt in the project root.
 *--------------------------------------------------------------------------------------*/

/**
 * Mission Collaboration
 *
 * Manages per-mission collaborators: adding/removing team members, querying
 * access, and notifying when agents complete.
 *
 * Backend wiring:
 * TODO(#45): POST /cli/missions/:id/collaborators  — addCollaborator
 * TODO(#45): DELETE /cli/missions/:id/collaborators/:userId — removeCollaborator
 * TODO(#45): GET /cli/missions/:id/collaborators — getCollaborators
 * TODO(#45): POST /cli/missions/:id/notify — notifyCompletion (webhook / email via backend)
 *
 * These endpoints are not yet implemented on the backend. The current in-memory
 * implementation allows the UI layer to wire up collaboration UX before the backend
 * route exists.
 */

export interface MissionCollaborator {
	userId: string;
	email: string;
	role: 'owner' | 'collaborator';
	canApprove: boolean;
}

export interface MissionResult {
	summary: string;
	filesChanged: string[];
	testReport: string | null;
	reviewerFindings: string[];
	prUrl: string | null;
}

/**
 * In-memory collaboration store. Replace the Map operations with backend API
 * calls once the /cli/missions/:id/collaborators routes are available.
 */
export class MissionCollaboration {
	/** missionId → collaborators */
	private store = new Map<string, MissionCollaborator[]>();

	/** The current user's userId — set externally (e.g. from ribixAuthService session). */
	private currentUserId: string | null = null;

	setCurrentUserId(userId: string): void {
		this.currentUserId = userId;
	}

	/**
	 * Add a collaborator to a mission by email.
	 * TODO(#45): Replace body with POST /cli/missions/:id/collaborators { email }.
	 */
	async addCollaborator(missionId: string, email: string): Promise<void> {
		const list = this.store.get(missionId) ?? [];
		const already = list.find(c => c.email === email);
		if (already) {
			return; // idempotent
		}
		const collaborator: MissionCollaborator = {
			userId: `pending-${Date.now()}`, // server assigns real userId on backend
			email,
			role: 'collaborator',
			canApprove: false,
		};
		list.push(collaborator);
		this.store.set(missionId, list);
	}

	/**
	 * Remove a collaborator from a mission.
	 * TODO(#45): Replace body with DELETE /cli/missions/:id/collaborators/:userId.
	 */
	async removeCollaborator(missionId: string, userId: string): Promise<void> {
		const list = this.store.get(missionId) ?? [];
		this.store.set(missionId, list.filter(c => c.userId !== userId));
	}

	/**
	 * Returns all collaborators for a mission.
	 * TODO(#45): Replace body with GET /cli/missions/:id/collaborators.
	 */
	async getCollaborators(missionId: string): Promise<MissionCollaborator[]> {
		return this.store.get(missionId) ?? [];
	}

	/**
	 * Notifies all collaborators when agents complete by logging to console.
	 * TODO(#45): Replace console.log with POST /cli/missions/:id/notify { result } to
	 * trigger backend email / webhook dispatch.
	 */
	async notifyCompletion(missionId: string, result: MissionResult): Promise<void> {
		const collaborators = await this.getCollaborators(missionId);
		if (collaborators.length === 0) {
			return;
		}
		// Stub: real implementation calls the backend notification endpoint.
		console.log(
			`[MissionCollaboration] Mission ${missionId} complete. Notifying ${collaborators.length} collaborator(s):`,
			collaborators.map(c => c.email).join(', '),
			'Result summary:', result.summary.slice(0, 120),
		);
	}

	/**
	 * Returns true if the current user has the 'canApprove' flag on this mission.
	 * Owners always have approval rights.
	 */
	async canCurrentUserApprove(missionId: string): Promise<boolean> {
		if (!this.currentUserId) {
			return false;
		}
		const collaborators = await this.getCollaborators(missionId);
		const me = collaborators.find(c => c.userId === this.currentUserId);
		if (!me) {
			return false;
		}
		return me.role === 'owner' || me.canApprove;
	}
}

/** Module-level singleton. */
export const missionCollaboration = new MissionCollaboration();
