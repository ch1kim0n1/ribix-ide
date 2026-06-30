/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { AgentFinding, AgentFindingType, DETECTION_CATEGORY_DESCRIPTIONS, Mission } from '../../../../common/ribixTypes.js';

interface ribixDiffSummaryProps {
	mission: Mission;
	/**
	 * Structured reviewer findings (#106, #110). When provided, the panel renders the
	 * rich findings UI — detection-category filter, category badges, and ensemble
	 * critique (contested flag + percentile). When absent, it falls back to the plain
	 * `mission.result.reviewerFindings` string list. The mission/backend layer must
	 * populate this for categories and ensemble data to appear.
	 */
	findings?: AgentFinding[];
}

/** Short label per detection category for the badge / filter chip. */
const CATEGORY_LABELS: Record<AgentFindingType, string> = {
	'data-loss-risk': 'Data loss',
	'rate-limit-blind': 'Rate limit',
	'env-parity': 'Env parity',
	'third-party-resilience': '3rd-party',
	'legal-compliance': 'Legal',
	'copy-consistency': 'Copy',
	'observability-gap': 'Observability',
	'day-2-failure': 'Day-2',
	'code-architecture': 'Architecture',
	'onboarding-drop-off': 'Onboarding',
	'ai-smell': 'AI smell',
	'ui_vision': 'UX vision',
};

const cardStyle = {
	backgroundColor: 'var(--ribix-bg-primary, #01311F)',
	borderColor: 'var(--ribix-border, #1E4A32)',
};

export const RibixDiffSummary = ({ mission, findings }: ribixDiffSummaryProps) => {
	const [activeCategories, setActiveCategories] = useState<Set<AgentFindingType>>(new Set());

	// Categories present across the structured findings, in declaration order.
	const presentCategories = useMemo<AgentFindingType[]>(() => {
		const seen = new Set<AgentFindingType>();
		for (const f of findings ?? []) {
			if (f.findingType) { seen.add(f.findingType); }
		}
		return (Object.keys(DETECTION_CATEGORY_DESCRIPTIONS) as AgentFindingType[]).filter(c => seen.has(c));
	}, [findings]);

	const visibleFindings = useMemo<AgentFinding[]>(() => {
		if (!findings) { return []; }
		if (activeCategories.size === 0) { return findings; }
		return findings.filter(f => f.findingType && activeCategories.has(f.findingType));
	}, [findings, activeCategories]);

	if (!mission.result) {
		return (
			<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
				No result available.
			</div>
		);
	}

	const { result } = mission;
	const hasStructured = !!findings && findings.length > 0;

	const toggleCategory = (cat: AgentFindingType) => {
		setActiveCategories(prev => {
			const next = new Set(prev);
			if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
			return next;
		});
	};

	return (
		<div className="space-y-4">
			{/* Summary */}
			<div className="p-4 rounded-lg border" style={cardStyle}>
				<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
					Summary
				</h4>
				<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)]">{result.summary}</p>
			</div>

			{/* Files Changed */}
			<div className="p-4 rounded-lg border" style={cardStyle}>
				<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
					Files Changed ({result.filesChanged.length})
				</h4>
				{result.filesChanged.length === 0 ? (
					<p className="text-sm text-[var(--ribix-text-secondary, #8A9E8A)]">No files changed.</p>
				) : (
					<ul className="space-y-1">
						{result.filesChanged.map((file, index) => (
							<li
								key={index}
								className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] flex items-center"
							>
								<span className="text-[var(--ribix-gold, #C6AA58)] mr-2">•</span>
								{file}
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Test Report */}
			{result.testReport && (
				<div className="p-4 rounded-lg border" style={cardStyle}>
					<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
						Test Report
					</h4>
					<pre className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] whitespace-pre-wrap font-mono">
						{result.testReport}
					</pre>
				</div>
			)}

			{/* Reviewer Findings — structured (rich) variant */}
			{hasStructured ? (
				<div className="p-4 rounded-lg border" style={cardStyle}>
					<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
						Reviewer Findings ({visibleFindings.length}{activeCategories.size > 0 ? ` of ${findings!.length}` : ''})
					</h4>

					{/* Detection-category filter chips (#110) */}
					{presentCategories.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-3">
							{presentCategories.map(cat => {
								const on = activeCategories.has(cat);
								return (
									<button
										key={cat}
										type="button"
										onClick={() => toggleCategory(cat)}
										title={DETECTION_CATEGORY_DESCRIPTIONS[cat]}
										className="text-xs px-2 py-0.5 rounded-full border transition-colors"
										style={{
											backgroundColor: on ? 'var(--ribix-gold, #C6AA58)' : 'transparent',
											borderColor: 'var(--ribix-gold, #C6AA58)',
											color: on ? 'var(--ribix-bg-primary, #01311F)' : 'var(--ribix-gold, #C6AA58)',
										}}
									>
										{CATEGORY_LABELS[cat]}
									</button>
								);
							})}
							{activeCategories.size > 0 && (
								<button
									type="button"
									onClick={() => setActiveCategories(new Set())}
									className="text-xs px-2 py-0.5 rounded-full text-[var(--ribix-text-secondary, #8A9E8A)] hover:underline"
								>
									Clear
								</button>
							)}
						</div>
					)}

					{visibleFindings.length === 0 ? (
						<p className="text-sm text-[var(--ribix-text-secondary, #8A9E8A)]">
							No findings in the selected categories.
						</p>
					) : (
						<ul className="space-y-2">
							{visibleFindings.map((finding, index) => (
								<li
									key={index}
									className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] flex items-start"
								>
									<span className="text-[var(--ribix-gold, #C6AA58)] mr-2 mt-1">•</span>
									<div className="flex-1">
										<div className="flex flex-wrap items-center gap-2 mb-0.5">
											{finding.findingType && (
												<span
													className="text-xs px-1.5 py-0.5 rounded border"
													style={{
														borderColor: 'var(--ribix-border, #1E4A32)',
														color: 'var(--ribix-text-secondary, #8A9E8A)',
													}}
													title={DETECTION_CATEGORY_DESCRIPTIONS[finding.findingType]}
												>
													{CATEGORY_LABELS[finding.findingType]}
												</span>
											)}
											{/* Ensemble: contested flag (#106) */}
											{finding.ensemble?.contested && (
												<span
													className="text-xs px-1.5 py-0.5 rounded font-semibold"
													style={{ backgroundColor: '#E5534B', color: '#fff' }}
													title="Models disagreed on this finding"
												>
													Contested
												</span>
											)}
											{/* Ensemble: percentile ranking (#106) */}
											{finding.ensemble?.percentile !== undefined && (
												<span
													className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)]"
													title="Position against the benchmark corpus"
												>
													{Math.round(finding.ensemble.percentile)}th pct
												</span>
											)}
										</div>
										<span>
											{finding.file ? <span className="text-[var(--ribix-text-secondary, #8A9E8A)]">{finding.file}{finding.line ? `:${finding.line}` : ''} — </span> : null}
											{finding.message}
										</span>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			) : (
				result.reviewerFindings.length > 0 && (
					<div className="p-4 rounded-lg border" style={cardStyle}>
						<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
							Reviewer Findings ({result.reviewerFindings.length})
						</h4>
						<ul className="space-y-2">
							{result.reviewerFindings.map((finding, index) => (
								<li
									key={index}
									className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] flex items-start"
								>
									<span className="text-[var(--ribix-gold, #C6AA58)] mr-2 mt-1">•</span>
									<span>{finding}</span>
								</li>
							))}
						</ul>
					</div>
				)
			)}

			{/* Links */}
			<div className="flex gap-3">
				{result.commitSha && (
					<a
						href={`#commit-${result.commitSha}`}
						className="text-sm text-[var(--ribix-gold, #C6AA58)] hover:underline"
					>
						View Commit ({result.commitSha.substring(0, 8)})
					</a>
				)}
				{result.prUrl && (
					<a
						href={result.prUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm text-[var(--ribix-gold, #C6AA58)] hover:underline"
					>
						View Pull Request
					</a>
				)}
			</div>
		</div>
	);
};
