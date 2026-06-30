/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { UxVisionNote } from '../../../ribixDiffAnnotationWidget.js';

interface ribixUxVisionProps {
	notes: UxVisionNote[];
}

const SEVERITY_COLOR: Record<string, string> = {
	high: '#E5534B',
	medium: '#C6AA58',
	low: '#8A9E8A',
};

/**
 * UX-vision section in mission detail (#116). Renders the QA browser agent's visual critique:
 * a textual note + annotated suggestion, plus the rendered-region screenshot when one was
 * captured. When the browser tool was unavailable the note has no screenshot and degrades
 * gracefully to text-only.
 */
export const RibixUxVision = ({ notes }: ribixUxVisionProps) => {
	if (notes.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			{notes.map((note, index) => (
				<div
					key={index}
					className="p-4 rounded-lg border"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-border, #1E4A32)',
					}}
				>
					<div className="flex items-center gap-2 mb-2">
						<span
							className="text-xs font-semibold uppercase"
							style={{ color: SEVERITY_COLOR[note.severity] ?? '#8A9E8A' }}
						>
							{note.severity}
						</span>
						<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]">
							{note.filePath}{note.line ? `:${note.line}` : ''}
						</span>
					</div>
					<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)]">{note.message}</p>
					{note.suggestion && (
						<p className="text-sm mt-2 text-[var(--ribix-text-secondary, #8A9E8A)]">
							<span className="text-[var(--ribix-gold, #C6AA58)]">Suggestion: </span>
							{note.suggestion}
						</p>
					)}
					{note.screenshotPath ? (
						<img
							src={`file://${note.screenshotPath}`}
							alt="Rendered region screenshot"
							className="mt-3 max-w-full rounded border"
							style={{ borderColor: 'var(--ribix-gold, #C6AA58)' }}
						/>
					) : (
						<p className="text-xs mt-2 italic text-[var(--ribix-text-secondary, #8A9E8A)]">
							Screenshot unavailable — text-only critique.
						</p>
					)}
				</div>
			))}
		</div>
	);
};
