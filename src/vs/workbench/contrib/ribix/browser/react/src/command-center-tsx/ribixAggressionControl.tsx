/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';

/** Aggression levels for a user-qa run (#103). */
export type Aggression = 'light' | 'default' | 'chaos';

export const AGGRESSION_LEVELS: readonly Aggression[] = ['light', 'default', 'chaos'];

interface ribixAggressionControlProps {
	value: Aggression;
	onChange: (level: Aggression) => void;
	/** Fired when the user confirms a Chaos Run against the configured staging environment. */
	onChaosRun: () => void;
	disabled?: boolean;
}

const LEVEL_LABEL: Record<Aggression, string> = {
	light: 'Light',
	default: 'Default',
	chaos: 'Chaos',
};

const LEVEL_HINT: Record<Aggression, string> = {
	light: 'Gentle, read-mostly exploration. Avoids risky inputs.',
	default: 'Balanced user-QA: realistic interactions and edge cases.',
	chaos: 'Aggressive FAFO: malformed inputs, rapid actions, and destructive paths against staging.',
};

/**
 * Aggression selector + "Chaos Run" quick action for the Command Center mission input (#103).
 * The selected level is passed through to the user-qa run by the missions panel; the Chaos Run
 * button triggers an aggression=chaos run after a confirmation dialog explaining what it does.
 */
export const RibixAggressionControl = ({ value, onChange, onChaosRun, disabled }: ribixAggressionControlProps) => {
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="mt-2 flex items-center gap-2 flex-wrap">
			<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">Aggression</span>
			<div
				className="inline-flex rounded overflow-hidden"
				style={{ border: '1px solid var(--ribix-border, #1E4A32)' }}
				role="radiogroup"
				aria-label="QA aggression level"
			>
				{AGGRESSION_LEVELS.map(level => {
					const active = value === level;
					return (
						<button
							key={level}
							type="button"
							role="radio"
							aria-checked={active}
							title={LEVEL_HINT[level]}
							onClick={() => onChange(level)}
							className="px-3 py-1 text-xs font-medium transition-colors"
							style={{
								backgroundColor: active ? 'var(--ribix-gold, #C6AA58)' : 'transparent',
								color: active ? 'var(--ribix-bg-primary, #01311F)' : 'var(--ribix-text-secondary, #8A9E8A)',
							}}
						>
							{LEVEL_LABEL[level]}
						</button>
					);
				})}
			</div>

			<button
				type="button"
				disabled={disabled}
				onClick={() => setConfirming(true)}
				className="px-3 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
				style={{
					backgroundColor: 'var(--ribix-error, #C23B22)',
					color: 'var(--ribix-text-primary, #F5F0E8)',
				}}
				title="Run a chaos-mode user-QA pass against the configured staging environment"
			>
				⚡ Chaos Run
			</button>

			{confirming && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
					<div
						className="w-full max-w-md rounded-lg shadow-2xl p-5"
						style={{
							backgroundColor: 'var(--ribix-bg-primary, #01311F)',
							border: '1px solid var(--ribix-error, #C23B22)',
						}}
						role="alertdialog"
						aria-label="Confirm chaos run"
					>
						<h3 className="text-base font-semibold mb-2 text-[var(--ribix-error, #C23B22)]">
							Start a Chaos Run?
						</h3>
						<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] mb-2">
							Chaos mode runs an aggressive user-QA pass against your configured <strong>staging</strong>
							{' '}environment. The agent will:
						</p>
						<ul className="text-sm text-[var(--ribix-text-secondary, #8A9E8A)] list-disc pl-5 mb-3 space-y-1">
							<li>Submit malformed and edge-case inputs</li>
							<li>Click rapidly and out of order</li>
							<li>Attempt destructive paths (you approve any prod action mid-run)</li>
						</ul>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
								style={{
									backgroundColor: 'transparent',
									border: '1px solid var(--ribix-border, #1E4A32)',
									color: 'var(--ribix-text-primary, #F5F0E8)',
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									setConfirming(false);
									onChange('chaos');
									onChaosRun();
								}}
								className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
								style={{
									backgroundColor: 'var(--ribix-error, #C23B22)',
									color: 'var(--ribix-text-primary, #F5F0E8)',
								}}
							>
								Start Chaos Run
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
