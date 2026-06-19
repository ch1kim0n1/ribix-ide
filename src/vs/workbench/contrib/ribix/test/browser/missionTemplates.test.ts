/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BUILT_IN_TEMPLATES, MissionTemplateService, type MissionTemplate } from '../../browser/missionTemplates.js';

// ---------------------------------------------------------------------------
// Mock IStorageService — in-memory key/value store
// ---------------------------------------------------------------------------

function createMockStorageService() {
	const store = new Map<string, any>();
	return {
		get: (key: string, _scope: unknown) => store.get(key) ?? undefined,
		store: (key: string, value: any, _scope: unknown, _target: unknown) => { store.set(key, value); },
		remove: (key: string, _scope: unknown) => { store.delete(key); },
	} as any;
}

// ---------------------------------------------------------------------------
// BUILT_IN_TEMPLATES — structural validation
// ---------------------------------------------------------------------------

suite('BUILT_IN_TEMPLATES — structure', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('contains at least 4 templates', () => {
		assert.ok(BUILT_IN_TEMPLATES.length >= 4, `expected ≥4 templates, got ${BUILT_IN_TEMPLATES.length}`);
	});

	test('every template has a unique id', () => {
		const ids = BUILT_IN_TEMPLATES.map(t => t.id);
		const unique = new Set(ids);
		assert.strictEqual(ids.length, unique.size, 'duplicate template ids');
	});

	test('every template has required fields', () => {
		for (const t of BUILT_IN_TEMPLATES) {
			assert.ok(typeof t.id === 'string' && t.id.length > 0, `invalid id: ${t.id}`);
			assert.ok(typeof t.name === 'string' && t.name.length > 0, `invalid name for ${t.id}`);
			assert.ok(typeof t.description === 'string' && t.description.length > 0, `invalid description for ${t.id}`);
			assert.ok(typeof t.outcomeTemplate === 'string' && t.outcomeTemplate.length > 0, `invalid outcomeTemplate for ${t.id}`);
			assert.ok(typeof t.defaultAgentCount === 'number' && t.defaultAgentCount > 0, `invalid agentCount for ${t.id}`);
			assert.ok(Array.isArray(t.tags), `invalid tags for ${t.id}`);
		}
	});

	test('every outcomeTemplate has at least one {placeholder}', () => {
		for (const t of BUILT_IN_TEMPLATES) {
			assert.ok(/\{(\w+)\}/.test(t.outcomeTemplate),
				`template ${t.id} outcomeTemplate has no placeholders: "${t.outcomeTemplate}"`);
		}
	});

	test('includes fix-bug template', () => {
		const fixBug = BUILT_IN_TEMPLATES.find(t => t.id === 'fix-bug');
		assert.ok(fixBug, 'fix-bug template missing');
		assert.strictEqual(fixBug!.defaultAgentCount, 3);
		assert.ok(fixBug!.tags.includes('bug'));
	});

	test('includes add-endpoint template', () => {
		const addEndpoint = BUILT_IN_TEMPLATES.find(t => t.id === 'add-endpoint');
		assert.ok(addEndpoint, 'add-endpoint template missing');
		assert.strictEqual(addEndpoint!.defaultAgentCount, 4);
		assert.ok(addEndpoint!.tags.includes('feature'));
	});

	test('includes write-tests template', () => {
		const writeTests = BUILT_IN_TEMPLATES.find(t => t.id === 'write-tests');
		assert.ok(writeTests, 'write-tests template missing');
		assert.strictEqual(writeTests!.defaultAgentCount, 2);
		assert.ok(writeTests!.tags.includes('testing'));
	});
});

// ---------------------------------------------------------------------------
// MissionTemplateService — getAll / getById
// ---------------------------------------------------------------------------

suite('MissionTemplateService — getAll / getById', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getAll returns a copy of BUILT_IN_TEMPLATES', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const all = svc.getAll();
		assert.strictEqual(all.length, BUILT_IN_TEMPLATES.length);
		// Verify it's a copy, not the same reference
		assert.notStrictEqual(all, BUILT_IN_TEMPLATES);
	});

	test('getById returns the matching template', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const t = svc.getById('fix-bug');
		assert.ok(t);
		assert.strictEqual(t!.id, 'fix-bug');
		assert.strictEqual(t!.name, 'Fix a bug');
	});

	test('getById returns undefined for unknown id', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		assert.strictEqual(svc.getById('nonexistent'), undefined);
	});
});

// ---------------------------------------------------------------------------
// MissionTemplateService — applyTemplate
// ---------------------------------------------------------------------------

suite('MissionTemplateService — applyTemplate', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('replaces single placeholder', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template = BUILT_IN_TEMPLATES.find(t => t.id === 'fix-bug')!;
		const result = svc.applyTemplate(template, { description: 'null pointer in parser' });
		assert.strictEqual(result, 'Fix the bug: null pointer in parser');
	});

	test('replaces multiple placeholders', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template = BUILT_IN_TEMPLATES.find(t => t.id === 'add-endpoint')!;
		const result = svc.applyTemplate(template, {
			method: 'POST',
			path: '/api/users',
			description: 'creates a new user',
		});
		assert.strictEqual(result, 'Add a POST endpoint at /api/users that creates a new user');
	});

	test('leaves unresolved placeholders as-is', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template = BUILT_IN_TEMPLATES.find(t => t.id === 'refactor')!;
		const result = svc.applyTemplate(template, { goal: 'reduce coupling' });
		assert.strictEqual(result, 'Refactor {module} to reduce coupling');
	});

	test('leaves all placeholders as-is when vars is empty', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template = BUILT_IN_TEMPLATES.find(t => t.id === 'write-tests')!;
		const result = svc.applyTemplate(template, {});
		assert.strictEqual(result, 'Write comprehensive tests for {module}');
	});

	test('handles empty vars object', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template: MissionTemplate = {
			id: 'test',
			name: 'Test',
			description: 'desc',
			outcomeTemplate: 'Hello {name}, you are {age}',
			defaultAgentCount: 1,
			tags: [],
		};
		const result = svc.applyTemplate(template, { name: 'Alice' });
		assert.strictEqual(result, 'Hello Alice, you are {age}');
	});

	test('does not replace placeholder when vars has null/undefined value via hasOwnProperty', () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const template: MissionTemplate = {
			id: 'test',
			name: 'Test',
			description: 'desc',
			outcomeTemplate: 'Value: {x}',
			defaultAgentCount: 1,
			tags: [],
		};
		// { x: undefined } — hasOwnProperty returns true, so it replaces with "undefined"
		const result = svc.applyTemplate(template, { x: undefined as unknown as string });
		assert.strictEqual(result, 'Value: undefined');
	});
});

// ---------------------------------------------------------------------------
// MissionTemplateService — custom templates (with mock storage)
// ---------------------------------------------------------------------------

suite('MissionTemplateService — custom templates', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getCustomTemplates returns empty array when storage is empty', async () => {
		const svc = new MissionTemplateService(createMockStorageService());
		const custom = await svc.getCustomTemplates();
		assert.deepStrictEqual(custom, []);
	});

	test('saveCustomTemplate stores and returns template with generated id', async () => {
		const storage = createMockStorageService();
		const svc = new MissionTemplateService(storage);
		const saved = await svc.saveCustomTemplate({
			name: 'My Template',
			description: 'custom desc',
			outcomeTemplate: 'Do {thing}',
			defaultAgentCount: 2,
			tags: ['custom'],
		});
		assert.ok(saved.id.startsWith('custom-'), `id should start with 'custom-', got: ${saved.id}`);
		assert.strictEqual(saved.name, 'My Template');
	});

	test('saved custom template appears in getCustomTemplates', async () => {
		const storage = createMockStorageService();
		const svc = new MissionTemplateService(storage);
		await svc.saveCustomTemplate({
			name: 'Template A',
			description: 'desc A',
			outcomeTemplate: 'A {x}',
			defaultAgentCount: 1,
			tags: [],
		});
		const custom = await svc.getCustomTemplates();
		assert.strictEqual(custom.length, 1);
		assert.strictEqual(custom[0].name, 'Template A');
	});

	test('saving multiple templates preserves all', async () => {
		const storage = createMockStorageService();
		const svc = new MissionTemplateService(storage);
		await svc.saveCustomTemplate({ name: 'A', description: 'd', outcomeTemplate: 'A', defaultAgentCount: 1, tags: [] });
		await svc.saveCustomTemplate({ name: 'B', description: 'd', outcomeTemplate: 'B', defaultAgentCount: 1, tags: [] });
		await svc.saveCustomTemplate({ name: 'C', description: 'd', outcomeTemplate: 'C', defaultAgentCount: 1, tags: [] });
		const custom = await svc.getCustomTemplates();
		assert.strictEqual(custom.length, 3);
	});

	test('getCustomTemplates returns empty array when storage has invalid JSON', async () => {
		const storage = createMockStorageService();
		storage.store('ribix.missionTemplates.custom.v1', '{invalid json', undefined, undefined);
		const svc = new MissionTemplateService(storage);
		const custom = await svc.getCustomTemplates();
		assert.deepStrictEqual(custom, []);
	});

	test('getCustomTemplates returns empty array when storage has non-array JSON', async () => {
		const storage = createMockStorageService();
		storage.store('ribix.missionTemplates.custom.v1', '{"not":"an array"}', undefined, undefined);
		const svc = new MissionTemplateService(storage);
		const custom = await svc.getCustomTemplates();
		assert.deepStrictEqual(custom, []);
	});
});
