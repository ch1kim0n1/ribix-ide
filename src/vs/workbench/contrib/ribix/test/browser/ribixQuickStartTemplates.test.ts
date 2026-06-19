/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	QUICK_START_TEMPLATES,
	getTemplateById,
	getTemplatesByCategory,
	getTemplateCategories,
	scaffoldTemplate,
	joinPath,
	dirname,
	type QuickStartTemplate,
	type ScaffoldOptions,
} from '../../browser/ribixQuickStartTemplates.js';

// ---------------------------------------------------------------------------
// QUICK_START_TEMPLATES — structure validation
// ---------------------------------------------------------------------------

suite('QuickStartTemplates — built-in templates', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('has at least 4 templates', () => {
		assert.ok(QUICK_START_TEMPLATES.length >= 4, `Expected >= 4 templates, got ${QUICK_START_TEMPLATES.length}`);
	});

	test('every template has a unique id', () => {
		const ids = QUICK_START_TEMPLATES.map(t => t.id);
		const unique = new Set(ids);
		assert.strictEqual(ids.length, unique.size, 'Duplicate template ids found');
	});

	test('every template has required fields', () => {
		for (const t of QUICK_START_TEMPLATES) {
			assert.ok(t.id, `Template missing id`);
			assert.ok(t.displayName, `Template ${t.id} missing displayName`);
			assert.ok(t.description, `Template ${t.id} missing description`);
			assert.ok(t.category, `Template ${t.id} missing category`);
			assert.ok(t.estimatedMinutes > 0, `Template ${t.id} has invalid estimatedMinutes`);
			assert.ok(t.files.length > 0, `Template ${t.id} has no files`);
		}
	});

	test('every file has a path and content', () => {
		for (const t of QUICK_START_TEMPLATES) {
			for (const f of t.files) {
				assert.ok(f.path, `Template ${t.id} has a file with empty path`);
				assert.ok(f.content !== undefined, `Template ${t.id} file ${f.path} has no content`);
			}
		}
	});

	test('every template includes a README', () => {
		for (const t of QUICK_START_TEMPLATES) {
			const hasReadme = t.files.some(f => f.path === 'README.md');
			assert.ok(hasReadme, `Template ${t.id} missing README.md`);
		}
	});

	test('every template includes a .ribix/mission.md', () => {
		for (const t of QUICK_START_TEMPLATES) {
			const hasMission = t.files.some(f => f.path === '.ribix/mission.md');
			assert.ok(hasMission, `Template ${t.id} missing .ribix/mission.md`);
		}
	});

	test('every template has a missionPrompt', () => {
		for (const t of QUICK_START_TEMPLATES) {
			assert.ok(t.missionPrompt, `Template ${t.id} missing missionPrompt`);
		}
	});

	test('README and mission files are skipIfExists', () => {
		for (const t of QUICK_START_TEMPLATES) {
			const readme = t.files.find(f => f.path === 'README.md');
			assert.ok(readme?.skipIfExists, `Template ${t.id} README.md should have skipIfExists: true`);
			const mission = t.files.find(f => f.path === '.ribix/mission.md');
			assert.ok(mission?.skipIfExists, `Template ${t.id} .ribix/mission.md should have skipIfExists: true`);
		}
	});

	test('react-ts template has expected files', () => {
		const t = getTemplateById('react-ts');
		assert.ok(t, 'react-ts template not found');
		const paths = t!.files.map(f => f.path);
		assert.ok(paths.includes('package.json'));
		assert.ok(paths.includes('tsconfig.json'));
		assert.ok(paths.includes('src/App.tsx'));
		assert.ok(paths.includes('index.html'));
	});

	test('express-api template has expected files', () => {
		const t = getTemplateById('express-api');
		assert.ok(t, 'express-api template not found');
		const paths = t!.files.map(f => f.path);
		assert.ok(paths.includes('package.json'));
		assert.ok(paths.includes('src/index.ts'));
	});

	test('demo-bug-hunt template has intentional bugs in server code', () => {
		const t = getTemplateById('demo-bug-hunt');
		assert.ok(t, 'demo-bug-hunt template not found');
		const server = t!.files.find(f => f.path === 'src/server.js');
		assert.ok(server, 'demo-bug-hunt missing src/server.js');
		// Check for the intentional bugs
		assert.ok(server!.content.includes('BUG'), 'Bug hunt server should contain BUG comments');
	});
});

// ---------------------------------------------------------------------------
// getTemplateById
// ---------------------------------------------------------------------------

suite('getTemplateById', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns the template for a valid id', () => {
		const t = getTemplateById('react-ts');
		assert.ok(t);
		assert.strictEqual(t!.id, 'react-ts');
	});

	test('returns undefined for an invalid id', () => {
		const t = getTemplateById('nonexistent');
		assert.strictEqual(t, undefined);
	});

	test('returns undefined for empty string', () => {
		const t = getTemplateById('');
		assert.strictEqual(t, undefined);
	});
});

// ---------------------------------------------------------------------------
// getTemplatesByCategory
// ---------------------------------------------------------------------------

suite('getTemplatesByCategory', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns only templates in the given category', () => {
		const webTemplates = getTemplatesByCategory('web');
		assert.ok(webTemplates.length >= 1);
		for (const t of webTemplates) {
			assert.strictEqual(t.category, 'web');
		}
	});

	test('returns empty array for a category with no templates', () => {
		// 'mobile' is not a category in the built-in templates
		const result = getTemplatesByCategory('mobile' as any);
		assert.strictEqual(result.length, 0);
	});
});

// ---------------------------------------------------------------------------
// getTemplateCategories
// ---------------------------------------------------------------------------

suite('getTemplateCategories', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns unique categories', () => {
		const cats = getTemplateCategories();
		const unique = new Set(cats);
		assert.strictEqual(cats.length, unique.size, 'Duplicate categories found');
	});

	test('includes web and demo categories', () => {
		const cats = getTemplateCategories();
		assert.ok(cats.includes('web'), 'Should include web category');
		assert.ok(cats.includes('demo'), 'Should include demo category');
	});
});

// ---------------------------------------------------------------------------
// joinPath
// ---------------------------------------------------------------------------

suite('joinPath', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('joins base and relative path with separator', () => {
		assert.strictEqual(joinPath('/workspace', 'src/index.ts'), '/workspace/src/index.ts');
	});

	test('handles base ending with separator', () => {
		assert.strictEqual(joinPath('/workspace/', 'src/index.ts'), '/workspace/src/index.ts');
	});

	test('handles empty base', () => {
		assert.strictEqual(joinPath('', 'src/index.ts'), 'src/index.ts');
	});

	test('normalizes backslashes to separator', () => {
		assert.strictEqual(joinPath('C:\\workspace', 'src\\index.ts', '/'), 'C:/workspace/src/index.ts');
	});

	test('uses custom separator', () => {
		assert.strictEqual(joinPath('C:\\workspace', 'src/index.ts', '\\'), 'C:\\workspace\\src\\index.ts');
	});
});

// ---------------------------------------------------------------------------
// dirname
// ---------------------------------------------------------------------------

suite('dirname', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns directory for a file path', () => {
		assert.strictEqual(dirname('/workspace/src/index.ts'), '/workspace/src');
	});

	test('returns empty string for a filename only', () => {
		assert.strictEqual(dirname('index.ts'), '');
	});

	test('handles custom separator', () => {
		assert.strictEqual(dirname('C:\\workspace\\src\\index.ts', '\\'), 'C:\\workspace\\src');
	});

	test('handles root-level file', () => {
		assert.strictEqual(dirname('/index.ts'), '');
	});
});

// ---------------------------------------------------------------------------
// scaffoldTemplate
// ---------------------------------------------------------------------------

suite('scaffoldTemplate', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// In-memory mock filesystem
	function createMockFs(): {
		exists: Set<string>;
		written: Map<string, string>;
		createdDirs: Set<string>;
		fileExists: (p: string) => boolean;
		writeFile: (p: string, c: string) => void;
		createDir: (p: string) => void;
	} {
		const exists = new Set<string>();
		const written = new Map<string, string>();
		const createdDirs = new Set<string>();
		return {
			exists,
			written,
			createdDirs,
			fileExists: (p: string) => exists.has(p),
			writeFile: (p: string, c: string) => {
				written.set(p, c);
				exists.add(p);
			},
			createDir: (p: string) => { createdDirs.add(p); },
		};
	}

	function makeOptions(mock: ReturnType<typeof createMockFs>): ScaffoldOptions {
		return {
			workspaceRoot: '/workspace',
			fileExists: mock.fileExists,
			writeFile: mock.writeFile,
			createDir: mock.createDir,
		};
	}

	test('creates all files for a template', () => {
		const mock = createMockFs();
		const template = getTemplateById('node-cli')!;
		const result = scaffoldTemplate(template, makeOptions(mock));

		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.skippedFiles.length, 0);
		// All non-skipIfExists files should be created
		assert.ok(result.createdFiles.includes('package.json'));
		assert.ok(result.createdFiles.includes('src/index.ts'));
		assert.ok(result.createdFiles.includes('tsconfig.json'));
	});

	test('skips files with skipIfExists when they already exist', () => {
		const mock = createMockFs();
		// Pre-create the README
		mock.exists.add('/workspace/README.md');

		const template = getTemplateById('node-cli')!;
		const result = scaffoldTemplate(template, makeOptions(mock));

		assert.ok(result.skippedFiles.includes('README.md'));
		// README should NOT be in createdFiles
		assert.ok(!result.createdFiles.includes('README.md'));
		// Other files should still be created
		assert.ok(result.createdFiles.includes('package.json'));
	});

	test('creates files that do not have skipIfExists even if they exist', () => {
		const mock = createMockFs();
		// Pre-create package.json (no skipIfExists)
		mock.exists.add('/workspace/package.json');

		const template = getTemplateById('node-cli')!;
		const result = scaffoldTemplate(template, makeOptions(mock));

		// package.json should be overwritten (no skipIfExists)
		assert.ok(result.createdFiles.includes('package.json'));
		assert.ok(!result.skippedFiles.includes('package.json'));
	});

	test('creates parent directories', () => {
		const mock = createMockFs();
		const template = getTemplateById('node-cli')!;
		scaffoldTemplate(template, makeOptions(mock));

		// src/ directory should have been created
		assert.ok(mock.createdDirs.has('/workspace/src'), 'Should create /workspace/src directory');
	});

	test('creates .ribix directory for mission file', () => {
		const mock = createMockFs();
		const template = getTemplateById('react-ts')!;
		scaffoldTemplate(template, makeOptions(mock));

		assert.ok(mock.createdDirs.has('/workspace/.ribix'), 'Should create /workspace/.ribix directory');
	});

	test('writes correct content to files', () => {
		const mock = createMockFs();
		const template = getTemplateById('node-cli')!;
		scaffoldTemplate(template, makeOptions(mock));

		const pkgJson = mock.written.get('/workspace/package.json');
		assert.ok(pkgJson);
		assert.ok(pkgJson!.includes('my-ribix-cli'));
	});

	test('returns errors when writeFile throws', () => {
		const mock = createMockFs();
		const options: ScaffoldOptions = {
			workspaceRoot: '/workspace',
			fileExists: () => false,
			writeFile: () => { throw new Error('Disk full'); },
			createDir: () => {},
		};
		const template = getTemplateById('node-cli')!;
		const result = scaffoldTemplate(template, options);

		assert.ok(result.errors.length > 0);
		assert.ok(result.errors[0].includes('Disk full'));
		assert.strictEqual(result.createdFiles.length, 0);
	});

	test('handles Windows-style paths', () => {
		const mock = createMockFs();
		const options: ScaffoldOptions = {
			workspaceRoot: 'C:\\workspace',
			fileExists: mock.fileExists,
			writeFile: mock.writeFile,
			createDir: mock.createDir,
			pathSeparator: '\\',
		};
		const template = getTemplateById('node-cli')!;
		const result = scaffoldTemplate(template, options);

		assert.strictEqual(result.errors.length, 0);
		assert.ok(mock.written.has('C:\\workspace\\package.json'));
		assert.ok(mock.written.has('C:\\workspace\\src\\index.ts'));
	});

	test('returns templateId in result', () => {
		const mock = createMockFs();
		const template = getTemplateById('react-ts')!;
		const result = scaffoldTemplate(template, makeOptions(mock));
		assert.strictEqual(result.templateId, 'react-ts');
	});
});
