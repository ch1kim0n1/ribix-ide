/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt in the project root.
 *--------------------------------------------------------------------------------------*/

/**
 * WCAG Accessibility Compliance Checker
 *
 * Implements contrast ratio calculation per WCAG 2.1 using the relative luminance
 * formula defined in https://www.w3.org/TR/WCAG21/#dfn-relative-luminance.
 *
 * Criteria checked:
 *   1.4.3 Contrast (Minimum) — Level AA
 *     Normal text:  4.5:1
 *     Large text:   3:1
 *   1.4.6 Contrast (Enhanced) — Level AAA
 *     Normal text:  7:1
 *     Large text:   4.5:1
 *
 * Usage in the Design Reviewer agent:
 *   const violations = checkContrastRatio('#ffffff', '#767676');
 *   const summary = getWCAGSummary(violations);
 *   // summary.level → 'AA' | 'AA-partial' | 'fail'
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WCAGViolation {
	/** e.g. "1.4.3 Contrast (Minimum)" */
	criterion: string;
	level: 'A' | 'AA' | 'AAA';
	description: string;
	/** e.g. "3.2:1" */
	currentValue: string;
	/** e.g. "4.5:1" */
	requiredValue: string;
	passed: boolean;
}

export interface WCAGSummary {
	level: 'AA' | 'AA-partial' | 'fail';
	passCount: number;
	failCount: number;
	label: string;
}

// ---------------------------------------------------------------------------
// Colour parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSS colour string into [r, g, b] in the range 0–255.
 * Supports:
 *   - 6-digit hex  #rrggbb
 *   - 3-digit hex  #rgb
 *   - rgb(r, g, b)
 *   - rgba(r, g, b, a)  — alpha ignored for luminance
 *
 * Returns null for unrecognised formats.
 */
function parseColor(color: string): [number, number, number] | null {
	const s = color.trim().toLowerCase();

	// #rrggbb
	const hex6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
	if (hex6) {
		return [
			parseInt(hex6[1], 16),
			parseInt(hex6[2], 16),
			parseInt(hex6[3], 16),
		];
	}

	// #rgb → expand to #rrggbb
	const hex3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
	if (hex3) {
		return [
			parseInt(hex3[1] + hex3[1], 16),
			parseInt(hex3[2] + hex3[2], 16),
			parseInt(hex3[3] + hex3[3], 16),
		];
	}

	// rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		return [
			Math.min(255, parseInt(rgbMatch[1], 10)),
			Math.min(255, parseInt(rgbMatch[2], 10)),
			Math.min(255, parseInt(rgbMatch[3], 10)),
		];
	}

	return null;
}

// ---------------------------------------------------------------------------
// Relative luminance  (WCAG 2.1 §1.4.3)
// ---------------------------------------------------------------------------

/**
 * Convert an 8-bit channel value to its linearised sRGB component.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function linearise(c8bit: number): number {
	const c = c8bit / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute relative luminance of an RGB triplet.
 * L = 0.2126·R + 0.7152·G + 0.0722·B  (linearised values)
 */
function relativeLuminance(r: number, g: number, b: number): number {
	return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the WCAG contrast ratio between two CSS colour strings.
 * Returns a value in the range [1, 21].  Returns 1 (minimum) when either
 * colour cannot be parsed.
 *
 * Formula: (L1 + 0.05) / (L2 + 0.05)  where L1 ≥ L2
 */
export function computeContrastRatio(color1: string, color2: string): number {
	const rgb1 = parseColor(color1);
	const rgb2 = parseColor(color2);
	if (!rgb1 || !rgb2) {
		return 1; // unknown — assume worst case (no contrast)
	}

	const l1 = relativeLuminance(...rgb1);
	const l2 = relativeLuminance(...rgb2);

	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check a foreground/background colour pair against WCAG 1.4.3 (AA) and 1.4.6 (AAA).
 * Returns one WCAGViolation per criterion/text-size combination.
 */
export function checkContrastRatio(foreground: string, background: string): WCAGViolation[] {
	const ratio = computeContrastRatio(foreground, background);
	const ratioLabel = `${ratio.toFixed(2)}:1`;

	const violations: WCAGViolation[] = [];

	// 1.4.3 Contrast (Minimum) — AA — normal text 4.5:1
	violations.push({
		criterion: '1.4.3 Contrast (Minimum)',
		level: 'AA',
		description: 'Normal text must have a contrast ratio of at least 4.5:1.',
		currentValue: ratioLabel,
		requiredValue: '4.5:1',
		passed: ratio >= 4.5,
	});

	// 1.4.3 Contrast (Minimum) — AA — large text 3:1
	violations.push({
		criterion: '1.4.3 Contrast (Minimum) — Large Text',
		level: 'AA',
		description: 'Large text (≥18pt regular or ≥14pt bold) must have a contrast ratio of at least 3:1.',
		currentValue: ratioLabel,
		requiredValue: '3:1',
		passed: ratio >= 3,
	});

	// 1.4.6 Contrast (Enhanced) — AAA — normal text 7:1
	violations.push({
		criterion: '1.4.6 Contrast (Enhanced)',
		level: 'AAA',
		description: 'Normal text must have a contrast ratio of at least 7:1 for AAA compliance.',
		currentValue: ratioLabel,
		requiredValue: '7:1',
		passed: ratio >= 7,
	});

	// 1.4.6 Contrast (Enhanced) — AAA — large text 4.5:1
	violations.push({
		criterion: '1.4.6 Contrast (Enhanced) — Large Text',
		level: 'AAA',
		description: 'Large text must have a contrast ratio of at least 4.5:1 for AAA compliance.',
		currentValue: ratioLabel,
		requiredValue: '4.5:1',
		passed: ratio >= 4.5,
	});

	return violations;
}

/**
 * Summarise a set of WCAGViolations into an AA-level compliance verdict.
 *
 * - 'AA'         — all AA criteria pass
 * - 'AA-partial' — some AA criteria pass (large-text passes, normal-text fails)
 * - 'fail'       — no AA criteria pass
 */
export function getWCAGSummary(violations: WCAGViolation[]): WCAGSummary {
	const aaViolations = violations.filter(v => v.level === 'AA');
	const passCount = violations.filter(v => v.passed).length;
	const failCount = violations.filter(v => !v.passed).length;

	const aaPass = aaViolations.filter(v => v.passed).length;
	const aaFail = aaViolations.filter(v => !v.passed).length;

	let level: 'AA' | 'AA-partial' | 'fail';
	let label: string;

	if (aaFail === 0) {
		level = 'AA';
		label = `WCAG AA compliant (${passCount}/${violations.length} criteria passed)`;
	} else if (aaPass > 0) {
		level = 'AA-partial';
		label = `WCAG AA partial — ${aaFail} AA criterion/criteria failed (${passCount}/${violations.length} total passed)`;
	} else {
		level = 'fail';
		label = `WCAG AA fail — all normal-text contrast criteria failed (ratio too low)`;
	}

	return { level, passCount, failCount, label };
}
