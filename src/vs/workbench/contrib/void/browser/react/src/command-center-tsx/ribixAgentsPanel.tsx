/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixAgentService } from '../../../ribixAgentService.js';
import { AgentInstance } from '../../../../common/ribixTypes.js';
import { RibixAgentCard } from './ribixAgentCard.js';

export const RibixAgentsPanel = () => {
	const accessor = useAccessor();
	const agentService = accessor.get(IRibixAgentService);
	const [agents, setAgents] = useState<AgentInstance[]>([]);

	useEffect(() => {
		// Load agents on mount
		setAgents(agentService.getAllActiveAgents());

		// Subscribe to agent changes
		const disposable = agentService.onDidChangeAgents(() => {
			setAgents(agentService.getAllActiveAgents());
		});

		return () => {
			disposable.dispose();
		};
	}, [agentService]);

	return (
		<div className="p-4 h-full">
			<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
				Active Agents
			</h3>
			{agents.length === 0 ? (
				<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
					No active agents. Agents will appear here when missions are executing.
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3">
					{agents.map((agent) => (
						<RibixAgentCard key={agent.id} agent={agent} />
					))}
				</div>
			)}
		</div>
	);
};