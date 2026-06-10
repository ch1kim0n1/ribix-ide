/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixMissionService } from '../../../ribixMissionService.js';
import { IRibixAgentService } from '../../../ribixAgentService.js';
import { Mission, PlanTask } from '../../../../common/ribixTypes.js';
import { ribixTaskTree } from './ribixTaskTree.js';
import { ribixAgentActivityFeed } from './ribixAgentActivityFeed.js';
import { ribixDiffSummary } from './ribixDiffSummary.js';

interface ribixPlanReviewDialogProps {
	mission: Mission;
	onClose: () => void;
}

export const ribixPlanReviewDialog = ({ mission, onClose }: ribixPlanReviewDialogProps) => {
	const accessor = useAccessor();
	const missionService = accessor.get(IRibixMissionService);
	const agentService = accessor.get(IRibixAgentService);
	const [tasks, setTasks] = useState<PlanTask[]>(mission.tasks);
	const [isApproving, setIsApproving] = useState(false);

	useEffect(() => {
		setTasks(mission.tasks);
	}, [mission.tasks]);

	const handleApprovePlan = async () => {
		setIsApproving(true);
		try {
			await missionService.approvePlan(mission.id, tasks);
			onClose();
		} catch (error) {
			console.error('Failed to approve plan:', error);
		} finally {
			setIsApproving(false);
		}
	};

	const handleRemoveTask = (taskId: string) => {
		setTasks(tasks.filter(t => t.id !== taskId));
	};

	const handleModifyTask = (taskId: string, newDescription: string) => {
		setTasks(tasks.map(t =>
			t.id === taskId ? { ...t, description: newDescription } : t
		));
	};

	const agents = agentService.getAgentsForMission(mission.id);
	const allActivities = agents.flatMap(agent => agent.activityLog);

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div
				className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-lg shadow-2xl"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					border: '1px solid var(--ribix-border, #1E4A32)',
				}}
			>
				{/* Header */}
				<div className="p-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--ribix-border, #1E4A32)' }}>
					<div>
						<h2 className="text-lg font-semibold text-[var(--ribix-text-primary, #F5F0E8)]">
							Mission Review
						</h2>
						<p className="text-sm text-[var(--ribix-text-secondary, #8A9E8A)]">
							{mission.outcome}
						</p>
					</div>
					<button
						onClick={onClose}
						className="text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)] text-2xl"
					>
						×
					</button>
				</div>

				{/* Content */}
				<div className="p-4">
					{/* Tabs */}
					<div className="flex border-b mb-4" style={{ borderColor: 'var(--ribix-border, #1E4A32)' }}>
						<button className="px-4 py-2 text-sm font-medium text-[var(--ribix-gold, #C6AA58)] border-b-2 border-[var(--ribix-gold, #C6AA58)]">
							Task Tree
						</button>
						{mission.state === 'executing' && (
							<button className="px-4 py-2 text-sm font-medium text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]">
								Activity Feed
							</button>
						)}
						{mission.state === 'complete' && (
							<button className="px-4 py-2 text-sm font-medium text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]">
								Diff Summary
							</button>
						)}
					</div>

					{/* Task Tree */}
					<div className="mb-4">
						<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
							Task Tree
						</h3>
						{tasks.length === 0 ? (
							<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
								{mission.state === 'planning' ? 'Planning in progress...' : 'No tasks yet.'}
							</div>
						) : (
							<ribixTaskTree
								tasks={tasks}
								onRemoveTask={handleRemoveTask}
								onModifyTask={handleModifyTask}
								readonly={mission.state !== 'plan_ready'}
							/>
						)}
					</div>

					{/* Activity Feed (only show when executing) */}
					{mission.state === 'executing' && allActivities.length > 0 && (
						<div className="mb-4">
							<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
								Activity Feed
							</h3>
							<ribixAgentActivityFeed activities={allActivities} />
						</div>
					)}

					{/* Diff Summary (only show when complete) */}
					{mission.state === 'complete' && mission.result && (
						<div className="mb-4">
							<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
								Diff Summary
							</h3>
							<ribixDiffSummary mission={mission} />
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="p-4 border-t flex justify-end gap-3" style={{ borderColor: 'var(--ribix-border, #1E4A32)' }}>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg font-medium transition-colors"
						style={{
							backgroundColor: 'transparent',
							border: '1px solid var(--ribix-border, #1E4A32)',
							color: 'var(--ribix-text-primary, #F5F0E8)',
						}}
					>
						Close
					</button>
					{mission.state === 'plan_ready' && (
						<button
							onClick={handleApprovePlan}
							disabled={isApproving || tasks.length === 0}
							className="px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							style={{
								backgroundColor: 'var(--ribix-gold, #C6AA58)',
								color: 'var(--ribix-bg-primary, #01311F)',
							}}
						>
							{isApproving ? 'Approving...' : 'Approve & Execute'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
};