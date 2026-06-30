/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

// The concrete RibixCheckpointService is wired into the editor via DI and registerSingleton,
// so — mirroring ribixFileLockService.test.ts — we replicate its rollback logic inline against
// in-memory fakes to keep the test hermetic and focused on the checkpoint/rollback invariants.

interface FileSnapshot { entireFileCode: string }

interface Checkpoint {
	id: string;
	missionId: string;
	agentId: string;
	filePath: string;
	snapshot: FileSnapshot;
	timestamp: number;
	existedAtCheckpoint: boolean;
}

/** In-memory stand-in for IFileService + the editor model (unsaved edits). */
class FakeWorld {
	/** Files persisted "on disk". Absence = file does not exist. */
	disk = new Map<string, string>();
	/** Live editor model content, which may diverge from disk (unsaved edits). */
	editorModel = new Map<string, string>();

	exists(path: string): boolean { return this.disk.has(path); }
	writeDisk(path: string, content: string) { this.disk.set(path, content); }
	deleteDisk(path: string) { this.disk.delete(path); }
	readDisk(path: string): string | undefined { return this.disk.get(path); }

	// What the model service would report — falls back to disk when no live model.
	modelValue(path: string): string {
		return this.editorModel.has(path) ? this.editorModel.get(path)! : (this.disk.get(path) ?? '');
	}
	setEditorModel(path: string, content: string) { this.editorModel.set(path, content); }

	// editCodeService.instantlyRewriteFile equivalent: rewrites the live model.
	instantlyRewriteFile(path: string, content: string) { this.editorModel.set(path, content); }
}

let uuidCounter = 0;
function uuid() { return `cp-${++uuidCounter}`; }

class CheckpointServiceUnderTest {
	private checkpoints: Checkpoint[] = [];
	private readonly rolledBackIds = new Set<string>();
	private clock = 1000;

	constructor(private readonly world: FakeWorld) { }

	async checkpoint(missionId: string, agentId: string, filePath: string): Promise<Checkpoint> {
		const existedAtCheckpoint = this.world.exists(filePath);
		const cp: Checkpoint = {
			id: uuid(),
			missionId,
			agentId,
			filePath,
			snapshot: { entireFileCode: this.world.modelValue(filePath) },
			timestamp: this.clock++,
			existedAtCheckpoint,
		};
		this.checkpoints.push(cp);
		return cp;
	}

	getCheckpoint(id: string): Checkpoint | null { return this.checkpoints.find(c => c.id === id) ?? null; }

	async rollbackFile(id: string): Promise<void> {
		const cp = this.getCheckpoint(id);
		if (!cp) { throw new Error(`Checkpoint ${id} not found`); }
		await this.restore(cp);
	}

	async rollbackAgent(agentId: string): Promise<void> {
		const ordered = this.checkpoints.filter(c => c.agentId === agentId)
			.sort((a, b) => a.timestamp - b.timestamp).reverse();
		for (const cp of ordered) { await this.restore(cp); }
	}

	async rollbackMission(missionId: string): Promise<void> {
		const ordered = this.checkpoints.filter(c => c.missionId === missionId)
			.sort((a, b) => a.timestamp - b.timestamp).reverse();
		for (const cp of ordered) { await this.restore(cp); }
	}

	/** Records rollback order for assertions on reverse-chronological behaviour. */
	readonly restoreOrder: string[] = [];

	private async restore(cp: Checkpoint): Promise<void> {
		if (this.rolledBackIds.has(cp.id)) { return; }
		this.rolledBackIds.add(cp.id);
		this.restoreOrder.push(cp.id);

		if (!cp.existedAtCheckpoint) {
			if (this.world.exists(cp.filePath)) { this.world.deleteDisk(cp.filePath); }
			this.world.editorModel.delete(cp.filePath);
			return;
		}
		this.world.writeDisk(cp.filePath, cp.snapshot.entireFileCode);
		this.world.instantlyRewriteFile(cp.filePath, cp.snapshot.entireFileCode);
	}
}

suite('RibixCheckpointService — rollback edge cases', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// 1. Rollback of a created file deletes it (no prior snapshot to restore).
	test('rollback of a created file deletes it', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		const file = '/repo/src/new.ts';

		// Checkpoint BEFORE the write — file does not exist yet.
		const cp = await svc.checkpoint('m1', 'a1', file);
		// Agent then creates the file.
		world.writeDisk(file, 'created by agent');

		await svc.rollbackFile(cp.id);
		assert.strictEqual(world.exists(file), false, 'created file is deleted on rollback');
	});

	// 2. Rollback of an agent-deleted file restores its original content.
	test('rollback of an agent-deleted file recreates it with original content', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		const file = '/repo/src/existing.ts';
		world.writeDisk(file, 'original');

		const cp = await svc.checkpoint('m1', 'a1', file);
		// Agent deletes the file.
		world.deleteDisk(file);

		await svc.rollbackFile(cp.id);
		assert.strictEqual(world.exists(file), true, 'deleted file recreated');
		assert.strictEqual(world.readDisk(file), 'original', 'original content restored');
	});

	// 3. rollbackMission restores files in reverse chronological order.
	test('rollbackMission rolls back in reverse chronological order', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		world.writeDisk('/repo/a.ts', 'a0');
		world.writeDisk('/repo/b.ts', 'b0');
		world.writeDisk('/repo/c.ts', 'c0');

		const c1 = await svc.checkpoint('m1', 'a1', '/repo/a.ts');
		const c2 = await svc.checkpoint('m1', 'a2', '/repo/b.ts');
		const c3 = await svc.checkpoint('m1', 'a1', '/repo/c.ts');

		await svc.rollbackMission('m1');
		assert.deepStrictEqual(svc.restoreOrder, [c3.id, c2.id, c1.id], 'most recent rolled back first');
	});

	// 4. Multi-file, multi-agent rollbackMission restores every original.
	test('multi-file multi-agent rollbackMission restores all originals', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		world.writeDisk('/repo/a.ts', 'a-orig');
		world.writeDisk('/repo/b.ts', 'b-orig');

		await svc.checkpoint('m1', 'agentA', '/repo/a.ts');
		await svc.checkpoint('m1', 'agentB', '/repo/b.ts');

		// Both agents mutate their files.
		world.writeDisk('/repo/a.ts', 'a-mutated');
		world.writeDisk('/repo/b.ts', 'b-mutated');

		await svc.rollbackMission('m1');
		assert.strictEqual(world.readDisk('/repo/a.ts'), 'a-orig');
		assert.strictEqual(world.readDisk('/repo/b.ts'), 'b-orig');
	});

	// 5. Rollback reverts unsaved editor edits, not just on-disk content.
	test('rollback reverts unsaved editor edits to the snapshot', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		const file = '/repo/src/edited.ts';
		world.writeDisk(file, 'on-disk-original');
		world.setEditorModel(file, 'on-disk-original');

		const cp = await svc.checkpoint('m1', 'a1', file);
		// Unsaved edits diverge the live model from disk.
		world.setEditorModel(file, 'unsaved local edits');

		await svc.rollbackFile(cp.id);
		assert.strictEqual(world.modelValue(file), 'on-disk-original', 'editor model reverted');
		assert.strictEqual(world.readDisk(file), 'on-disk-original', 'disk reverted');
	});

	// 6. Double rollback is a no-op (idempotent).
	test('double rollback of the same checkpoint is a no-op', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		const file = '/repo/src/new.ts';

		const cp = await svc.checkpoint('m1', 'a1', file); // file did not exist
		world.writeDisk(file, 'created');

		await svc.rollbackFile(cp.id);
		assert.strictEqual(world.exists(file), false, 'deleted on first rollback');

		// Re-create the file out-of-band to prove the second rollback does NOT re-delete it.
		world.writeDisk(file, 'recreated independently');
		await svc.rollbackFile(cp.id); // second rollback — must be a no-op
		assert.strictEqual(world.exists(file), true, 'second rollback did not touch the file');
		assert.strictEqual(world.readDisk(file), 'recreated independently');
	});

	// 7. Per-mission scoping: one mission's rollback never touches another's files.
	test('rollbackMission is scoped — it never touches another mission files', async () => {
		const world = new FakeWorld();
		const svc = new CheckpointServiceUnderTest(world);
		world.writeDisk('/repo/m1.ts', 'm1-orig');
		world.writeDisk('/repo/m2.ts', 'm2-orig');

		await svc.checkpoint('m1', 'a1', '/repo/m1.ts');
		await svc.checkpoint('m2', 'a2', '/repo/m2.ts');

		// Both files mutated.
		world.writeDisk('/repo/m1.ts', 'm1-mutated');
		world.writeDisk('/repo/m2.ts', 'm2-mutated');

		await svc.rollbackMission('m1');
		assert.strictEqual(world.readDisk('/repo/m1.ts'), 'm1-orig', 'mission 1 file restored');
		assert.strictEqual(world.readDisk('/repo/m2.ts'), 'm2-mutated', 'mission 2 file untouched');
	});
});
