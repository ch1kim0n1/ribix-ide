/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { RibixMissionService } from '../../browser/ribixMissionService.js';
import { Mission, MISSION_SCHEMA_VERSION } from '../../common/ribixTypes.js';

// --- Stubs -------------------------------------------------------------------

/** Minimal in-memory IStorageService covering get/getBoolean/store for WORKSPACE scope. */
class FakeStorage {
	map = new Map<string, string>();
	get(key: string, _scope: any, fallback?: string) { return this.map.has(key) ? this.map.get(key) : fallback; }
	getBoolean(key: string, _scope: any, fallback?: boolean) {
		return this.map.has(key) ? this.map.get(key) === 'true' : fallback;
	}
	store(key: string, value: any, _scope: any, _target: any) { this.map.set(key, String(value)); }
}

class FakeMemory {
	deleted: string[] = [];
	constructor(public legacyEntries: Array<{ id: string; content: string }> = []) { }
	getWorkspaceId = async () => 'ws';
	getEntries = async (type: string) => (type === 'mission_summary' ? this.legacyEntries : []) as any;
	deleteEntry = async (id: string) => { this.deleted.push(id); };
	writeEntry = async (e: any) => e;
}

const mainProcessStub = { getChannel: (_n: string) => ({ call: async () => undefined, listen: () => ({ dispose() { } }) }) } as any;
const authStub = { onDidChangeSession: () => ({ dispose() { } }) } as any;
const planningStub = { plan: async () => [] } as any;
const workspaceStub = { getWorkspace: () => ({ folders: [{ uri: { fsPath: '/repo', toString: () => 'file:///repo' } }] }) } as any;
const hostStub = { onDidChangeFocus: () => ({ dispose() { } }) } as any;
const metricsStub = { capture: async () => { } } as any;
// .ribixignore loader probes exists(); return false so suppression is a no-op in these tests.
const fileStub = { exists: async () => false, readFile: async () => ({ value: { toString: () => '' } }) } as any;

function makeMissionService(storage: FakeStorage, memory: FakeMemory) {
	return new RibixMissionService(memory as any, mainProcessStub, authStub, planningStub, workspaceStub, storage as any, hostStub, metricsStub, fileStub);
}

function makeMission(over: Partial<Mission> = {}): Mission {
	return {
		schemaVersion: MISSION_SCHEMA_VERSION,
		id: 'm1', outcome: 'o', state: 'awaiting_outcome', tasks: [], agentIds: [],
		branchName: '', createdAt: 1, completedAt: null, result: null,
		...over,
	};
}

suite('RibixMissionService — persistence', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('createMission persists exactly one record under the missions key', async () => {
		const storage = new FakeStorage();
		const service = makeMissionService(storage, new FakeMemory());
		await service.createMission('build a thing', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		const raw = storage.map.get('ribix.missions.v1')!;
		const parsed = JSON.parse(raw);
		assert.strictEqual(parsed.schemaVersion, MISSION_SCHEMA_VERSION);
		assert.strictEqual(parsed.missions.length, 1);
		service.dispose();
	});

	test('N transitions on one mission yield exactly one persisted record', async () => {
		const storage = new FakeStorage();
		// Planner that never resolves, so submitForPlanning's fire-and-forget callback
		// does NOT auto-advance the mission to plan_ready — this test drives the
		// transitions manually and asserts update-in-place persistence.
		const pendingPlanning = { plan: () => new Promise<never>(() => { /* never resolves */ }) } as any;
		const service = new RibixMissionService(new FakeMemory() as any, mainProcessStub, authStub, pendingPlanning, workspaceStub, storage as any, hostStub, metricsStub, fileStub);
		const mission = await service.createMission('o', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		await service.submitForPlanning(mission.id);
		await service.setPlanReady(mission.id, []);
		await service.approvePlan(mission.id);

		const parsed = JSON.parse(storage.map.get('ribix.missions.v1')!);
		assert.strictEqual(parsed.missions.length, 1, 'update-in-place, not append');
		assert.strictEqual(parsed.missions[0].state, 'executing');
		service.dispose();
	});

	test('reload survives a restart with only well-formed missions', async () => {
		const storage = new FakeStorage();
		// Pre-seed the store with one good mission and one malformed entry.
		storage.map.set('ribix.missions.v1', JSON.stringify({
			schemaVersion: MISSION_SCHEMA_VERSION,
			missions: [makeMission({ id: 'good', state: 'complete' }), { garbage: true }],
		}));
		storage.map.set('ribix.missions.migrated', 'true');

		const service = makeMissionService(storage, new FakeMemory());
		// allow async load
		await service.createMission('trigger-load', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		const all = service.getAllMissions();
		const ids = all.map(m => m.id).sort();
		assert.ok(ids.includes('good'));
		assert.ok(!all.some(m => (m as any).garbage), 'malformed records dropped');
		service.dispose();
	});

	test('migration salvages mission-shaped legacy entries and ignores agent-shaped ones', async () => {
		const storage = new FakeStorage();
		const goodMission = makeMission({ id: 'legacy1', state: 'complete' });
		const memory = new FakeMemory([
			{ id: 'e1', content: JSON.stringify(goodMission) },                                  // real mission
			{ id: 'e2', content: JSON.stringify({ agentId: 'a', llmResponse: 'x', timestamp: 1 }) }, // agent summary
			{ id: 'e3', content: 'not json at all' },                                              // malformed
		]);
		const service = makeMissionService(storage, memory);
		await service.createMission('trigger', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		// Migration ran: migrated flag set, only the mission-shaped legacy entry deleted.
		assert.strictEqual(storage.getBoolean('ribix.missions.migrated', undefined, false), true);
		assert.deepStrictEqual(memory.deleted, ['e1'], 'only the mission-shaped legacy entry is deleted');

		const all = service.getAllMissions();
		assert.ok(all.some(m => m.id === 'legacy1'), 'salvaged legacy mission present');
		assert.ok(!all.some(m => (m as any).agentId), 'agent-shaped entry not loaded as a mission');
		service.dispose();
	});

	test('migration is idempotent (second construction is a no-op)', async () => {
		const storage = new FakeStorage();
		const memory = new FakeMemory([{ id: 'e1', content: JSON.stringify(makeMission({ id: 'legacy1' })) }]);
		const s1 = makeMissionService(storage, memory);
		await s1.createMission('t', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });
		s1.dispose();

		const memory2 = new FakeMemory([{ id: 'e1', content: JSON.stringify(makeMission({ id: 'legacy1' })) }]);
		const s2 = makeMissionService(storage, memory2);
		await s2.createMission('t2', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		assert.deepStrictEqual(memory2.deleted, [], 'second run does not re-migrate');
		s2.dispose();
	});
});

suite('RibixMissionService — scoped auto-QA + context', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const sampleChunk = {
		trigger: 'save' as const,
		files: [{ uri: 'file:///repo/src/a.ts', ranges: [[10, 14] as [number, number]] }],
		branch: 'feature/x',
		detectedAt: 123,
	};

	test('createScopedQAMission populates context from the chunk', async () => {
		const storage = new FakeStorage();
		const service = makeMissionService(storage, new FakeMemory());
		const mission = await service.createScopedQAMission(sampleChunk);

		assert.ok(mission, 'mission created');
		assert.strictEqual(mission!.autoTriggered, true);
		assert.deepStrictEqual(mission!.context!.attachedFiles, ['file:///repo/src/a.ts']);
		assert.strictEqual(mission!.context!.attachedSelections.length, 1);
		assert.deepStrictEqual(mission!.context!.attachedSelections[0].range, [10, 14]);
		assert.ok(mission!.context!.notes.includes('save'), 'trigger recorded in notes');
		service.dispose();
	});

	test('createScopedQAMission returns null at concurrency cap, does not throw', async () => {
		const storage = new FakeStorage();
		const service = makeMissionService(storage, new FakeMemory());
		// Fill to the default cap of 3 active missions.
		await service.createMission('a', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });
		await service.createMission('b', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });
		await service.createMission('c', { attachedFiles: [], attachedSelections: [], issueUrls: [], notes: '' });

		const mission = await service.createScopedQAMission(sampleChunk);
		assert.strictEqual(mission, null, 'skipped at cap without throwing');
		service.dispose();
	});

	test('submitForPlanning passes the mission context to the planner (not empty)', async () => {
		const storage = new FakeStorage();
		let capturedContext: any = null;
		const planning = { plan: async (_id: string, _outcome: string, ctx: any) => { capturedContext = ctx; return []; } } as any;
		const service = new RibixMissionService(new FakeMemory() as any, mainProcessStub, authStub, planning, workspaceStub, storage as any, hostStub, metricsStub, fileStub);

		const mission = await service.createScopedQAMission(sampleChunk);
		await service.submitForPlanning(mission!.id);

		assert.ok(capturedContext, 'planner was called');
		assert.deepStrictEqual(capturedContext.attachedFiles, ['file:///repo/src/a.ts'], 'context forwarded, not empty');
		service.dispose();
	});

	test('createMission stores the provided context on the mission', async () => {
		const storage = new FakeStorage();
		const service = makeMissionService(storage, new FakeMemory());
		const mission = await service.createMission('o', {
			attachedFiles: ['file:///repo/x.ts'], attachedSelections: [], issueUrls: [], notes: 'hi',
		});
		assert.deepStrictEqual(mission.context!.attachedFiles, ['file:///repo/x.ts']);
		assert.strictEqual(mission.context!.notes, 'hi');
		service.dispose();
	});
});
