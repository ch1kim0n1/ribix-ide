/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MissionTelemetryService, MissionOutcome } from '../../browser/missionTelemetry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutcome(over: Partial<MissionOutcome> = {}): MissionOutcome {
	return {
		missionId: 'm1',
		status: 'success',
		agentCount: 1,
		findingsCount: 0,
		durationMs: 1000,
		...over,
	};
}

// ---------------------------------------------------------------------------

suite('MissionTelemetryService — record and accumulation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('record() adds the outcome to the internal list', () => {
		const svc = new MissionTelemetryService();
		const o = makeOutcome({ missionId: 'a1' });
		svc.record(o);
		// Verify via getSummary which reflects the internal outcomes array.
		assert.strictEqual(svc.getSummary().total, 1);
	});

	test('multiple record() calls accumulate correctly', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ missionId: 'a', status: 'success' }));
		svc.record(makeOutcome({ missionId: 'b', status: 'success' }));
		svc.record(makeOutcome({ missionId: 'c', status: 'failed' }));
		svc.record(makeOutcome({ missionId: 'd', status: 'user_cancelled' }));
		assert.strictEqual(svc.getSummary().total, 4);
		assert.strictEqual(svc.getSummary().success, 2);
		assert.strictEqual(svc.getSummary().failed, 2);
	});
});

suite('MissionTelemetryService — getSuccessRate()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns 0 when no missions have been recorded', () => {
		const svc = new MissionTelemetryService();
		assert.strictEqual(svc.getSuccessRate(), 0);
	});

	test('3 successes + 1 failure → 0.75', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'failed' }));
		assert.strictEqual(svc.getSuccessRate(), 0.75);
	});

	test('all failures → 0', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'failed' }));
		svc.record(makeOutcome({ status: 'user_cancelled' }));
		assert.strictEqual(svc.getSuccessRate(), 0);
	});

	test('all successes → 1', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'success' }));
		assert.strictEqual(svc.getSuccessRate(), 1);
	});

	test('partial status is not counted as success', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'partial' }));
		svc.record(makeOutcome({ status: 'success' }));
		// 1 success out of 2 = 0.5
		assert.strictEqual(svc.getSuccessRate(), 0.5);
	});
});

suite('MissionTelemetryService — getSummary()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns correct total, success, failed, and successRate string for 3 success + 1 fail', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'success' }));
		svc.record(makeOutcome({ status: 'failed' }));

		const summary = svc.getSummary();
		assert.strictEqual(summary.total, 4);
		assert.strictEqual(summary.success, 3);
		assert.strictEqual(summary.failed, 1);
		assert.strictEqual(summary.successRate, '75.0%');
	});

	test('returns "0.0%" successRate when no missions recorded', () => {
		const svc = new MissionTelemetryService();
		const summary = svc.getSummary();
		assert.strictEqual(summary.total, 0);
		assert.strictEqual(summary.success, 0);
		assert.strictEqual(summary.failed, 0);
		assert.strictEqual(summary.successRate, '0.0%');
	});

	test('user_cancelled counts toward failed in getSummary()', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'user_cancelled' }));
		svc.record(makeOutcome({ status: 'success' }));

		const summary = svc.getSummary();
		assert.strictEqual(summary.failed, 1);
		assert.strictEqual(summary.success, 1);
		assert.strictEqual(summary.successRate, '50.0%');
	});

	test('partial status is not counted in success or failed', () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ status: 'partial' }));
		svc.record(makeOutcome({ status: 'partial' }));

		const summary = svc.getSummary();
		assert.strictEqual(summary.total, 2);
		assert.strictEqual(summary.success, 0);
		assert.strictEqual(summary.failed, 0);
		// successRate = 0 / 2 = 0.0%
		assert.strictEqual(summary.successRate, '0.0%');
	});
});

suite('MissionTelemetryService — persist()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('persist() writes JSONL-encoded outcomes to the given URI', async () => {
		const svc = new MissionTelemetryService();
		const o1 = makeOutcome({ missionId: 'p1', status: 'success' });
		const o2 = makeOutcome({ missionId: 'p2', status: 'failed' });
		svc.record(o1);
		svc.record(o2);

		let writtenData: Uint8Array | undefined;

		const fakeFs = {
			readFile: async (_uri: any) => { throw new Error('not found'); },
			writeFile: async (_uri: any, data: Uint8Array) => { writtenData = data; },
		};

		// Temporarily stub vscode.workspace.fs.
		const vscodeModule = await import('vscode');
		const originalFs = vscodeModule.workspace.fs;
		(vscodeModule.workspace as any).fs = fakeFs;

		try {
			await svc.persist({ toString: () => 'file:///store.jsonl' } as any);
		} finally {
			(vscodeModule.workspace as any).fs = originalFs;
		}

		assert.ok(writtenData, 'writeFile should have been called');
		const text = new TextDecoder().decode(writtenData);
		const lines = text.trim().split('\n');
		assert.strictEqual(lines.length, 2);
		assert.deepStrictEqual(JSON.parse(lines[0]), o1);
		assert.deepStrictEqual(JSON.parse(lines[1]), o2);
	});

	test('persist() appends to existing file content', async () => {
		const svc = new MissionTelemetryService();
		svc.record(makeOutcome({ missionId: 'new' }));

		const existing = new TextEncoder().encode(JSON.stringify(makeOutcome({ missionId: 'old' })) + '\n');
		let writtenData: Uint8Array | undefined;

		const fakeFs = {
			readFile: async (_uri: any) => existing,
			writeFile: async (_uri: any, data: Uint8Array) => { writtenData = data; },
		};

		const vscodeModule = await import('vscode');
		const originalFs = vscodeModule.workspace.fs;
		(vscodeModule.workspace as any).fs = fakeFs;

		try {
			await svc.persist({ toString: () => 'file:///store.jsonl' } as any);
		} finally {
			(vscodeModule.workspace as any).fs = originalFs;
		}

		assert.ok(writtenData);
		const text = new TextDecoder().decode(writtenData);
		const lines = text.trim().split('\n');
		assert.strictEqual(lines.length, 2, 'old + new line');
		assert.strictEqual(JSON.parse(lines[0]).missionId, 'old');
		assert.strictEqual(JSON.parse(lines[1]).missionId, 'new');
	});
});
