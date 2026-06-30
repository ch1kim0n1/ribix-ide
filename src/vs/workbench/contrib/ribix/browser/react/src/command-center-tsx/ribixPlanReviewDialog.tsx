/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixMissionService } from '../../../ribixMissionService.js';
import { IRibixAgentService } from '../../../ribixAgentService.js';
import { IRibixOrchestrationService, MissionProgress } from '../../../ribixOrchestrationService.js';
import { IRibixDiffAnnotationWidget, UxVisionNote } from '../../../ribixDiffAnnotationWidget.js';
import { Mission, PlanTask } from '../../../../common/ribixTypes.js';
import { RibixTaskTree } from './ribixTaskTree.js';
import { RibixAgentActivityFeed } from './ribixAgentActivityFeed.js';
import { RibixDiffSummary } from './ribixDiffSummary.js';
import { RibixUxVision } from './ribixUxVision.js';

/** A task carries the planner's fallback marker when LLM planning failed (ribixPlanningService). */
const isFallbackTask = (task: PlanTask): boolean =>
	task.notes.toLowerCase().includes('fallback plan');

interface ribixPlanReviewDialogProps {
	mission: Mission;
	onClose: () => void;
}

export const RibixPlanReviewDialog = ({ mission, onClose }: ribixPlanReviewDialogProps) => {
	const accessor = useAccessor();
	const missionService = accessor.get(IRibixMissionService);
	const agentService = accessor.get(IRibixAgentService);
	const orchestrationService = accessor.get(IRibixOrchestrationService);
	const diffAnnotationWidget = accessor.get(IRibixDiffAnnotationWidget);
	const [tasks, setTasks] = useState<PlanTask[]>(mission.tasks);
	const [isApproving, setIsApproving] = useState(false);
	const [uxVisionNotes, setUxVisionNotes] = useState<UxVisionNote[]>(
		() => diffAnnotationWidget.getUxVisionNotes(mission.id)
	);
	const [progress, setProgress] = useState<MissionProgress | null>(
		() => orchestrationService.getMissionProgress(mission.id)
	);
	const [isRetrying, setIsRetrying] = useState(false);

	useEffect(() => {
		setTasks(mission.tasks);
	}, [mission.tasks]);

	// Keep UX-vision notes (#116) in sync with the diff-annotation widget for this mission.
	useEffect(() => {
		setUxVisionNotes(diffAnnotationWidget.getUxVisionNotes(mission.id));
		const disposable = diffAnnotationWidget.onDidChangeAnnotations(() => {
			setUxVisionNotes(diffAnnotationWidget.getUxVisionNotes(mission.id));
		});
		return () => disposable.dispose();
	}, [diffAnnotationWidget, mission.id]);

	// Track orchestration progress so a failed task surfaces WHY (failed task + agent error).
	useEffect(() => {
		setProgress(orchestrationService.getMissionProgress(mission.id));
		const disposable = orchestrationService.onDidChangeMissionProgress(p => {
			if (p.missionId === mission.id) {
				setProgress(p);
			}
		});
		return () => disposable.dispose();
	}, [orchestrationService, mission.id]);

	const handleRetry = async () => {
		setIsRetrying(true);
		try {
			await orchestrationService.retryMission(mission.id);
		} catch (error) {
			console.error('Failed to retry mission:', error);
		} finally {
			setIsRetrying(false);
		}
	};

	const handleAbort = async () => {
		try {
			await orchestrationService.abortMission(mission.id);
			onClose();
		} catch (error) {
			console.error('Failed to abort mission:', error);
		}
	};

	const handleApprovePlan = async () => {
		setIsApproving(true);
		try {
			await missionService.approvePlan(mission.id, tasks);
			// Spawn agents — this is what actually starts execution
			await orchestrationService.executeMission(mission.id);
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
					{/* Failure banner: shows WHY the mission paused + Retry / Abort (issue #114) */}
					{progress?.failedAgentError && (
						<div
							className="mb-4 p-3 rounded-lg border"
							role="alert"
							style={{
								backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
								borderColor: 'var(--ribix-error, #C23B22)',
							}}
						>
							<div className="flex items-center justify-between mb-1">
								<span className="text-sm font-semibold text-[var(--ribix-error, #C23B22)]">
									Mission paused — a task failed
								</span>
								<div className="flex gap-2">
									<button
										onClick={handleRetry}
										disabled={isRetrying}
										className="text-xs px-3 py-1 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										style={{
											backgroundColor: 'var(--ribix-gold, #C6AA58)',
											color: 'var(--ribix-bg-primary, #01311F)',
										}}
									>
										{isRetrying ? 'Retrying...' : 'Retry'}
									</button>
									<button
										onClick={handleAbort}
										className="text-xs px-3 py-1 rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
									>
										Abort
									</button>
								</div>
							</div>
							{progress.failedTaskDescription && (
								<p className="text-xs text-[var(--ribix-text-primary, #F5F0E8)] mb-1">
									Failed task: {progress.failedTaskDescription}
								</p>
							)}
							<p className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
								{progress.failedAgentError}
							</p>
						</div>
					)}

					{/* Fallback-plan banner: LLM planning failed, this is the minimal safe plan (issue #114) */}
					{tasks.some(isFallbackTask) && (
						<div
							className="mb-4 p-2 rounded-lg border text-xs"
							style={{
								backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
								borderColor: 'var(--ribix-warning, #D4820A)',
								color: 'var(--ribix-warning, #D4820A)',
							}}
						>
							Fallback plan — LLM planning failed. This is a minimal safe plan; review it before approving.
						</div>
					)}

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
							<RibixTaskTree
								tasks={tasks}
								onRemoveTask={handleRemoveTask}
								onModifyTask={handleModifyTask}
								readonly={mission.state !== 'plan_ready'}
							/>
						)}
					</div>

					{/* Activity Feed — show while executing, and also after a failure so the
					    failing turn is visible alongside the Retry/Abort controls (issue #114). */}
					{(mission.state === 'executing' || progress?.failedAgentError) && allActivities.length > 0 && (
						<div className="mb-4">
							<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
								Activity Feed
							</h3>
							<RibixAgentActivityFeed activities={allActivities} />
						</div>
					)}

					{/* Diff Summary (only show when complete) */}
					{mission.state === 'complete' && mission.result && (
						<div className="mb-4">
							<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
								Diff Summary
							</h3>
							<RibixDiffSummary mission={mission} />
						</div>
					)}

					{/* UX Vision (#116) — visual critique of UI-touching changes from the QA browser agent. */}
					{uxVisionNotes.length > 0 && (
						<div className="mb-4">
							<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
								UX Vision ({uxVisionNotes.length})
							</h3>
							<RibixUxVision notes={uxVisionNotes} />
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