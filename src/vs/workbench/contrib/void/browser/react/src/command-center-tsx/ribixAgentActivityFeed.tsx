/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AgentActivityEntry } from '../../../../common/ribixTypes.js';

interface ribixAgentActivityFeedProps {
	activities: AgentActivityEntry[];
}

const formatTimestamp = (timestamp: number): string => {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	if (diff < 60000) {
		return 'Just now';
	} else if (diff < 3600000) {
		return `${Math.floor(diff / 60000)}m ago`;
	} else if (diff < 86400000) {
		return `${Math.floor(diff / 3600000)}h ago`;
	} else {
		return date.toLocaleDateString();
	}
};

const getActionColor = (action: string): string => {
	const lowerAction = action.toLowerCase();
	if (lowerAction.includes('error') || lowerAction.includes('failed')) {
		return 'text-[var(--ribix-error, #C23B22)]';
	} else if (lowerAction.includes('complete') || lowerAction.includes('success')) {
		return 'text-[var(--ribix-success, #2D7A4F)]';
	} else if (lowerAction.includes('read') || lowerAction.includes('load')) {
		return 'text-blue-400';
	} else if (lowerAction.includes('write') || lowerAction.includes('save')) {
		return 'text-[var(--ribix-gold, #C6AA58)]';
	} else {
		return 'text-[var(--ribix-text-primary, #F5F0E8)]';
	}
};

export const ribixAgentActivityFeed = ({ activities }: ribixAgentActivityFeedProps) => {
	if (activities.length === 0) {
		return (
			<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
				No activity yet.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{activities.slice().reverse().map((activity, index) => (
				<div
					key={`${activity.timestamp}-${index}`}
					className="p-3 rounded-lg border"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-border, #1E4A32)',
					}}
				>
					<div className="flex justify-between items-start mb-1">
						<span className={`text-sm font-medium ${getActionColor(activity.action)}`}>
							{activity.action}
						</span>
						<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
							{formatTimestamp(activity.timestamp)}
						</span>
					</div>

					{activity.detail && (
						<p className="text-xs text-[var(--ribix-text-primary, #F5F0E8)] mb-1">
							{activity.detail}
						</p>
					)}

					<div className="flex gap-2 text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
						{activity.tool && (
							<span className="bg-[var(--ribix-border, #1E4A32)] px-2 py-0.5 rounded">
								Tool: {activity.tool}
							</span>
						)}
						{activity.filePath && (
							<span className="bg-[var(--ribix-border, #1E4A32)] px-2 py-0.5 rounded">
								{activity.filePath}
							</span>
						)}
					</div>
				</div>
			))}
		</div>
	);
};