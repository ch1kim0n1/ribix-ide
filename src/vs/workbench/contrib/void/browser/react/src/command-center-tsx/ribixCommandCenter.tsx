/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { useIsDark } from '../util/services.js';
import '../styles.css';
import { ribixMissionsPanel } from './ribixMissionsPanel.js';
import { ribixAgentsPanel } from './ribixAgentsPanel.js';
import { ribixMemoryPanel } from './ribixMemoryPanel.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';

type TabType = 'missions' | 'agents' | 'memory';

export const ribixCommandCenter = ({ className }: { className: string }) => {
	const isDark = useIsDark();
	const [activeTab, setActiveTab] = useState<TabType>('missions');

	return (
		<div
			className={`@@void-scope ${isDark ? 'dark' : ''}`}
			style={{ width: '100%', height: '100%' }}
		>
			<div
				className="w-full h-full"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					color: 'var(--ribix-text-primary, #F5F0E8)',
				}}
			>
				{/* Tab Navigation */}
				<div className="flex border-b border-[var(--ribix-border, #1E4A32)]">
					<button
						onClick={() => setActiveTab('missions')}
						className={`px-4 py-3 text-sm font-medium transition-colors ${
							activeTab === 'missions'
								? 'text-[var(--ribix-gold, #C6AA58)] border-b-2 border-[var(--ribix-gold, #C6AA58)]'
								: 'text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]'
						}`}
					>
						Missions
					</button>
					<button
						onClick={() => setActiveTab('agents')}
						className={`px-4 py-3 text-sm font-medium transition-colors ${
							activeTab === 'agents'
								? 'text-[var(--ribix-gold, #C6AA58)] border-b-2 border-[var(--ribix-gold, #C6AA58)]'
								: 'text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]'
						}`}
					>
						Agents
					</button>
					<button
						onClick={() => setActiveTab('memory')}
						className={`px-4 py-3 text-sm font-medium transition-colors ${
							activeTab === 'memory'
								? 'text-[var(--ribix-gold, #C6AA58)] border-b-2 border-[var(--ribix-gold, #C6AA58)]'
								: 'text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)]'
						}`}
					>
						Memory
					</button>
				</div>

				{/* Tab Content */}
				<div className="w-full h-[calc(100%-48px)] overflow-auto">
					<ErrorBoundary>
						{activeTab === 'missions' && <ribixMissionsPanel />}
						{activeTab === 'agents' && <ribixAgentsPanel />}
						{activeTab === 'memory' && <ribixMemoryPanel />}
					</ErrorBoundary>
				</div>
			</div>
		</div>
	);
};