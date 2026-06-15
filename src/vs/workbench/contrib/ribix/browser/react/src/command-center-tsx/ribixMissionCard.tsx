/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Mission, MissionState } from '../../../../common/ribixTypes.js';

interface ribixMissionCardProps {
	mission: Mission;
	onClick: () => void;
}

const getStatusColor = (state: MissionState): string => {
	switch (state) {
		case 'awaiting_outcome':
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
		case 'planning':
			return 'text-[var(--ribix-gold, #C6AA58)]';
		case 'plan_ready':
			return 'text-blue-400';
		case 'executing':
			return 'text-[var(--ribix-gold, #C6AA58)]';
		case 'reviewing':
			return 'text-purple-400';
		case 'complete':
			return 'text-[var(--ribix-success, #2D7A4F)]';
		case 'aborted':
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
		case 'failed':
			return 'text-[var(--ribix-error, #C23B22)]';
		default:
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
	}
};

const getStatusLabel = (state: MissionState): string => {
	switch (state) {
		case 'awaiting_outcome':
			return 'Awaiting';
		case 'planning':
			return 'Planning';
		case 'plan_ready':
			return 'Plan Ready';
		case 'executing':
			return 'Executing';
		case 'reviewing':
			return 'Reviewing';
		case 'complete':
			return 'Complete';
		case 'aborted':
			return 'Aborted';
		case 'failed':
			return 'Failed';
		default:
			return 'Unknown';
	}
};

const formatDuration = (startTime: number, endTime: number | null): string => {
	const end = endTime || Date.now();
	const duration = Math.floor((end - startTime) / 1000); // seconds

	if (duration < 60) {
		return `${duration}s`;
	} else if (duration < 3600) {
		return `${Math.floor(duration / 60)}m`;
	} else {
		return `${Math.floor(duration / 3600)}h`;
	}
};

export const RibixMissionCard = ({ mission, onClick }: ribixMissionCardProps) => {
	const truncatedOutcome = mission.outcome.length > 80
		? mission.outcome.substring(0, 80) + '...'
		: mission.outcome;

	return (
		<div
			onClick={onClick}
			className="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg"
			style={{
				backgroundColor: 'var(--ribix-bg-primary, #01311F)',
				borderColor: 'var(--ribix-border, #1E4A32)',
			}}
		>
			<div className="flex justify-between items-start mb-2">
				<h4 className="text-sm font-medium text-[var(--ribix-text-primary, #F5F0E8)] flex-1">
					{truncatedOutcome}
				</h4>
				<span className={`text-xs font-semibold ml-2 ${getStatusColor(mission.state)}`}>
					{getStatusLabel(mission.state)}
				</span>
			</div>

			<div className="flex justify-between items-center text-xs">
				<span className="text-[var(--ribix-text-secondary, #8A9E8A)]">
					{mission.agentIds.length} agent{mission.agentIds.length !== 1 ? 's' : ''}
				</span>
				<span className="text-[var(--ribix-text-secondary, #8A9E8A)]">
					{formatDuration(mission.createdAt, mission.completedAt)}
				</span>
			</div>
		</div>
	);
};