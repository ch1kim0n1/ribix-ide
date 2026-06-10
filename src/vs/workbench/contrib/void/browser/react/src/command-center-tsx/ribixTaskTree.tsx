/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PlanTask, RiskLevel } from '../../../../common/ribixTypes.js';

interface ribixTaskTreeProps {
	tasks: PlanTask[];
	onApproveTask?: (taskId: string) => void;
	onRemoveTask?: (taskId: string) => void;
	onModifyTask?: (taskId: string, newDescription: string) => void;
	readonly?: boolean;
}

const getRiskColor = (risk: RiskLevel): string => {
	switch (risk) {
		case 'low':
			return 'text-[var(--ribix-success, #2D7A4F)]';
		case 'medium':
			return 'text-[var(--ribix-warning, #D4820A)]';
		case 'high':
			return 'text-[var(--ribix-error, #C23B22)]';
		default:
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
	}
};

const getRiskLabel = (risk: RiskLevel): string => {
	switch (risk) {
		case 'low':
			return 'Low';
		case 'medium':
			return 'Medium';
		case 'high':
			return 'High';
		default:
			return 'Unknown';
	}
};

const getStatusColor = (status: PlanTask['status']): string => {
	switch (status) {
		case 'pending':
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
		case 'in_progress':
			return 'text-[var(--ribix-gold, #C6AA58)]';
		case 'complete':
			return 'text-[var(--ribix-success, #2D7A4F)]';
		case 'failed':
			return 'text-[var(--ribix-error, #C23B22)]';
		case 'skipped':
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
		default:
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
	}
};

const getStatusLabel = (status: PlanTask['status']): string => {
	switch (status) {
		case 'pending':
			return 'Pending';
		case 'in_progress':
			return 'In Progress';
		case 'complete':
			return 'Complete';
		case 'failed':
			return 'Failed';
		case 'skipped':
			return 'Skipped';
		default:
			return 'Unknown';
	}
};

export const ribixTaskTree = ({ tasks, onApproveTask, onRemoveTask, onModifyTask, readonly = false }: ribixTaskTreeProps) => {
	const handleModifyTask = (taskId: string) => {
		const task = tasks.find(t => t.id === taskId);
		if (!task) return;

		const newDescription = prompt('Modify task description:', task.description);
		if (newDescription && newDescription !== task.description) {
			onModifyTask?.(taskId, newDescription);
		}
	};

	return (
		<div className="space-y-2">
			{tasks.map((task, index) => (
				<div
					key={task.id}
					className="p-3 rounded-lg border"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-border, #1E4A32)',
					}}
				>
					<div className="flex items-start mb-2">
						<span className="text-[var(--ribix-gold, #C6AA58)] mr-2 font-bold">
							{index + 1}.
						</span>
						<div className="flex-1">
							<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] mb-1">
								{task.description}
							</p>
							{task.notes && (
								<p className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)] italic">
									{task.notes}
								</p>
							)}
						</div>
					</div>

					<div className="flex justify-between items-center mb-2">
						<div className="flex gap-3 text-xs">
							<span className={`${getRiskColor(task.riskLevel)} font-medium`}>
								{getRiskLabel(task.riskLevel)} Risk
							</span>
							<span className={`${getStatusColor(task.status)} font-medium`}>
								{getStatusLabel(task.status)}
							</span>
							<span className="text-[var(--ribix-text-secondary, #8A9E8A)]">
								~{task.estimatedTokens} tokens
							</span>
						</div>
					</div>

					{task.dependsOn.length > 0 && (
						<div className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
							Depends on: {task.dependsOn.length} task{task.dependsOn.length !== 1 ? 's' : ''}
						</div>
					)}

					{!readonly && (
						<div className="flex gap-2 mt-2">
							{onApproveTask && task.status === 'pending' && (
								<button
									onClick={() => onApproveTask(task.id)}
									className="text-xs px-3 py-1 rounded transition-colors"
									style={{
										backgroundColor: 'var(--ribix-gold, #C6AA58)',
										color: 'var(--ribix-bg-primary, #01311F)',
									}}
								>
									Approve
								</button>
							)}
							{onModifyTask && (
								<button
									onClick={() => handleModifyTask(task.id)}
									className="text-xs px-3 py-1 rounded border transition-colors"
									style={{
										borderColor: 'var(--ribix-border, #1E4A32)',
										color: 'var(--ribix-text-primary, #F5F0E8)',
									}}
								>
									Modify
								</button>
							)}
							{onRemoveTask && (
								<button
									onClick={() => onRemoveTask(task.id)}
									className="text-xs px-3 py-1 rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
								>
									Remove
								</button>
							)}
						</div>
					)}
				</div>
			))}
		</div>
	);
};