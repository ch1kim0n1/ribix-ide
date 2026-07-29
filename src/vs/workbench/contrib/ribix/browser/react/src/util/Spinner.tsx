/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { CSSProperties } from 'react';

/**
 * A lightweight CSS-only spinner. Renders an inline-flex element so it can be
 * dropped into buttons, headings, or standalone loading blocks. The size and
 * color are driven by the current font-size / text color, so it inherits the
 * surrounding styles by default.
 *
 * Usage:
 *   <Spinner />                       // inherits size/color
 *   <Spinner className="w-4 h-4 text-[#C6AA58]" />
 */
export const Spinner = ({ className = '', style }: { className?: string, style?: CSSProperties }) => {
	return (
		<span
			className={`ribix-inline-block ribix-align-middle ${className}`}
			style={{
				width: '1em',
				height: '1em',
				border: '0.12em solid currentColor',
				borderTopColor: 'transparent',
				borderRadius: '50%',
				boxSizing: 'border-box',
				animation: 'ribix-spin 0.7s linear infinite',
				...style,
			}}
			role="status"
			aria-label="Loading"
		/>
	);
};

/**
 * A centered loading block with a spinner and optional descriptive text.
 * Useful as a placeholder while async data (missions, agents, etc.) loads.
 */
export const LoadingBlock = ({ text, className = '' }: { text?: string, className?: string }) => {
	return (
		<div className={`flex flex-col items-center justify-center gap-2 py-8 text-[var(--ribix-text-secondary,#8A9E8A)] ${className}`}>
			<Spinner className="w-5 h-5 text-[var(--ribix-gold,#C6AA58)]" />
			{text && <div className="text-sm opacity-80">{text}</div>}
		</div>
	);
};

/**
 * A skeleton placeholder row used while list content is loading.
 */
export const SkeletonRow = ({ className = '' }: { className?: string }) => {
	return (
		<div
			className={`rounded ${className}`}
			style={{
				height: '3rem',
				backgroundColor: 'rgba(255,255,255,0.05)',
				animation: 'ribix-pulse 1.4s ease-in-out infinite',
			}}
		/>
	);
};
