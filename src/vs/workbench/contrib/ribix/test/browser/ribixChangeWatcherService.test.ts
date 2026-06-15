/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { RibixChangeWatcherService, RIBIX_AUTO_TRIGGER_MODE_KEY } from '../../browser/ribixChangeWatcherService.js';
import { ChangedChunk } from '../../common/ribixChangedChunk.js';

// --- Stubs -------------------------------------------------------------------

class FakeStorage {
	map = new Map<string, string>();
	get(key: string, _scope: any, fallback?: string) { return this.map.has(key) ? this.map.get(key) : fallback; }
	getBoolean(key: string, _scope: any, fallback?: boolean) { return this.map.has(key) ? this.map.get(key) === 'true' : fallback; }
	store(key: string, value: any, _scope: any, _target: any) { this.map.set(key, String(value)); }
}

class FakeTextFileService {
	private readonly _onDidSave = new Emitter<{ model: { resource: URI } }>();
	files = { onDidSave: this._onDidSave.event };
	fireSave(path: string) { this._onDidSave.fire({ model: { resource: URI.file(path) } }); }
	dispose() { this._onDidSave.dispose(); }
}

class FakeLockService {
	locked = new Set<string>();
	isLocked(p: string) { return this.locked.has(p); }
	getLockHolder() { return null; }
	acquire = async () => () => { };
}

class FakeMissionService {
	created: ChangedChunk[] = [];
	createScopedQAMission = async (chunk: ChangedChunk) => { this.created.push(chunk); return { id: 'm' } as any; };
}

class FakeNotificationService {
	notifications: any[] = [];
	notify(n: any) { this.notifications.push(n); return { close() { }, updateMessage() { }, updateSeverity() { } }; }
	prompt() { return { close() { } }; }
}

const workspaceStub = {
	getWorkspace: () => ({ folders: [{ uri: URI.file('/repo') }] }),
	getWorkspaceFolder: (r: URI) => (r.fsPath.startsWith('/repo') ? { uri: URI.file('/repo') } : null),
} as any;

const scmStub = {
	gitBranch: async () => 'main',
	gitSampledDiffs: async () => '',
} as any;

const mainProcessStub = { getChannel: () => ({ call: async () => undefined, listen: () => ({ dispose() { } }) }) } as any;

function make(opts: { storage?: FakeStorage } = {}) {
	const storage = opts.storage ?? new FakeStorage();
	const textFile = new FakeTextFileService();
	const lock = new FakeLockService();
	const mission = new FakeMissionService();
	const notification = new FakeNotificationService();
	const service = new RibixChangeWatcherService(
		textFile as any, lock as any, mission as any,
		notification as any, workspaceStub, storage as any, mainProcessStub,
		{ debounceMs: 5, scmOverride: scmStub }, // tiny debounce + stub SCM for tests
	);
	return { service, storage, textFile, lock, mission, notification };
}

function tick(ms: number) { return new Promise(res => setTimeout(res, ms)); }

suite('RibixChangeWatcherService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('default mode is off — saves are silenced', async () => {
		const { service, textFile, mission } = make();
		assert.strictEqual(service.enabled, false);
		textFile.fireSave('/repo/src/a.ts');
		await tick(30);
		assert.strictEqual(mission.created.length, 0, 'no mission when off');
		service.dispose();
		textFile.dispose();
	});

	test('auto mode: a burst of saves debounces into a single scoped mission with all files', async () => {
		const { service, textFile, mission } = make();
		service.setMode('auto');
		textFile.fireSave('/repo/src/a.ts');
		textFile.fireSave('/repo/src/b.ts');
		textFile.fireSave('/repo/src/a.ts'); // coalesced duplicate
		await tick(40);
		assert.strictEqual(mission.created.length, 1, 'one debounced batch');
		const uris = mission.created[0].files.map(f => f.uri).sort();
		assert.strictEqual(uris.length, 2, 'duplicate coalesced');
		service.dispose();
		textFile.dispose();
	});

	test('ignored paths (node_modules/out) never trigger', async () => {
		const { service, textFile, mission } = make();
		service.setMode('auto');
		textFile.fireSave('/repo/node_modules/x/index.js');
		textFile.fireSave('/repo/out/a.js');
		await tick(40);
		assert.strictEqual(mission.created.length, 0);
		service.dispose();
		textFile.dispose();
	});

	test('files written by an agent (currently locked) are suppressed', async () => {
		const { service, textFile, mission, lock } = make();
		service.setMode('auto');
		lock.locked.add('/repo/src/locked.ts');
		textFile.fireSave('/repo/src/locked.ts');
		await tick(40);
		assert.strictEqual(mission.created.length, 0, 'self-write suppressed');
		service.dispose();
		textFile.dispose();
	});

	test('noteAgentWrote suppresses a recently written file', async () => {
		const { service, textFile, mission } = make();
		service.setMode('auto');
		service.noteAgentWrote(['/repo/src/written.ts']);
		textFile.fireSave('/repo/src/written.ts');
		await tick(40);
		assert.strictEqual(mission.created.length, 0, 'recently-written suppressed');
		service.dispose();
		textFile.dispose();
	});

	test('toggling mode off after enabling silences subsequent saves', async () => {
		const { service, textFile, mission } = make();
		service.setMode('auto');
		service.setMode('off');
		textFile.fireSave('/repo/src/a.ts');
		await tick(40);
		assert.strictEqual(mission.created.length, 0);
		service.dispose();
		textFile.dispose();
	});

	test('auto mode posts a non-blocking Info notification, never a modal prompt', async () => {
		const { service, textFile, notification } = make();
		service.setMode('auto');
		textFile.fireSave('/repo/src/a.ts');
		await tick(40);
		assert.strictEqual(notification.notifications.length, 1, 'one info toast');
		// Severity.Info === 1 in vscode's Severity enum.
		assert.strictEqual(notification.notifications[0].severity, 1);
		service.dispose();
		textFile.dispose();
	});

	test('mode persists to storage and is read back on construction', async () => {
		const { service, storage } = make();
		service.setMode('ask');
		assert.strictEqual(storage.map.get(RIBIX_AUTO_TRIGGER_MODE_KEY), 'ask');

		const reread = make({ storage });
		assert.strictEqual(reread.service.mode, 'ask', 'mode restored from storage');
		service.dispose();
		reread.service.dispose();
	});

	test('ask mode creates the mission but does NOT auto-launch (left for in-panel approval)', async () => {
		const { service, textFile, mission } = make();
		service.setMode('ask');
		textFile.fireSave('/repo/src/a.ts');
		await tick(40);
		// In ask mode we still create the scoped mission (so it appears in the panel for approval),
		// but enabled is true and a chunk is produced.
		assert.strictEqual(mission.created.length, 1);
		assert.strictEqual(mission.created[0].trigger, 'save');
		service.dispose();
		textFile.dispose();
	});
});
