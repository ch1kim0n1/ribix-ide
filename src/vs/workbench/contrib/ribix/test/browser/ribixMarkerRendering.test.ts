/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { markerSeverityForRisk, findingToMarker, RIBIX_MARKER_OWNER } from '../../browser/ribixMarkerRendering.js';
import type { AgentFinding } from '../../common/ribixTypes.js';

// ---------------------------------------------------------------------------
// markerSeverityForRisk — RiskLevel → MarkerSeverity mapping
// ---------------------------------------------------------------------------

suite('markerSeverityForRisk', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('high → Error', () => {
		assert.strictEqual(markerSeverityForRisk('high'), MarkerSeverity.Error);
	});

	test('medium → Warning', () => {
		assert.strictEqual(markerSeverityForRisk('medium'), MarkerSeverity.Warning);
	});

	test('low → Info', () => {
		assert.strictEqual(markerSeverityForRisk('low'), MarkerSeverity.Info);
	});

	test('unknown severity defaults to Info', () => {
		// The default case in the switch returns Info
		assert.strictEqual(markerSeverityForRisk('unknown' as any), MarkerSeverity.Info);
	});
});

// ---------------------------------------------------------------------------
// findingToMarker — AgentFinding → IMarkerData conversion
// ---------------------------------------------------------------------------

suite('findingToMarker', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('converts a finding with a line number', () => {
		const finding: AgentFinding = {
			severity: 'high',
			file: 'src/index.ts',
			line: 42,
			message: 'Critical bug',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.severity, MarkerSeverity.Error);
		assert.strictEqual(marker.message, 'Critical bug');
		assert.strictEqual(marker.source, 'Ribix');
		assert.strictEqual(marker.startLineNumber, 42);
		assert.strictEqual(marker.endLineNumber, 42);
		assert.strictEqual(marker.startColumn, 1);
		assert.strictEqual(marker.endColumn, 1);
	});

	test('anchors findings without a line to line 1', () => {
		const finding: AgentFinding = {
			severity: 'low',
			file: 'src/index.ts',
			line: null,
			message: 'Minor issue',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.startLineNumber, 1);
		assert.strictEqual(marker.endLineNumber, 1);
	});

	test('anchors findings with line 0 to line 1', () => {
		const finding: AgentFinding = {
			severity: 'medium',
			file: 'src/index.ts',
			line: 0,
			message: 'Zero line',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.startLineNumber, 1);
	});

	test('anchors findings with negative line to line 1', () => {
		const finding: AgentFinding = {
			severity: 'medium',
			file: 'src/index.ts',
			line: -5,
			message: 'Negative line',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.startLineNumber, 1);
	});

	test('prepends findingType to message when present', () => {
		const finding: AgentFinding = {
			severity: 'high',
			file: 'src/index.ts',
			line: 10,
			message: 'Unhandled error',
			findingType: 'observability-gap',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.message, '[observability-gap] Unhandled error');
	});

	test('does not prepend findingType when absent', () => {
		const finding: AgentFinding = {
			severity: 'high',
			file: 'src/index.ts',
			line: 10,
			message: 'Just a message',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.message, 'Just a message');
	});

	test('maps medium severity to Warning', () => {
		const finding: AgentFinding = {
			severity: 'medium',
			file: 'src/index.ts',
			line: 1,
			message: 'Warning level',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.severity, MarkerSeverity.Warning);
	});

	test('maps low severity to Info', () => {
		const finding: AgentFinding = {
			severity: 'low',
			file: 'src/index.ts',
			line: 1,
			message: 'Info level',
		};
		const marker = findingToMarker(finding);
		assert.strictEqual(marker.severity, MarkerSeverity.Info);
	});

	test('always sets source to Ribix', () => {
		const finding: AgentFinding = {
			severity: 'low',
			file: 'any',
			line: 1,
			message: 'msg',
		};
		assert.strictEqual(findingToMarker(finding).source, 'Ribix');
	});
});

// ---------------------------------------------------------------------------
// RIBIX_MARKER_OWNER
// ---------------------------------------------------------------------------

suite('RIBIX_MARKER_OWNER', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('is the string "ribix"', () => {
		assert.strictEqual(RIBIX_MARKER_OWNER, 'ribix');
	});
});
