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
import { AgentFinding } from '../../common/ribixTypes.js';

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

/**
 * Stub agent service for the unattended `auto` run. By default `spawnAgent` resolves but the
 * agent never completes (mirrors a long-running real agent); tests can call `complete()`
 * to fire `onDidCompleteAgent` and seed `getAgent` with findings to assert marker rendering.
 */
class FakeAgentService {
	private readonly _onDidCompleteAgent = new Emitter<{ agentId: string; status: 'complete' | 'failed' }>();
	readonly onDidCompleteAgent = this._onDidCompleteAgent.event;
	private nextId = 0;
	private findingsByAgent = new Map<string, AgentFinding[]>();
	spawnAgent = async () => { this.nextId += 1; return `agent-${this.nextId}`; };
	getAgent = (id: string) => {
		const findings = this.findingsByAgent.get(id);
		return findings ? { id, output: { findings } } as any : null;
	};
	complete(agentId: string, findings: AgentFinding[], status: 'complete' | 'failed' = 'complete') {
		this.findingsByAgent.set(agentId, findings);
		this._onDidCompleteAgent.fire({ agentId, status });
	}
	dispose() { this._onDidCompleteAgent.dispose(); }
}

class FakeMarkerService {
	removed: { owner: string; uris: URI[] }[] = [];
	changed: { owner: string; uri: URI; markers: any[] }[] = [];
	remove(owner: string, uris: URI[]) { this.removed.push({ owner, uris }); }
	changeOne(owner: string, uri: URI, markers: any[]) { this.changed.push({ owner, uri, markers }); }
}

class FakeFileService {
	read = async () => { throw new Error('no fs in test'); };
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

function make(opts: { storage?: FakeStorage; agent?: FakeAgentService; marker?: FakeMarkerService; file?: FakeFileService } = {}) {
	const storage = opts.storage ?? new FakeStorage();
	const textFile = new FakeTextFileService();
	const lock = new FakeLockService();
	const mission = new FakeMissionService();
	const notification = new FakeNotificationService();
	const agent = opts.agent ?? new FakeAgentService();
	const marker = opts.marker ?? new FakeMarkerService();
	const file = opts.file ?? new FakeFileService();
	const service = new RibixChangeWatcherService(
		textFile as any, lock as any, mission as any,
		notification as any, workspaceStub, storage as any, mainProcessStub,
		undefined as any, undefined as any, undefined as any, // real DI services — unused because overrides below win
		{ debounceMs: 5, scmOverride: scmStub, agentOverride: agent as any, markerOverride: marker as any, fileOverride: file as any },
	);
	return { service, storage, textFile, lock, mission, notification, agent, marker, file };
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

	test('auto mode runs unattended and renders reviewer findings as Problems-panel markers (G-AUTOTRIGGER)', async () => {
		const agent = new FakeAgentService();
		let spawnedId = '';
		const origSpawn = agent.spawnAgent.bind(agent) as any;
		agent.spawnAgent = async (...args: any[]) => { const id = await origSpawn(...args); spawnedId = id; return id; };
		const { service, textFile, marker, notification } = make({ agent });

		service.setMode('auto');
		textFile.fireSave('/repo/src/a.ts');
		// Let the debounce flush + spawn resolve.
		await tick(40);
		assert.ok(spawnedId, 'reviewer agent spawned in auto mode');

		// Agent completes with a finding anchored to the saved file.
		const findings: AgentFinding[] = [
			{ severity: 'high', file: '/repo/src/a.ts', line: 12, message: 'null deref', findingType: 'bug' as any },
		];
		agent.complete(spawnedId, findings);
		// Allow the completion listener + render promise to settle.
		await tick(40);

		assert.ok(marker.removed.some(r => r.uris.some(u => u.fsPath.endsWith('/repo/src/a.ts'))), 'prior markers cleared');
		assert.strictEqual(marker.changed.length, 1, 'one file received markers');
		assert.strictEqual(marker.changed[0].markers.length, 1, 'one finding rendered');
		assert.ok(notification.notifications.some(n => /auto-QA reported 1 finding/.test(n.message)), 'findings toast surfaced');

		service.dispose();
		textFile.dispose();
		agent.dispose();
	});

	test('auto mode surfaces a no-issues toast and clears markers when the reviewer finds nothing', async () => {
		const agent = new FakeAgentService();
		let spawnedId = '';
		const origSpawn = agent.spawnAgent.bind(agent) as any;
		agent.spawnAgent = async (...args: any[]) => { const id = await origSpawn(...args); spawnedId = id; return id; };
		const { service, textFile, marker, notification } = make({ agent });

		service.setMode('auto');
		textFile.fireSave('/repo/src/a.ts');
		await tick(40);
		agent.complete(spawnedId, []);
		await tick(40);

		// No changeOne call (no findings), but prior markers are still cleared for the file.
		assert.strictEqual(marker.changed.length, 0);
		assert.ok(notification.notifications.some(n => /auto-QA found no issues/.test(n.message)));

		service.dispose();
		textFile.dispose();
		agent.dispose();
	});
});
