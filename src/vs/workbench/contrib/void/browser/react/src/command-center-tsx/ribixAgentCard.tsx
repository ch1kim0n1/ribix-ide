/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AgentInstance, AgentStatus, AgentType } from '../../../../common/ribixTypes.js';

interface ribixAgentCardProps {
	agent: AgentInstance;
}

const getAgentIcon = (type: AgentType): string => {
	switch (type) {
		case 'planner':
			return '📋';
		case 'coder':
			return '💻';
		case 'tester':
			return '🧪';
		case 'debugger':
			return '🐛';
		case 'reviewer':
			return '🔍';
		case 'docs':
			return '📚';
		case 'release':
			return '🚀';
		default:
			return '🤖';
	}
};

const getStatusColor = (status: AgentStatus): string => {
	switch (status) {
		case 'idle':
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
		case 'planning':
		case 'executing':
			return 'text-[var(--ribix-gold, #C6AA58)]';
		case 'blocked':
			return 'text-[var(--ribix-error, #C23B22)]';
		case 'complete':
			return 'text-[var(--ribix-success, #2D7A4F)]';
		case 'failed':
			return 'text-[var(--ribix-error, #C23B22)]';
		default:
			return 'text-[var(--ribix-text-secondary, #8A9E8A)]';
	}
};

const getStatusLabel = (status: AgentStatus): string => {
	switch (status) {
		case 'idle':
			return 'Idle';
		case 'planning':
			return 'Planning';
		case 'executing':
			return 'Executing';
		case 'blocked':
			return 'Blocked';
		case 'complete':
			return 'Complete';
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

export const ribixAgentCard = ({ agent }: ribixAgentCardProps) => {
	const agentName = `${agent.type.charAt(0).toUpperCase() + agent.type.slice(1)}-${agent.id.substring(0, 6)}`;
	const filesTouched = agent.filesRead.length + agent.filesWritten.length;

	return (
		<div
			className="p-4 rounded-lg border"
			style={{
				backgroundColor: 'var(--ribix-bg-primary, #01311F)',
				borderColor: 'var(--ribix-border, #1E4A32)',
			}}
		>
			<div className="flex items-center mb-3">
				<span className="text-2xl mr-3">{getAgentIcon(agent.type)}</span>
				<div className="flex-1">
					<h4 className="text-sm font-medium text-[var(--ribix-text-primary, #F5F0E8)]">
						{agentName}
					</h4>
					<span className={`text-xs font-semibold ${getStatusColor(agent.status)}`}>
						{getStatusLabel(agent.status)}
					</span>
				</div>
			</div>

			<div className="mb-2">
				<p className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)] mb-1">Current Action</p>
				<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)]">{agent.currentAction}</p>
			</div>

			<div className="flex justify-between text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
				<span>Files: {filesTouched}</span>
				<span>{formatDuration(agent.startedAt, agent.completedAt)}</span>
			</div>
		</div>
	);
};