/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixBackendSseService, DestructiveApprovalRequest } from '../../../ribixBackendSseService.js';

/**
 * Mid-run destructive-action approval panel (#107). When the backend emits a
 * destructive_action_pending event, the SSE service collects it and this modal surfaces
 * the action, target, tier, and classification reasoning with Approve / Reject /
 * "No + skip all destructive" controls. Decisions are sent back over the approval API.
 *
 * Rendered once at the Command Center root so requests appear regardless of the active tab.
 */
export const RibixDestructiveApprovalPanel = () => {
	const accessor = useAccessor();
	const sseService = accessor.get(IRibixBackendSseService);

	const [requests, setRequests] = useState<DestructiveApprovalRequest[]>(
		() => sseService.getPendingDestructiveApprovals()
	);

	useEffect(() => {
		setRequests(sseService.getPendingDestructiveApprovals());
		const disposable = sseService.onDidChangeRunEvents(() => {
			setRequests(sseService.getPendingDestructiveApprovals());
		});
		return () => disposable.dispose();
	}, [sseService]);

	if (requests.length === 0) {
		return null;
	}

	// One request at a time keeps the decision unambiguous; the rest queue behind it.
	const request = requests[0];

	const respond = (decision: 'approve' | 'reject' | 'reject_all') => {
		sseService.respondToDestructiveApproval(request.approvalId, decision).catch(e => {
			console.error('Failed to respond to destructive approval:', e);
		});
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div
				className="w-full max-w-lg rounded-lg shadow-2xl"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					border: '1px solid var(--ribix-error, #C23B22)',
				}}
				role="alertdialog"
				aria-label="Destructive action approval"
			>
				<div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--ribix-error, #C23B22)' }}>
					<h2 className="text-base font-semibold text-[var(--ribix-error, #C23B22)]">
						Destructive action — approval required
					</h2>
					{requests.length > 1 && (
						<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
							{requests.length - 1} more queued
						</span>
					)}
				</div>

				<div className="p-4 space-y-3">
					<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)]">
						The agent wants to <strong>{request.action}</strong>
						{request.target ? <> on <strong>{request.target}</strong></> : null}.
					</p>

					<div className="flex flex-wrap gap-2 text-xs">
						<span
							className="px-2 py-0.5 rounded font-semibold uppercase"
							style={{
								backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
								color: 'var(--ribix-error, #C23B22)',
								border: '1px solid var(--ribix-error, #C23B22)',
							}}
						>
							{request.tier}
						</span>
						{request.target && (
							<span
								className="px-2 py-0.5 rounded"
								style={{
									backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
									color: 'var(--ribix-text-secondary, #8A9E8A)',
								}}
								title={request.target}
							>
								{request.target}
							</span>
						)}
					</div>

					{request.reasoning && (
						<div
							className="p-3 rounded text-xs"
							style={{
								backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
								color: 'var(--ribix-text-secondary, #8A9E8A)',
								border: '1px solid var(--ribix-border, #1E4A32)',
							}}
						>
							<span className="text-[var(--ribix-gold, #C6AA58)]">Why flagged: </span>
							{request.reasoning}
						</div>
					)}
				</div>

				<div className="p-4 border-t flex flex-wrap justify-end gap-2" style={{ borderColor: 'var(--ribix-border, #1E4A32)' }}>
					<button
						type="button"
						onClick={() => respond('reject_all')}
						className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
						style={{
							backgroundColor: 'transparent',
							border: '1px solid var(--ribix-border, #1E4A32)',
							color: 'var(--ribix-text-secondary, #8A9E8A)',
						}}
						title="Reject this and skip all destructive actions for the rest of the run"
					>
						No + skip all destructive
					</button>
					<button
						type="button"
						onClick={() => respond('reject')}
						className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
						style={{
							backgroundColor: 'transparent',
							border: '1px solid var(--ribix-error, #C23B22)',
							color: 'var(--ribix-error, #C23B22)',
						}}
					>
						No
					</button>
					<button
						type="button"
						onClick={() => respond('approve')}
						className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
						style={{
							backgroundColor: 'var(--ribix-gold, #C6AA58)',
							color: 'var(--ribix-bg-primary, #01311F)',
						}}
					>
						Yes, approve
					</button>
				</div>
			</div>
		</div>
	);
};
