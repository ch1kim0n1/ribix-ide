/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MarketplaceCompatibilityManager } from '../../browser/marketplaceCompat.js';

// ---------------------------------------------------------------------------
// MarketplaceCompatibilityManager — seed data
// ---------------------------------------------------------------------------

suite('MarketplaceCompatibilityManager — seed data', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('preloads the top 20 extensions on construction', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const all = mgr.getAll();
		assert.ok(all.length >= 20, `expected at least 20 seed extensions, got ${all.length}`);
	});

	test('seed includes ESLint', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const eslint = mgr.getAll().find(e => e.id === 'dbaeumer.vscode-eslint');
		assert.ok(eslint, 'ESLint not in seed data');
		assert.strictEqual(eslint!.compatibilityStatus, 'compatible');
	});

	test('seed includes Prettier', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const prettier = mgr.getAll().find(e => e.id === 'esbenp.prettier-vscode');
		assert.ok(prettier, 'Prettier not in seed data');
		assert.strictEqual(prettier!.compatibilityStatus, 'compatible');
	});

	test('seed includes GitLens', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const gitlens = mgr.getAll().find(e => e.id === 'eamodio.gitlens');
		assert.ok(gitlens, 'GitLens not in seed data');
		assert.strictEqual(gitlens!.compatibilityStatus, 'compatible');
	});

	test('seed marks Remote-SSH as partial', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const remote = mgr.getAll().find(e => e.id === 'ms-vscode-remote.remote-ssh');
		assert.ok(remote, 'Remote-SSH not in seed data');
		assert.strictEqual(remote!.compatibilityStatus, 'partial');
		assert.ok(remote!.compatibilityNotes, 'partial extension should have notes');
	});

	test('seed marks Copilot as partial with conflict warning', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const copilot = mgr.getAll().find(e => e.id === 'GitHub.copilot');
		assert.ok(copilot, 'Copilot not in seed data');
		assert.strictEqual(copilot!.compatibilityStatus, 'partial');
		assert.ok(copilot!.compatibilityNotes!.includes('Ribix'), 'Copilot notes should mention Ribix conflict');
	});

	test('every seed extension has a valid id format (publisher.name)', () => {
		const mgr = new MarketplaceCompatibilityManager();
		for (const ext of mgr.getAll()) {
			assert.ok(ext.id.includes('.'), `invalid extension id: ${ext.id}`);
		}
	});

	test('every seed extension has a compatibility status', () => {
		const mgr = new MarketplaceCompatibilityManager();
		const validStatuses = ['compatible', 'partial', 'incompatible', 'unknown'];
		for (const ext of mgr.getAll()) {
			assert.ok(validStatuses.includes(ext.compatibilityStatus),
				`invalid status for ${ext.id}: ${ext.compatibilityStatus}`);
		}
	});
});

// ---------------------------------------------------------------------------
// checkCompatibility — cached seed extensions (no network)
// ---------------------------------------------------------------------------

suite('MarketplaceCompatibilityManager — checkCompatibility (cached)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns cached seed extension without network call', async () => {
		const mgr = new MarketplaceCompatibilityManager();
		const result = await mgr.checkCompatibility('dbaeumer.vscode-eslint');
		assert.strictEqual(result.id, 'dbaeumer.vscode-eslint');
		assert.strictEqual(result.compatibilityStatus, 'compatible');
	});

	test('returns the same object on repeated calls', async () => {
		const mgr = new MarketplaceCompatibilityManager();
		const first = await mgr.checkCompatibility('esbenp.prettier-vscode');
		const second = await mgr.checkCompatibility('esbenp.prettier-vscode');
		assert.strictEqual(first, second);
	});
});

// ---------------------------------------------------------------------------
// registerCompatibilityOverride
// ---------------------------------------------------------------------------

suite('MarketplaceCompatibilityManager — registerCompatibilityOverride', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('overrides an existing seed extension', () => {
		const mgr = new MarketplaceCompatibilityManager();
		mgr.registerCompatibilityOverride('dbaeumer.vscode-eslint', 'incompatible', 'broke in fork');
		// checkCompatibility returns from cache, which was overridden
		// Note: override updates compatDb but checkCompatibility returns cached first
		const all = mgr.getAll();
		const eslint = all.find(e => e.id === 'dbaeumer.vscode-eslint');
		assert.strictEqual(eslint!.compatibilityStatus, 'incompatible');
		assert.strictEqual(eslint!.compatibilityNotes, 'broke in fork');
	});

	test('registers a new extension not in seed', () => {
		const mgr = new MarketplaceCompatibilityManager();
		mgr.registerCompatibilityOverride('unknown.publisher', 'compatible', 'manually verified');
		const ext = mgr.getAll().find(e => e.id === 'unknown.publisher');
		assert.ok(ext, 'override not registered');
		assert.strictEqual(ext!.compatibilityStatus, 'compatible');
		assert.strictEqual(ext!.compatibilityNotes, 'manually verified');
	});

	test('override preserves existing name and publisher', () => {
		const mgr = new MarketplaceCompatibilityManager();
		// GitLens is in seed with name 'GitLens', publisher 'eamodio'
		mgr.registerCompatibilityOverride('eamodio.gitlens', 'partial', 'updated notes');
		const gitlens = mgr.getAll().find(e => e.id === 'eamodio.gitlens');
		assert.strictEqual(gitlens!.name, 'GitLens');
		assert.strictEqual(gitlens!.publisher, 'eamodio');
		assert.strictEqual(gitlens!.compatibilityStatus, 'partial');
	});

	test('override without notes preserves existing notes', () => {
		const mgr = new MarketplaceCompatibilityManager();
		// Remote-SSH has notes in seed
		mgr.registerCompatibilityOverride('ms-vscode-remote.remote-ssh', 'compatible');
		const remote = mgr.getAll().find(e => e.id === 'ms-vscode-remote.remote-ssh');
		assert.strictEqual(remote!.compatibilityStatus, 'compatible');
		assert.ok(remote!.compatibilityNotes, 'notes should be preserved from seed');
	});
});

// ---------------------------------------------------------------------------
// checkCompatibility — unknown extension (mocked fetch)
// ---------------------------------------------------------------------------

suite('MarketplaceCompatibilityManager — checkCompatibility (unknown, mocked fetch)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		originalFetch = globalThis.fetch;
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
	});

	test('returns unknown record when fetch fails', async () => {
		globalThis.fetch = (() => Promise.reject(new Error('network error'))) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const result = await mgr.checkCompatibility('unknown.publisher');
		assert.strictEqual(result.id, 'unknown.publisher');
		assert.strictEqual(result.compatibilityStatus, 'unknown');
		assert.strictEqual(result.version, 'unknown');
	});

	test('returns unknown record when fetch returns non-ok', async () => {
		globalThis.fetch = (() => Promise.resolve({
			ok: false,
			status: 404,
		} as Response)) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const result = await mgr.checkCompatibility('unknown.publisher');
		assert.strictEqual(result.compatibilityStatus, 'unknown');
	});

	test('returns marketplace data when fetch succeeds', async () => {
		globalThis.fetch = (() => Promise.resolve({
			ok: true,
			json: () => Promise.resolve({
				results: [{
					extensions: [{
						extensionId: 'test.ext',
						extensionName: 'ext',
						publisher: { publisherName: 'test' },
						versions: [{ version: '1.0.0' }],
					}],
				}],
			}),
		} as Response)) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const result = await mgr.checkCompatibility('test.ext');
		assert.strictEqual(result.id, 'test.ext');
		assert.strictEqual(result.name, 'ext');
		assert.strictEqual(result.publisher, 'test');
		assert.strictEqual(result.version, '1.0.0');
		assert.strictEqual(result.compatibilityStatus, 'unknown');
	});

	test('caches fetched result for subsequent calls', async () => {
		let callCount = 0;
		globalThis.fetch = (() => {
			callCount++;
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({
					results: [{
						extensions: [{
							extensionId: 'cached.ext',
							extensionName: 'ext',
							publisher: { publisherName: 'cached' },
							versions: [{ version: '2.0.0' }],
						}],
					}],
				}),
			} as Response);
		}) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		await mgr.checkCompatibility('cached.ext');
		await mgr.checkCompatibility('cached.ext');
		assert.strictEqual(callCount, 1, 'fetch should only be called once for cached extension');
	});

	test('returns null for invalid extension id (no dot)', async () => {
		globalThis.fetch = (() => Promise.resolve({
			ok: true,
			json: () => Promise.resolve({ results: [{ extensions: [] }] }),
		} as Response)) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const result = await mgr.checkCompatibility('no-dot-id');
		assert.strictEqual(result.compatibilityStatus, 'unknown');
	});
});

// ---------------------------------------------------------------------------
// checkHealth (mocked fetch)
// ---------------------------------------------------------------------------

suite('MarketplaceCompatibilityManager — checkHealth', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		originalFetch = globalThis.fetch;
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
	});

	test('returns healthy=true when fetch succeeds', async () => {
		globalThis.fetch = (() => Promise.resolve({
			ok: true,
			status: 200,
		} as Response)) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const health = await mgr.checkHealth();
		assert.strictEqual(health.healthy, true);
	});

	test('returns healthy=false when fetch throws', async () => {
		globalThis.fetch = (() => Promise.reject(new Error('connection refused'))) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const health = await mgr.checkHealth();
		assert.strictEqual(health.healthy, false);
		assert.ok(health.message.includes('connection refused'));
	});

	test('returns healthy=false when response is not ok', async () => {
		globalThis.fetch = (() => Promise.resolve({
			ok: false,
			status: 503,
		} as Response)) as typeof fetch;
		const mgr = new MarketplaceCompatibilityManager();
		const health = await mgr.checkHealth();
		assert.strictEqual(health.healthy, false);
		assert.ok(health.message.includes('503'));
	});
});
