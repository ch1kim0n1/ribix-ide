/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useAccessor } from '../util/services.js';
import {
	IRibixBackendSseService,
	StateCoverageEntry,
	AppStateKind,
	ALL_APP_STATES,
} from '../../../ribixBackendSseService.js';

interface ribixStateCoverageProps {
	missionId: string;
}

const STATE_LABEL: Record<AppStateKind, string> = {
	'empty': 'Empty',
	'loading': 'Loading',
	'error': 'Error',
	'404': '404',
	'offline': 'Offline',
	'first-run': 'First run',
	'post-delete': 'Post-delete',
	'validation-failed': 'Validation failed',
};

/** Green for good scores, gold for middling, red for poor. */
const scoreColor = (score: number): string => {
	if (score >= 80) { return 'var(--ribix-success, #4E9A51)'; }
	if (score >= 50) { return 'var(--ribix-gold, #C6AA58)'; }
	return 'var(--ribix-error, #C23B22)';
};

/**
 * State-coverage view (#108). Renders a grid of every app-state the FAFO engine can reach;
 * states that were reached during the run show their vision-critique score and thumbnail,
 * while states that were not reached are shown as gaps ("you have not tested your X state").
 * Clicking a reached state opens its full critique detail.
 */
export const RibixStateCoverage = ({ missionId }: ribixStateCoverageProps) => {
	const accessor = useAccessor();
	const sseService = accessor.get(IRibixBackendSseService);

	const [entries, setEntries] = useState<StateCoverageEntry[]>(
		() => sseService.getStateCoverage(missionId)
	);
	const [opened, setOpened] = useState<StateCoverageEntry | null>(null);

	useEffect(() => {
		setEntries(sseService.getStateCoverage(missionId));
		const disposable = sseService.onDidChangeRunEvents(() => {
			setEntries(sseService.getStateCoverage(missionId));
		});
		return () => disposable.dispose();
	}, [sseService, missionId]);

	const byState = new Map<AppStateKind, StateCoverageEntry>();
	for (const e of entries) { byState.set(e.state, e); }

	const reachedCount = byState.size;

	return (
		<div>
			<p className="text-xs mb-3 text-[var(--ribix-text-secondary, #8A9E8A)]">
				{reachedCount} of {ALL_APP_STATES.length} states reached
			</p>

			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
				{ALL_APP_STATES.map(state => {
					const entry = byState.get(state);
					const reached = !!entry;
					return (
						<div
							key={state}
							onClick={() => entry && setOpened(entry)}
							className={`p-3 rounded-lg border ${reached ? 'cursor-pointer hover:opacity-90' : ''}`}
							style={{
								backgroundColor: 'var(--ribix-bg-secondary, #012B1A)',
								borderColor: reached ? 'var(--ribix-border, #1E4A32)' : 'var(--ribix-warning, #D4820A)',
								opacity: reached ? 1 : 0.7,
							}}
						>
							<div className="flex items-center justify-between mb-1">
								<span className="text-sm font-medium text-[var(--ribix-text-primary, #F5F0E8)]">
									{STATE_LABEL[state]}
								</span>
								{reached ? (
									<span className="text-sm font-bold" style={{ color: scoreColor(entry.score) }}>
										{entry.score}
									</span>
								) : (
									<span className="text-xs" style={{ color: 'var(--ribix-warning, #D4820A)' }}>gap</span>
								)}
							</div>
							{reached ? (
								entry.screenshotPath ? (
									<img
										src={`file://${entry.screenshotPath}`}
										alt={`${STATE_LABEL[state]} state`}
										className="mt-1 w-full rounded border"
										style={{ borderColor: 'var(--ribix-border, #1E4A32)' }}
									/>
								) : (
									<p className="text-xs italic text-[var(--ribix-text-secondary, #8A9E8A)]">
										No thumbnail captured.
									</p>
								)
							) : (
								<p className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
									You have not tested your {STATE_LABEL[state].toLowerCase()} state.
								</p>
							)}
						</div>
					);
				})}
			</div>

			{/* Critique detail for a clicked state */}
			{opened && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setOpened(null)}>
					<div
						className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-lg shadow-2xl p-4"
						style={{
							backgroundColor: 'var(--ribix-bg-primary, #01311F)',
							border: '1px solid var(--ribix-border, #1E4A32)',
						}}
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<h3 className="text-base font-semibold text-[var(--ribix-text-primary, #F5F0E8)]">
								{STATE_LABEL[opened.state]} state
								<span className="ml-2 text-sm font-bold" style={{ color: scoreColor(opened.score) }}>
									{opened.score}
								</span>
							</h3>
							<button
								onClick={() => setOpened(null)}
								className="text-[var(--ribix-text-secondary, #8A9E8A)] hover:text-[var(--ribix-text-primary, #F5F0E8)] text-2xl"
							>
								×
							</button>
						</div>
						{opened.screenshotPath && (
							<img
								src={`file://${opened.screenshotPath}`}
								alt={`${STATE_LABEL[opened.state]} state`}
								className="mb-3 max-w-full rounded border"
								style={{ borderColor: 'var(--ribix-gold, #C6AA58)' }}
							/>
						)}
						<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] whitespace-pre-wrap">
							{opened.critique || 'No critique detail provided for this state.'}
						</p>
					</div>
				</div>
			)}
		</div>
	);
};
