/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// #38 — Automatic code snapshot before mission start
//
// Helpers for snapshotting repo state before a mission begins so engineers can
// revert to pre-mission state if the agents make unwanted changes.
//
// Wire-up notes:
//   1. Call createMissionSnapshot(missionId, workspacePath) in approvePlan() inside
//      ribixMissionService.ts, after the git branch is created and before mission.state
//      is set to 'executing'. Store the returned snapshotRef on the mission object
//      (add snapshotRef?: string to the Mission type in ribixTypes.ts).
//
//   2. Expose revertToSnapshot(snapshotRef, workspacePath) as a command that the UI can
//      call. The "Revert to pre-mission state" button should appear on the mission card
//      in ribixMissionCard.tsx when mission.state is 'complete' or 'aborted' and a
//      snapshotRef is present.
//      TODO(#38-ui): add revert button to ribixMissionCard.tsx — wire to
//      `agentController` command 'ribix.revertMissionSnapshot' which calls
//      revertToSnapshot(mission.snapshotRef, workspacePath).

import { IRibixSCMService } from '../common/ribixSCMTypes.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';

/**
 * Creates a git stash that captures all working-tree and untracked changes before a
 * mission starts. Returns the stash ref in the form "stash@{N}" so it can be stored
 * on the Mission and passed to revertToSnapshot later.
 *
 * The stash message is keyed to the missionId so it survives alongside other stashes.
 *
 * @param missionId   The mission UUID — embedded in the stash message for traceability.
 * @param workspacePath  Absolute path to the git workspace root.
 * @param ribixSCM     Proxy to the main-process SCM channel (IRibixSCMService).
 *                    If not provided the function falls back to a no-op and returns null.
 * @returns  The stash ref string (e.g. "stash@{0}") or null when nothing was stashed
 *           (clean working tree) or when the operation failed non-fatally.
 */
export async function createMissionSnapshot(
	missionId: string,
	workspacePath: string,
	ribixSCM: IRibixSCMService,
): Promise<string | null> {
	try {
		const label = `ribix-mission-${missionId}-snapshot`;
		await ribixSCM.gitStashPush(workspacePath, label);

		// Resolve the newly created stash ref by listing stashes and matching the label.
		const stashList: string = await ribixSCM.gitStashList(workspacePath);
		const lines = stashList.split('\n').filter(Boolean);
		for (const line of lines) {
			// git stash list format: "stash@{N}: On branch: <label>"
			if (line.includes(label)) {
				const match = line.match(/^(stash@\{\d+\})/);
				if (match) {
					return match[1];
				}
			}
		}
		// If the stash message isn't found the working tree was clean — nothing stashed.
		return null;
	} catch (e) {
		console.warn(`createMissionSnapshot: failed to create snapshot for mission ${missionId}:`, e);
		return null;
	}
}

/**
 * Reverts the workspace to the state captured by createMissionSnapshot by popping
 * the specified stash ref. Destructive — any changes made since the snapshot will
 * be lost if they conflict with the stash.
 *
 * @param snapshotRef   The stash ref returned by createMissionSnapshot, e.g. "stash@{0}".
 * @param workspacePath  Absolute path to the git workspace root.
 * @param ribixSCM       Proxy to the main-process SCM channel.
 */
export async function revertToSnapshot(
	snapshotRef: string,
	workspacePath: string,
	ribixSCM: IRibixSCMService,
): Promise<void> {
	await ribixSCM.gitStashPop(workspacePath, snapshotRef);
}

/**
 * Convenience factory: resolves the IRibixSCMService proxy from the main-process IPC
 * channel using the same pattern as ribixMissionService.ts and ribixSCMService.ts.
 */
export function createRibixSCMProxy(mainProcessService: IMainProcessService): IRibixSCMService {
	return ProxyChannel.toService<IRibixSCMService>(mainProcessService.getChannel('ribix-channel-scm'));
}
