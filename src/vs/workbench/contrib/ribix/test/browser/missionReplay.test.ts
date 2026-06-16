/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { MissionRecorder, MissionReplayer, ReplayEvent } from '../../browser/missionReplay.js';

// ---------------------------------------------------------------------------
// Helpers to intercept the fs/promises dynamic imports used by the module
// ---------------------------------------------------------------------------

/**
 * Tests exercise save/load via a tmpdir created per-test, using the real `fs`
 * but a temporary directory so no permanent side effects occur.  This validates
 * actual JSONL serialization end-to-end without deep mocking.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

function makeTmpDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ribix-test-'));
	return dir;
}

function rimraf(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}

function makeStorageUri(dir: string): URI {
	return URI.file(dir);
}

function makeEvent(overrides: Partial<ReplayEvent> = {}): Omit<ReplayEvent, 'id' | 'missionId' | 'timestamp'> {
	return {
		agentId: 'agent-1',
		agentRole: 'coder',
		type: 'file_read',
		data: { file: '/repo/src/a.ts' },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// MissionRecorder tests
// ---------------------------------------------------------------------------

suite('MissionRecorder — in-memory accumulation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('record() accumulates events in insertion order', () => {
		const recorder = new MissionRecorder('m1');
		recorder.record({ agentId: 'a1', agentRole: 'coder', type: 'file_read', data: {} });
		recorder.record({ agentId: 'a1', agentRole: 'coder', type: 'file_write', data: {} });
		recorder.record({ agentId: 'a2', agentRole: 'reviewer', type: 'tool_call', data: {} });

		const events = recorder.getEvents();
		assert.strictEqual(events.length, 3);
		assert.strictEqual(events[0].type, 'file_read');
		assert.strictEqual(events[1].type, 'file_write');
		assert.strictEqual(events[2].type, 'tool_call');
	});

	test('record() assigns a unique string id to every event', () => {
		const recorder = new MissionRecorder('m1');
		recorder.record(makeEvent());
		recorder.record(makeEvent());
		recorder.record(makeEvent());

		const events = recorder.getEvents();
		const ids = events.map(e => e.id);
		const unique = new Set(ids);
		assert.strictEqual(unique.size, 3, 'all ids must be distinct');
		for (const id of ids) {
			assert.strictEqual(typeof id, 'string');
			assert.ok(id.length > 0);
		}
	});

	test('record() stamps each event with the current missionId', () => {
		const recorder = new MissionRecorder('mission-xyz');
		recorder.record(makeEvent());
		recorder.record(makeEvent());

		for (const e of recorder.getEvents()) {
			assert.strictEqual(e.missionId, 'mission-xyz');
		}
	});

	test('record() assigns a numeric timestamp close to Date.now()', () => {
		const before = Date.now();
		const recorder = new MissionRecorder('m1');
		recorder.record(makeEvent());
		const after = Date.now();

		const [event] = recorder.getEvents();
		assert.ok(typeof event.timestamp === 'number');
		assert.ok(event.timestamp >= before, 'timestamp must not precede record() call');
		assert.ok(event.timestamp <= after, 'timestamp must not exceed record() call');
	});

	test('getEvents() returns a defensive copy — mutations do not affect internal state', () => {
		const recorder = new MissionRecorder('m1');
		recorder.record(makeEvent());

		const snapshot1 = recorder.getEvents();
		snapshot1.push({ id: 'fake', missionId: 'm1', timestamp: 0, agentId: '', agentRole: '', type: 'llm_call', data: {} });

		const snapshot2 = recorder.getEvents();
		assert.strictEqual(snapshot2.length, 1, 'internal array must not be mutated by caller');
	});

	test('record() zero events — getEvents() returns empty array', () => {
		const recorder = new MissionRecorder('empty');
		assert.deepStrictEqual(recorder.getEvents(), []);
	});

	test('record() preserves optional durationMs field', () => {
		const recorder = new MissionRecorder('m1');
		recorder.record({ agentId: 'a', agentRole: 'coder', type: 'llm_call', data: {}, durationMs: 420 });

		const [e] = recorder.getEvents();
		assert.strictEqual(e.durationMs, 420);
	});

	test('record() preserves arbitrary data payload', () => {
		const recorder = new MissionRecorder('m1');
		const payload = { file: '/repo/x.ts', line: 42, extra: [1, 2, 3] };
		recorder.record({ agentId: 'a', agentRole: 'coder', type: 'file_read', data: payload });

		const [e] = recorder.getEvents();
		assert.deepStrictEqual(e.data, payload);
	});
});

// ---------------------------------------------------------------------------
// MissionRecorder.save() + MissionReplayer.load() integration
// ---------------------------------------------------------------------------

suite('MissionRecorder.save() — JSONL persistence', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let tmpDir: string;

	setup(() => {
		tmpDir = makeTmpDir();
	});

	teardown(() => {
		rimraf(tmpDir);
	});

	test('save() writes one JSON object per line (valid JSONL)', async () => {
		const recorder = new MissionRecorder('m-save-1');
		recorder.record({ agentId: 'a1', agentRole: 'coder', type: 'mission_start', data: {} });
		recorder.record({ agentId: 'a1', agentRole: 'coder', type: 'mission_complete', data: { ok: true } });

		await recorder.save(makeStorageUri(tmpDir));

		const filePath = path.join(tmpDir, 'm-save-1.replay.jsonl');
		assert.ok(fs.existsSync(filePath), 'replay file must be created');

		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n').filter(l => l.trim());
		assert.strictEqual(lines.length, 2, 'two events → two lines');
		for (const line of lines) {
			const parsed = JSON.parse(line); // must not throw
			assert.strictEqual(typeof parsed.id, 'string');
			assert.strictEqual(parsed.missionId, 'm-save-1');
		}
	});

	test('save() with zero events creates an empty or blank file without throwing', async () => {
		const recorder = new MissionRecorder('m-empty');
		await recorder.save(makeStorageUri(tmpDir)); // must not throw

		const filePath = path.join(tmpDir, 'm-empty.replay.jsonl');
		assert.ok(fs.existsSync(filePath));
		const content = fs.readFileSync(filePath, 'utf-8');
		assert.strictEqual(content.trim(), '', 'empty recording → blank file');
	});

	test('save() encodes event data as UTF-8 bytes', async () => {
		const recorder = new MissionRecorder('m-utf8');
		recorder.record({ agentId: 'a', agentRole: 'coder', type: 'file_write', data: { msg: 'héllo wörld 🚀' } });

		await recorder.save(makeStorageUri(tmpDir));

		const filePath = path.join(tmpDir, 'm-utf8.replay.jsonl');
		const raw = fs.readFileSync(filePath); // Buffer (bytes)
		const text = new TextDecoder().decode(raw);
		const parsed = JSON.parse(text.trim());
		assert.strictEqual((parsed.data as any).msg, 'héllo wörld 🚀');
	});

	test('save() creates the storage directory if it does not exist', async () => {
		const nested = path.join(tmpDir, 'deep', 'nested');
		const recorder = new MissionRecorder('m-nested');
		recorder.record(makeEvent());
		await recorder.save(makeStorageUri(nested));

		assert.ok(fs.existsSync(path.join(nested, 'm-nested.replay.jsonl')));
	});
});

// ---------------------------------------------------------------------------
// MissionReplayer.load() tests
// ---------------------------------------------------------------------------

suite('MissionReplayer.load() — JSONL parsing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let tmpDir: string;

	setup(() => {
		tmpDir = makeTmpDir();
	});

	teardown(() => {
		rimraf(tmpDir);
	});

	function writeJsonl(missionId: string, lines: string[]): void {
		const filePath = path.join(tmpDir, `${missionId}.replay.jsonl`);
		fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
	}

	function makeRawEvent(missionId: string, timestamp: number, overrides: Partial<ReplayEvent> = {}): ReplayEvent {
		return {
			id: `id-${timestamp}`,
			missionId,
			agentId: 'agent-1',
			agentRole: 'coder',
			type: 'tool_call',
			timestamp,
			data: {},
			...overrides,
		};
	}

	test('load() returns events sorted by timestamp (ascending)', async () => {
		const replayer = new MissionReplayer();
		const e1 = makeRawEvent('m1', 3000);
		const e2 = makeRawEvent('m1', 1000);
		const e3 = makeRawEvent('m1', 2000);
		writeJsonl('m1', [JSON.stringify(e1), JSON.stringify(e2), JSON.stringify(e3)]);

		const events = await replayer.load(makeStorageUri(tmpDir), 'm1');
		assert.strictEqual(events.length, 3);
		assert.strictEqual(events[0].timestamp, 1000);
		assert.strictEqual(events[1].timestamp, 2000);
		assert.strictEqual(events[2].timestamp, 3000);
	});

	test('load() skips blank lines', async () => {
		const replayer = new MissionReplayer();
		const e1 = makeRawEvent('m2', 1000);
		const e2 = makeRawEvent('m2', 2000);
		writeJsonl('m2', ['', JSON.stringify(e1), '', JSON.stringify(e2), '   ']);

		const events = await replayer.load(makeStorageUri(tmpDir), 'm2');
		assert.strictEqual(events.length, 2);
	});

	test('load() skips malformed lines without throwing', async () => {
		const replayer = new MissionReplayer();
		const good = makeRawEvent('m3', 1000);
		writeJsonl('m3', [
			JSON.stringify(good),
			'this is not json {{{',
			'null',            // valid JSON but not an object — still inserted (cast)
			JSON.stringify(makeRawEvent('m3', 2000)),
		]);

		let events: ReplayEvent[];
		assert.doesNotThrow(async () => {
			events = await replayer.load(makeStorageUri(tmpDir), 'm3');
		});
		// Should include at least the two well-formed events
		events = await replayer.load(makeStorageUri(tmpDir), 'm3');
		// malformed line '{{{' is skipped; the two valid events are present
		assert.ok(events.some(e => e.timestamp === 1000), 'first good event present');
		assert.ok(events.some(e => e.timestamp === 2000), 'second good event present');
	});

	test('load() round-trips the data produced by MissionRecorder.save()', async () => {
		const recorder = new MissionRecorder('round-trip');
		recorder.record({ agentId: 'a1', agentRole: 'coder', type: 'file_read', data: { path: '/x.ts' } });
		recorder.record({ agentId: 'a1', agentRole: 'reviewer', type: 'finding_created', data: { severity: 'high' } });
		await recorder.save(makeStorageUri(tmpDir));

		const replayer = new MissionReplayer();
		const events = await replayer.load(makeStorageUri(tmpDir), 'round-trip');

		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].type, 'file_read');
		assert.strictEqual(events[1].type, 'finding_created');
		for (const e of events) {
			assert.strictEqual(e.missionId, 'round-trip');
			assert.strictEqual(typeof e.id, 'string');
			assert.ok(e.id.length > 0);
		}
	});

	test('load() returns events already in timestamp order even when written out-of-order', async () => {
		// Simulate a file written by save() where two events happened in quick
		// succession but appear in reverse order on disk.
		const replayer = new MissionReplayer();
		const late = makeRawEvent('sort-test', 999);
		const early = makeRawEvent('sort-test', 1);
		writeJsonl('sort-test', [JSON.stringify(late), JSON.stringify(early)]);

		const events = await replayer.load(makeStorageUri(tmpDir), 'sort-test');
		assert.strictEqual(events[0].timestamp, 1);
		assert.strictEqual(events[1].timestamp, 999);
	});
});

// ---------------------------------------------------------------------------
// MissionReplayer.listRecordings() tests
// ---------------------------------------------------------------------------

suite('MissionReplayer.listRecordings() — directory scan', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let tmpDir: string;

	setup(() => {
		tmpDir = makeTmpDir();
	});

	teardown(() => {
		rimraf(tmpDir);
	});

	function makeRawEvent(missionId: string, timestamp: number): ReplayEvent {
		return { id: `id-${timestamp}`, missionId, agentId: 'a', agentRole: 'coder', type: 'tool_call', timestamp, data: {} };
	}

	function writeJsonl(missionId: string, events: ReplayEvent[]): void {
		const filePath = path.join(tmpDir, `${missionId}.replay.jsonl`);
		fs.writeFileSync(filePath, events.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
	}

	test('listRecordings() returns correct missionId, eventCount, and duration', async () => {
		const replayer = new MissionReplayer();
		writeJsonl('alpha', [
			makeRawEvent('alpha', 100),
			makeRawEvent('alpha', 300),
			makeRawEvent('alpha', 500),
		]);

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		assert.strictEqual(results.length, 1);
		const r = results[0];
		assert.strictEqual(r.missionId, 'alpha');
		assert.strictEqual(r.eventCount, 3);
		assert.strictEqual(r.duration, 400, 'duration = max timestamp - min timestamp');
	});

	test('listRecordings() skips empty recordings (eventCount=0)', async () => {
		const replayer = new MissionReplayer();
		// Write an empty file — produces zero events after load
		const emptyPath = path.join(tmpDir, 'empty-mission.replay.jsonl');
		fs.writeFileSync(emptyPath, '', 'utf-8');

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		assert.strictEqual(results.length, 0, 'empty recording must not appear in results');
	});

	test('listRecordings() ignores files that do not end in .replay.jsonl', async () => {
		const replayer = new MissionReplayer();
		fs.writeFileSync(path.join(tmpDir, 'other.json'), '{}');
		fs.writeFileSync(path.join(tmpDir, 'log.txt'), 'hello');
		writeJsonl('real-mission', [makeRawEvent('real-mission', 1000), makeRawEvent('real-mission', 2000)]);

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].missionId, 'real-mission');
	});

	test('listRecordings() returns an empty array when the storage directory does not exist', async () => {
		const replayer = new MissionReplayer();
		const nonExistent = path.join(tmpDir, 'no-such-dir');
		const results = await replayer.listRecordings(URI.file(nonExistent));
		assert.deepStrictEqual(results, []);
	});

	test('listRecordings() handles multiple recordings', async () => {
		const replayer = new MissionReplayer();
		writeJsonl('beta', [makeRawEvent('beta', 10), makeRawEvent('beta', 50)]);
		writeJsonl('gamma', [makeRawEvent('gamma', 0), makeRawEvent('gamma', 200), makeRawEvent('gamma', 400)]);

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		results.sort((a, b) => a.missionId.localeCompare(b.missionId));

		assert.strictEqual(results.length, 2);

		const beta = results.find(r => r.missionId === 'beta')!;
		assert.strictEqual(beta.eventCount, 2);
		assert.strictEqual(beta.duration, 40);

		const gamma = results.find(r => r.missionId === 'gamma')!;
		assert.strictEqual(gamma.eventCount, 3);
		assert.strictEqual(gamma.duration, 400);
	});

	test('listRecordings() duration is 0 for a single-event recording', async () => {
		const replayer = new MissionReplayer();
		// Single event: max - min = 0
		writeJsonl('singleton', [makeRawEvent('singleton', 777)]);

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		// Single event is NOT skipped (length > 0)
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].eventCount, 1);
		assert.strictEqual(results[0].duration, 0);
	});

	test('listRecordings() skips unreadable recording files gracefully', async () => {
		const replayer = new MissionReplayer();
		writeJsonl('good-one', [makeRawEvent('good-one', 1), makeRawEvent('good-one', 2)]);
		// Write a file that load() will fail to parse (all lines malformed, so events=[])
		const badPath = path.join(tmpDir, 'bad-one.replay.jsonl');
		fs.writeFileSync(badPath, 'not json at all\nalso bad', 'utf-8');

		const results = await replayer.listRecordings(makeStorageUri(tmpDir));
		// bad-one has 0 events after parse -> skipped; good-one should be present
		assert.ok(results.some(r => r.missionId === 'good-one'), 'good recording present');
		assert.ok(!results.some(r => r.missionId === 'bad-one'), 'bad recording (all malformed lines) skipped');
	});
});
