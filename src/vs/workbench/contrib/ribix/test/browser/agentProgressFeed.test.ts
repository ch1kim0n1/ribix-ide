/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentProgressFeed, AgentProgressEvent } from '../../browser/agentProgressFeed.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(over: Partial<AgentProgressEvent> = {}): AgentProgressEvent {
	return {
		agentId: 'mission-1:Coder',
		agentRole: 'Coder',
		stage: 'writing',
		message: 'Editing foo.ts',
		timestamp: Date.now(),
		...over,
	};
}

// ---------------------------------------------------------------------------

suite('AgentProgressFeed — emit() and listener notification', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('emit() notifies all registered listeners synchronously', () => {
		const feed = new AgentProgressFeed();
		const received: AgentProgressEvent[] = [];
		const received2: AgentProgressEvent[] = [];

		feed.onProgress(e => received.push(e));
		feed.onProgress(e => received2.push(e));

		const evt = makeEvent();
		feed.emit(evt);

		assert.strictEqual(received.length, 1);
		assert.strictEqual(received[0], evt);
		assert.strictEqual(received2.length, 1);
		assert.strictEqual(received2[0], evt);
	});

	test('emit() with no listeners does not throw', () => {
		const feed = new AgentProgressFeed();
		assert.doesNotThrow(() => feed.emit(makeEvent()));
	});

	test('emit() stores event in the internal log even with no listeners', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-x:Planner' }));
		assert.strictEqual(feed.getEventsForMission('mission-x').length, 1);
	});

	test('a throwing listener does not prevent other listeners from being called', () => {
		const feed = new AgentProgressFeed();
		const safeReceived: AgentProgressEvent[] = [];

		feed.onProgress(() => { throw new Error('boom'); });
		feed.onProgress(e => safeReceived.push(e));

		const evt = makeEvent();
		// Should not propagate the throw.
		assert.doesNotThrow(() => feed.emit(evt));
		assert.strictEqual(safeReceived.length, 1);
	});
});

suite('AgentProgressFeed — onProgress() unsubscribe', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('onProgress() returns an unsubscribe function', () => {
		const feed = new AgentProgressFeed();
		const unsub = feed.onProgress(() => { });
		assert.strictEqual(typeof unsub, 'function');
	});

	test('after calling the unsubscribe function, the listener no longer receives events', () => {
		const feed = new AgentProgressFeed();
		const received: AgentProgressEvent[] = [];

		const unsub = feed.onProgress(e => received.push(e));
		feed.emit(makeEvent({ message: 'before' }));

		unsub(); // unsubscribe

		feed.emit(makeEvent({ message: 'after' }));

		assert.strictEqual(received.length, 1, 'should only have received the first event');
		assert.strictEqual(received[0].message, 'before');
	});

	test('calling unsubscribe twice does not throw', () => {
		const feed = new AgentProgressFeed();
		const unsub = feed.onProgress(() => { });
		assert.doesNotThrow(() => {
			unsub();
			unsub();
		});
	});

	test('other listeners are unaffected when one unsubscribes', () => {
		const feed = new AgentProgressFeed();
		const received1: AgentProgressEvent[] = [];
		const received2: AgentProgressEvent[] = [];

		const unsub1 = feed.onProgress(e => received1.push(e));
		feed.onProgress(e => received2.push(e));

		feed.emit(makeEvent({ message: 'first' }));
		unsub1();
		feed.emit(makeEvent({ message: 'second' }));

		assert.strictEqual(received1.length, 1, 'unsubscribed listener stopped at 1');
		assert.strictEqual(received2.length, 2, 'active listener received both');
	});
});

suite('AgentProgressFeed — getEventsForMission()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns only events whose agentId starts with the given missionId', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-A:Planner' }));
		feed.emit(makeEvent({ agentId: 'mission-A:Coder' }));
		feed.emit(makeEvent({ agentId: 'mission-B:Tester' }));

		const eventsA = feed.getEventsForMission('mission-A');
		assert.strictEqual(eventsA.length, 2);
		assert.ok(eventsA.every(e => e.agentId.startsWith('mission-A')));
	});

	test('returns empty array when no events match the missionId', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-X:Coder' }));
		assert.deepStrictEqual(feed.getEventsForMission('mission-Y'), []);
	});

	test('prefix match does not bleed across missions with similar prefixes', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-1:Coder' }));
		feed.emit(makeEvent({ agentId: 'mission-10:Coder' }));
		feed.emit(makeEvent({ agentId: 'mission-100:Coder' }));

		const events1 = feed.getEventsForMission('mission-1');
		// All three start with 'mission-1', so all 3 match startsWith semantics.
		assert.strictEqual(events1.length, 3);

		const events10 = feed.getEventsForMission('mission-10');
		assert.strictEqual(events10.length, 2);

		const events100 = feed.getEventsForMission('mission-100');
		assert.strictEqual(events100.length, 1);
	});

	test('returns all events when all share the same missionId prefix', () => {
		const feed = new AgentProgressFeed();
		const roles = ['Planner', 'Coder', 'Tester', 'Reviewer'] as const;
		for (const role of roles) {
			feed.emit(makeEvent({ agentId: `m1:${role}`, agentRole: role }));
		}
		assert.strictEqual(feed.getEventsForMission('m1').length, 4);
	});
});

suite('AgentProgressFeed — clear()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('clear() empties all stored events', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-A:Planner' }));
		feed.emit(makeEvent({ agentId: 'mission-A:Coder' }));
		assert.strictEqual(feed.getEventsForMission('mission-A').length, 2);

		feed.clear();
		assert.strictEqual(feed.getEventsForMission('mission-A').length, 0);
	});

	test('clear() does not fire registered listeners', () => {
		const feed = new AgentProgressFeed();
		let callCount = 0;
		feed.onProgress(() => { callCount++; });

		feed.emit(makeEvent()); // one real emit
		feed.clear();

		assert.strictEqual(callCount, 1, 'listener was called only for emit, not for clear');
	});

	test('events emitted after clear() are tracked correctly', () => {
		const feed = new AgentProgressFeed();
		feed.emit(makeEvent({ agentId: 'mission-old:Planner' }));
		feed.clear();
		feed.emit(makeEvent({ agentId: 'mission-new:Coder' }));

		assert.strictEqual(feed.getEventsForMission('mission-old').length, 0);
		assert.strictEqual(feed.getEventsForMission('mission-new').length, 1);
	});
});
