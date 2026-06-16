/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MissionCollaboration, MissionCollaborator } from '../../browser/missionCollaboration.js';

// ---------------------------------------------------------------------------

suite('MissionCollaboration — addCollaborator()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('addCollaborator() adds a collaborator with the given email', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list.length, 1);
		assert.strictEqual(list[0].email, 'alice@example.com');
	});

	test('addCollaborator() sets role to "collaborator" and canApprove to false', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'bob@example.com');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list[0].role, 'collaborator');
		assert.strictEqual(list[0].canApprove, false);
	});

	test('addCollaborator() is idempotent — adding the same email twice yields one entry', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m1', 'alice@example.com');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list.length, 1);
	});

	test('addCollaborator() scopes entries per missionId', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m2', 'bob@example.com');

		const m1List = await collab.getCollaborators('m1');
		const m2List = await collab.getCollaborators('m2');

		assert.strictEqual(m1List.length, 1);
		assert.strictEqual(m2List.length, 1);
		assert.strictEqual(m1List[0].email, 'alice@example.com');
		assert.strictEqual(m2List[0].email, 'bob@example.com');
	});

	test('multiple distinct collaborators can be added to the same mission', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m1', 'bob@example.com');
		await collab.addCollaborator('m1', 'carol@example.com');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list.length, 3);
		const emails = list.map(c => c.email);
		assert.ok(emails.includes('alice@example.com'));
		assert.ok(emails.includes('bob@example.com'));
		assert.ok(emails.includes('carol@example.com'));
	});
});

suite('MissionCollaboration — removeCollaborator()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('removeCollaborator() removes the collaborator with the matching userId', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');

		const list = await collab.getCollaborators('m1');
		const aliceId = list[0].userId;

		await collab.removeCollaborator('m1', aliceId);

		const after = await collab.getCollaborators('m1');
		assert.strictEqual(after.length, 0);
	});

	test('removeCollaborator() does not affect other collaborators', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m1', 'bob@example.com');

		const list = await collab.getCollaborators('m1');
		const aliceId = list.find(c => c.email === 'alice@example.com')!.userId;

		await collab.removeCollaborator('m1', aliceId);

		const after = await collab.getCollaborators('m1');
		assert.strictEqual(after.length, 1);
		assert.strictEqual(after[0].email, 'bob@example.com');
	});

	test('removeCollaborator() with an unknown userId is a no-op', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');

		// Should not throw and should leave alice untouched.
		await collab.removeCollaborator('m1', 'nonexistent-id');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list.length, 1);
	});

	test('removeCollaborator() on a missionId with no collaborators is a no-op', async () => {
		const collab = new MissionCollaboration();
		await assert.doesNotReject(() => collab.removeCollaborator('nonexistent', 'uid-1'));
	});
});

suite('MissionCollaboration — getCollaborators()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getCollaborators() returns an empty array for an unknown missionId', async () => {
		const collab = new MissionCollaboration();
		const list = await collab.getCollaborators('never-created');
		assert.deepStrictEqual(list, []);
	});

	test('getCollaborators() returns all collaborators added to a mission', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m1', 'bob@example.com');

		const list = await collab.getCollaborators('m1');
		assert.strictEqual(list.length, 2);
	});

	test('getCollaborators() reflects removals', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await collab.addCollaborator('m1', 'bob@example.com');

		const list = await collab.getCollaborators('m1');
		await collab.removeCollaborator('m1', list[0].userId);

		const after = await collab.getCollaborators('m1');
		assert.strictEqual(after.length, 1);
	});
});

suite('MissionCollaboration — canCurrentUserApprove()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/** Helper that inserts a collaborator directly with controlled fields. */
	async function insertCollaborator(
		collab: MissionCollaboration,
		missionId: string,
		collaborator: MissionCollaborator,
	): Promise<void> {
		// Add via the public API (email-based), then mutate the stored object.
		// Since the implementation returns the same object references from the Map,
		// we manipulate via getCollaborators() after adding.
		await collab.addCollaborator(missionId, collaborator.email);
		const list = await collab.getCollaborators(missionId);
		const stored = list.find(c => c.email === collaborator.email)!;
		stored.userId = collaborator.userId;
		stored.role = collaborator.role;
		stored.canApprove = collaborator.canApprove;
	}

	test('canCurrentUserApprove() returns false when currentUserId is not set', async () => {
		const collab = new MissionCollaboration();
		// Do not call setCurrentUserId
		await collab.addCollaborator('m1', 'alice@example.com');
		assert.strictEqual(await collab.canCurrentUserApprove('m1'), false);
	});

	test('canCurrentUserApprove() returns false when current user is not a collaborator on the mission', async () => {
		const collab = new MissionCollaboration();
		collab.setCurrentUserId('user-99');
		await collab.addCollaborator('m1', 'alice@example.com');
		assert.strictEqual(await collab.canCurrentUserApprove('m1'), false);
	});

	test('canCurrentUserApprove() returns true for owner role', async () => {
		const collab = new MissionCollaboration();
		collab.setCurrentUserId('owner-1');

		await insertCollaborator(collab, 'm1', {
			userId: 'owner-1',
			email: 'owner@example.com',
			role: 'owner',
			canApprove: false, // role alone should grant approval
		});

		assert.strictEqual(await collab.canCurrentUserApprove('m1'), true);
	});

	test('canCurrentUserApprove() returns true for collaborator with canApprove=true', async () => {
		const collab = new MissionCollaboration();
		collab.setCurrentUserId('collab-1');

		await insertCollaborator(collab, 'm1', {
			userId: 'collab-1',
			email: 'collab@example.com',
			role: 'collaborator',
			canApprove: true,
		});

		assert.strictEqual(await collab.canCurrentUserApprove('m1'), true);
	});

	test('canCurrentUserApprove() returns false for collaborator with canApprove=false', async () => {
		const collab = new MissionCollaboration();
		collab.setCurrentUserId('collab-2');

		await insertCollaborator(collab, 'm1', {
			userId: 'collab-2',
			email: 'collab2@example.com',
			role: 'collaborator',
			canApprove: false,
		});

		assert.strictEqual(await collab.canCurrentUserApprove('m1'), false);
	});

	test('canCurrentUserApprove() returns false on an empty collaborator list', async () => {
		const collab = new MissionCollaboration();
		collab.setCurrentUserId('user-1');
		assert.strictEqual(await collab.canCurrentUserApprove('m-empty'), false);
	});
});

suite('MissionCollaboration — notifyCompletion()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('notifyCompletion() does not throw when there are no collaborators', async () => {
		const collab = new MissionCollaboration();
		await assert.doesNotReject(() =>
			collab.notifyCompletion('m1', {
				summary: 'done',
				filesChanged: [],
				testReport: null,
				reviewerFindings: [],
				prUrl: null,
			}),
		);
	});

	test('notifyCompletion() does not throw with collaborators present', async () => {
		const collab = new MissionCollaboration();
		await collab.addCollaborator('m1', 'alice@example.com');
		await assert.doesNotReject(() =>
			collab.notifyCompletion('m1', {
				summary: 'Mission complete with 3 findings',
				filesChanged: ['src/a.ts'],
				testReport: 'all passed',
				reviewerFindings: ['no issues'],
				prUrl: 'https://github.com/owner/repo/pull/42',
			}),
		);
	});
});
