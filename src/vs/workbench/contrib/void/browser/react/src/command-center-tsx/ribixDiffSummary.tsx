/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Mission } from '../../../../common/ribixTypes.js';

interface ribixDiffSummaryProps {
	mission: Mission;
}

export const RibixDiffSummary = ({ mission }: ribixDiffSummaryProps) => {
	if (!mission.result) {
		return (
			<div className="text-center py-8 text-[var(--ribix-text-secondary, #8A9E8A)]">
				No result available.
			</div>
		);
	}

	const { result } = mission;

	return (
		<div className="space-y-4">
			{/* Summary */}
			<div
				className="p-4 rounded-lg border"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					borderColor: 'var(--ribix-border, #1E4A32)',
				}}
			>
				<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
					Summary
				</h4>
				<p className="text-sm text-[var(--ribix-text-primary, #F5F0E8)]">{result.summary}</p>
			</div>

			{/* Files Changed */}
			<div
				className="p-4 rounded-lg border"
				style={{
					backgroundColor: 'var(--ribix-bg-primary, #01311F)',
					borderColor: 'var(--ribix-border, #1E4A32)',
				}}
			>
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
				<div
					className="p-4 rounded-lg border"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-border, #1E4A32)',
					}}
				>
					<h4 className="text-sm font-semibold mb-2 text-[var(--ribix-text-primary, #F5F0E8)]">
						Test Report
					</h4>
					<pre className="text-sm text-[var(--ribix-text-primary, #F5F0E8)] whitespace-pre-wrap font-mono">
						{result.testReport}
					</pre>
				</div>
			)}

			{/* Reviewer Findings */}
			{result.reviewerFindings.length > 0 && (
				<div
					className="p-4 rounded-lg border"
					style={{
						backgroundColor: 'var(--ribix-bg-primary, #01311F)',
						borderColor: 'var(--ribix-border, #1E4A32)',
					}}
				>
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