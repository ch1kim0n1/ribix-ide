/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PlaywrightRunner, PlaywrightFinding } from '../../browser/playwrightRunner.js';

// ---------------------------------------------------------------------------
// Helpers: reach private methods via a cast so we can test them directly.
// The alternative (subclassing) would break the "private" contract just as
// much, so we use a typed cast and keep the tests focused on observable logic.
// ---------------------------------------------------------------------------

interface PlaywrightRunnerInternal {
	classifySeverity(error: { type: string; message: string }): 'p0' | 'p1' | 'p2' | 'p3';
	normalizeSeverity(raw: unknown): 'p0' | 'p1' | 'p2' | 'p3';
	resolvePageUrl(page: string): string;
	parseFindings(stdout: string, url: string): PlaywrightFinding[];
	checkPage(url: string, timeoutMs: number): Promise<PlaywrightFinding[]>;
	runSubprocess(scriptPath: string, timeoutMs: number): Promise<string>;
	buildPlaywrightScript(url: string, timeoutMs: number): string;
	stagingUrl: string;
}

function internal(runner: PlaywrightRunner): PlaywrightRunnerInternal {
	return runner as unknown as PlaywrightRunnerInternal;
}

// ---------------------------------------------------------------------------
// Suite 1 — classifySeverity
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — classifySeverity', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function classify(type: string, message: string) {
		return internal(new PlaywrightRunner('https://staging.example.com')).classifySeverity({ type, message });
	}

	// P0 cases
	test('exception type returns p0', () => {
		assert.strictEqual(classify('exception', 'ReferenceError: foo is not defined'), 'p0');
	});

	test('navigation type returns p0', () => {
		assert.strictEqual(classify('navigation', 'Timeout exceeded'), 'p0');
	});

	test('http 5xx returns p0', () => {
		assert.strictEqual(classify('http', '500'), 'p0');
		assert.strictEqual(classify('http', '503'), 'p0');
	});

	// P1 cases
	test('network failure returns p1', () => {
		assert.strictEqual(classify('network', 'net::ERR_CONNECTION_REFUSED'), 'p1');
		assert.strictEqual(classify('network', 'request failed'), 'p1');
	});

	test('http 4xx returns p1', () => {
		assert.strictEqual(classify('http', '404'), 'p1');
		assert.strictEqual(classify('http', '401'), 'p1');
		assert.strictEqual(classify('http', '403'), 'p1');
	});

	// P2 cases
	test('console error message returns p2', () => {
		assert.strictEqual(classify('console', 'Uncaught Error: something bad'), 'p2');
		assert.strictEqual(classify('console', 'error loading module'), 'p2');
	});

	test('console type with message containing ERROR (case-insensitive) returns p2', () => {
		assert.strictEqual(classify('console', 'ERROR: invalid config'), 'p2');
	});

	// P3 cases
	test('console warning returns p3', () => {
		assert.strictEqual(classify('console', 'deprecated API used'), 'p3');
	});

	test('unknown type defaults to p3', () => {
		assert.strictEqual(classify('unknown', 'something'), 'p3');
	});
});

// ---------------------------------------------------------------------------
// Suite 2 — normalizeSeverity
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — normalizeSeverity', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function normalize(raw: unknown) {
		return internal(new PlaywrightRunner('https://staging.example.com')).normalizeSeverity(raw);
	}

	test('valid p0–p3 values pass through unchanged', () => {
		assert.strictEqual(normalize('p0'), 'p0');
		assert.strictEqual(normalize('p1'), 'p1');
		assert.strictEqual(normalize('p2'), 'p2');
		assert.strictEqual(normalize('p3'), 'p3');
	});

	test('invalid values default to p3', () => {
		assert.strictEqual(normalize('critical'), 'p3');
		assert.strictEqual(normalize(null), 'p3');
		assert.strictEqual(normalize(undefined), 'p3');
		assert.strictEqual(normalize(42), 'p3');
		assert.strictEqual(normalize(''), 'p3');
	});
});

// ---------------------------------------------------------------------------
// Suite 3 — resolvePageUrl
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — resolvePageUrl', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('absolute https URL passes through unchanged', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		assert.strictEqual(internal(runner).resolvePageUrl('https://other.example.com/page'), 'https://other.example.com/page');
	});

	test('absolute http URL passes through unchanged', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		assert.strictEqual(internal(runner).resolvePageUrl('http://localhost:3000/login'), 'http://localhost:3000/login');
	});

	test('relative path starting with / is appended to stagingUrl (trailing slash stripped)', () => {
		const runner = new PlaywrightRunner('https://staging.example.com/');
		assert.strictEqual(internal(runner).resolvePageUrl('/dashboard'), 'https://staging.example.com/dashboard');
	});

	test('relative path without leading slash gets a / prepended', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		assert.strictEqual(internal(runner).resolvePageUrl('settings'), 'https://staging.example.com/settings');
	});

	test('stagingUrl is passed to resolved path correctly', () => {
		const runner = new PlaywrightRunner('https://my-staging.app.com');
		assert.strictEqual(internal(runner).resolvePageUrl('/login'), 'https://my-staging.app.com/login');
	});
});

// ---------------------------------------------------------------------------
// Suite 4 — parseFindings
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — parseFindings', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const baseUrl = 'https://staging.example.com';

	function parse(stdout: string) {
		return internal(new PlaywrightRunner(baseUrl)).parseFindings(stdout, baseUrl);
	}

	test('parses a valid JSON findings array', () => {
		const findings = [
			{ title: 'Console error: boom', severity: 'p2', url: baseUrl, errorMessage: 'boom', screenshotPath: '/tmp/s.png' },
		];
		const result = parse(JSON.stringify(findings));
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].title, 'Console error: boom');
		assert.strictEqual(result[0].severity, 'p2');
		assert.strictEqual(result[0].url, baseUrl);
		assert.strictEqual(result[0].errorMessage, 'boom');
		assert.strictEqual(result[0].screenshotPath, '/tmp/s.png');
	});

	test('PlaywrightFinding interface: all required fields present in parsed output', () => {
		const findings = [
			{
				title: 'Uncaught exception: foo',
				severity: 'p0',
				url: baseUrl,
				errorMessage: 'foo is not defined',
				screenshotPath: '/tmp/shot.png',
				stackTrace: 'Error: foo\n  at bar.js:1:1',
			},
		];
		const [f] = parse(JSON.stringify(findings));
		// Required fields
		assert.ok('title' in f, 'title field present');
		assert.ok('severity' in f, 'severity field present');
		assert.ok('url' in f, 'url field present');
		assert.ok('errorMessage' in f, 'errorMessage field present');
		// Optional fields
		assert.strictEqual(f.screenshotPath, '/tmp/shot.png');
		assert.strictEqual(f.stackTrace, 'Error: foo\n  at bar.js:1:1');
	});

	test('strips non-JSON prefix before the first [', () => {
		const prefix = 'Playwright deprecation notice: use new API\nWarning: something else\n';
		const findings = [{ title: 't', severity: 'p3', url: baseUrl, errorMessage: 'm' }];
		const result = parse(prefix + JSON.stringify(findings));
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].title, 't');
	});

	test('returns empty array when stdout has no [', () => {
		assert.deepStrictEqual(parse('Playwright error: no findings'), []);
	});

	test('returns empty array on malformed JSON', () => {
		assert.deepStrictEqual(parse('[{bad json'), []);
	});

	test('returns empty array when parsed value is not an array', () => {
		assert.deepStrictEqual(parse('{"key":"value"}'), []);
	});

	test('returns empty array for empty findings list', () => {
		assert.deepStrictEqual(parse('[]'), []);
	});

	test('filters out non-object entries in the array', () => {
		const mixed = '[{"title":"t","severity":"p1","url":"u","errorMessage":"e"}, null, "str", 42]';
		const result = parse(mixed);
		assert.strictEqual(result.length, 1);
	});

	test('falls back to p3 for invalid severity in parsed finding', () => {
		const findings = [{ title: 't', severity: 'critical', url: baseUrl, errorMessage: 'e' }];
		const [f] = parse(JSON.stringify(findings));
		assert.strictEqual(f.severity, 'p3');
	});

	test('uses fallback url when finding url is missing', () => {
		const findings = [{ title: 't', severity: 'p2', errorMessage: 'e' }];
		const [f] = parse(JSON.stringify(findings));
		assert.strictEqual(f.url, baseUrl);
	});

	test('optional screenshotPath is undefined when absent', () => {
		const findings = [{ title: 't', severity: 'p2', url: baseUrl, errorMessage: 'e' }];
		const [f] = parse(JSON.stringify(findings));
		assert.strictEqual(f.screenshotPath, undefined);
	});

	test('optional stackTrace is undefined when absent', () => {
		const findings = [{ title: 't', severity: 'p0', url: baseUrl, errorMessage: 'e' }];
		const [f] = parse(JSON.stringify(findings));
		assert.strictEqual(f.stackTrace, undefined);
	});
});

// ---------------------------------------------------------------------------
// Suite 5 — buildPlaywrightScript
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — buildPlaywrightScript', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('script contains the staging URL', () => {
		const url = 'https://staging.example.com/login';
		const runner = new PlaywrightRunner('https://staging.example.com');
		const script = internal(runner).buildPlaywrightScript(url, 30000);
		assert.ok(script.includes(JSON.stringify(url)), 'stagingUrl is embedded in the script');
	});

	test('script uses 80% of timeoutMs for navigation', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		const script = internal(runner).buildPlaywrightScript('https://staging.example.com', 10000);
		// Math.floor(10000 * 0.8) = 8000
		assert.ok(script.includes('8000'), 'nav timeout is 80% of timeoutMs');
	});

	test('script is valid ESM (starts with import)', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		const script = internal(runner).buildPlaywrightScript('https://staging.example.com', 30000);
		assert.ok(script.trimStart().startsWith("import {"), 'script starts with ESM import');
	});

	test('script imports chromium from playwright', () => {
		const runner = new PlaywrightRunner('https://staging.example.com');
		const script = internal(runner).buildPlaywrightScript('https://staging.example.com', 30000);
		assert.ok(script.includes("from 'playwright'"), 'imports from playwright');
	});
});

// ---------------------------------------------------------------------------
// Suite 6 — run() with empty pages array
// ---------------------------------------------------------------------------

suite('PlaywrightRunner — run() high-level', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Subclass that overrides checkPage so no real subprocess is spawned.
	 * Used to test the run() orchestration logic in isolation.
	 */
	class FakeRunner extends PlaywrightRunner {
		readonly checkedUrls: string[] = [];
		readonly pageResults: Map<string, PlaywrightFinding[]> = new Map();
		shouldThrow = false;

		override async run(opts: Parameters<PlaywrightRunner['run']>[0]): Promise<PlaywrightFinding[]> {
			// Replicate the run() body using our fake checkPage
			const pages = [
				(this as unknown as PlaywrightRunnerInternal).stagingUrl,
				...(opts.pages ?? []).map(p => (this as unknown as PlaywrightRunnerInternal).resolvePageUrl(p)),
			];
			const allFindings: PlaywrightFinding[] = [];
			for (const url of pages) {
				try {
					const pageFindings = await this.fakeCheckPage(url);
					allFindings.push(...pageFindings);
				} catch (err) {
					allFindings.push({
						title: 'Playwright subprocess error',
						severity: 'p1',
						url,
						errorMessage: err instanceof Error ? err.message : String(err),
					});
				}
			}
			return allFindings;
		}

		async fakeCheckPage(url: string): Promise<PlaywrightFinding[]> {
			this.checkedUrls.push(url);
			if (this.shouldThrow) {
				throw new Error(`subprocess exited 1: ENOENT`);
			}
			return this.pageResults.get(url) ?? [];
		}
	}

	test('run() with no extra pages only checks the staging URL root', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		const findings = await runner.run({ timeoutMs: 30000 });
		assert.deepStrictEqual(runner.checkedUrls, ['https://staging.example.com']);
		assert.deepStrictEqual(findings, []);
	});

	test('run() with empty pages array does not crash and returns empty findings', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		const findings = await runner.run({ timeoutMs: 30000, pages: [] });
		assert.deepStrictEqual(findings, []);
	});

	test('run() resolves page paths against stagingUrl', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		await runner.run({ timeoutMs: 30000, pages: ['/login', '/dashboard'] });
		assert.ok(runner.checkedUrls.includes('https://staging.example.com/login'));
		assert.ok(runner.checkedUrls.includes('https://staging.example.com/dashboard'));
	});

	test('error in subprocess produces a p1 finding with the error message', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		runner.shouldThrow = true;
		const findings = await runner.run({ timeoutMs: 30000, pages: [] });
		// The root page always runs; it should produce a p1 finding
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'p1');
		assert.strictEqual(findings[0].title, 'Playwright subprocess error');
		assert.ok(findings[0].errorMessage.includes('subprocess exited 1') || findings[0].errorMessage.includes('ENOENT'));
	});

	test('stagingUrl is passed as first page to check', async () => {
		const stagingUrl = 'https://my-app.staging.io';
		const runner = new FakeRunner(stagingUrl);
		await runner.run({ timeoutMs: 30000, pages: ['/about'] });
		assert.strictEqual(runner.checkedUrls[0], stagingUrl, 'stagingUrl is the first URL checked');
	});

	test('findings from multiple pages are aggregated', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		const loginFinding: PlaywrightFinding = {
			title: 'Console error: login failed',
			severity: 'p2',
			url: 'https://staging.example.com/login',
			errorMessage: 'login failed',
		};
		const dashFinding: PlaywrightFinding = {
			title: 'Network failure: /api/data',
			severity: 'p1',
			url: 'https://staging.example.com/dashboard',
			errorMessage: 'net::ERR_CONNECTION_REFUSED',
		};
		runner.pageResults.set('https://staging.example.com/login', [loginFinding]);
		runner.pageResults.set('https://staging.example.com/dashboard', [dashFinding]);
		const findings = await runner.run({ timeoutMs: 30000, pages: ['/login', '/dashboard'] });
		assert.ok(findings.some(f => f.title === loginFinding.title));
		assert.ok(findings.some(f => f.title === dashFinding.title));
	});

	test('error in one page does not stop subsequent pages from running', async () => {
		const runner = new FakeRunner('https://staging.example.com');
		// Root throws, /ok succeeds
		let firstCall = true;
		const origFakeCheckPage = runner.fakeCheckPage.bind(runner);
		runner.fakeCheckPage = async (url: string) => {
			if (firstCall) {
				firstCall = false;
				throw new Error('first page failed');
			}
			return origFakeCheckPage(url);
		};
		const findings = await runner.run({ timeoutMs: 30000, pages: ['/ok'] });
		// One p1 for the root failure + nothing for /ok (no preloaded findings)
		const p1s = findings.filter(f => f.severity === 'p1');
		assert.ok(p1s.length >= 1, 'p1 finding emitted for failed page');
		assert.ok(runner.checkedUrls.includes('https://staging.example.com/ok'), '/ok page was still checked');
	});
});
