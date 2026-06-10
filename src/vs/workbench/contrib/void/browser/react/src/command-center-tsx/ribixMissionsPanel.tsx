/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixMissionService } from '../../../ribixMissionService.js';
import { Mission } from '../../../../common/ribixTypes.js';
import { RibixMissionCard } from './ribixMissionCard.js';
import { RibixPlanReviewDialog } from './ribixPlanReviewDialog.js';

export const RibixMissionsPanel = () => {
	const accessor = useAccessor();
	const missionService = accessor.get(IRibixMissionService);
	const [missions, setMissions] = useState<Mission[]>([]);
	const [outcome, setOutcome] = useState('');
	const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

	useEffect(() => {
		// Load missions on mount
		setMissions(missionService.getAllMissions());

		// Subscribe to mission changes
		const disposable = missionService.onDidChangeMissions(() => {
			setMissions(missionService.getAllMissions());
		});

		return () => {
			disposable.dispose();
		};
	}, [missionService]);

	const handlePlanThis = async () => {
		if (!outcome.trim()) return;

		try {
			const mission = await missionService.createMission(outcome, {
				attachedFiles: [],
				attachedSelections: [],
				issueUrls: [],
				notes: '',
			});

			await missionService.submitForPlanning(mission.id);
			setOutcome('');
			setSelectedMission(mission);
		} catch (error) {
			console.error('Failed to create mission:', error);
		}
	};

	const handleMissionClick = (mission: Mission) => {
		setSelectedMission(mission);
	};

	const handleCloseDetail = () => {
		setSelectedMission(null);
	};

	return (
		<div className="p-4 h-full flex flex-col">
			{/* Outcome Input */}
			<div className="mb-4">
				<textarea
					value={outcome}
					onChange={(e) => setOutcome(e.target.value)}
					placeholder="Describe what you want to achieve..."
					className="w-full h-24 p-3 rounded-lg border-2 resize-none focus:outline-none"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-gold, #C6AA58)',
						color: 'var(--ribix-text-primary, #F5F0E8)',
					}}
				/>
				<button
					onClick={handlePlanThis}
					disabled={!outcome.trim()}
					className="mt-2 px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					style={{
						backgroundColor: 'var(--ribix-gold, #C6AA58)',
						color: 'var(--ribix-bg-primary, #01311F)',
					}}
				>
					Plan This
				</button>
			</div>

			{/* Mission List */}
			<div className="flex-1 overflow-auto">
				<h3 className="text-sm font-semibold mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
					Missions
				</h3>
				{missions.length === 0 ? (
					<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
						No missions yet. Create your first mission above.
					</div>
				) : (
					<div className="space-y-3">
						{missions.map((mission) => (
							<RibixMissionCard
								key={mission.id}
								mission={mission}
								onClick={() => handleMissionClick(mission)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Mission Detail Dialog */}
			{selectedMission && (
				<RibixPlanReviewDialog
					mission={selectedMission}
					onClose={handleCloseDetail}
				/>
			)}
		</div>
	);
};