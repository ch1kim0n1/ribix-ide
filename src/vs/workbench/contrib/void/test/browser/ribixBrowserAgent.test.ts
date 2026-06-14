/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	RibixBrowserAgent,
	IRibixBrowserChannel,
	findingsFromDiagnostics,
	findingsFromMobileHtml,
	htmlShowsSpinner,
	UserFlow,
} from '../../browser/ribixBrowserAgent.js';

// --- Pure-detector tests -----------------------------------------------------

suite('ribixBrowserAgent — detectors', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('findingsFromDiagnostics: page error -> high-severity runtime finding', () => {
		const f = findingsFromDiagnostics({ pageErrors: ['TypeError: x is undefined'], consoleMessages: [], networkFailures: [] }, 'Login › submit');
		assert.strictEqual(f.length, 1);
		assert.strictEqual(f[0].severity, 'high');
		assert.match(f[0].message, /Runtime error/);
	});

	test('findingsFromDiagnostics: console error becomes a finding, plain logs do not', () => {
		const f = findingsFromDiagnostics({
			pageErrors: [],
			consoleMessages: [{ type: 'error', text: 'boom' }, { type: 'log', text: 'noise' }],
			networkFailures: [],
		}, 'Home');
		assert.strictEqual(f.length, 1);
		assert.match(f[0].message, /Console error/);
	});

	test('findingsFromDiagnostics: failed request flags 5xx as high and 4xx as medium', () => {
		const f = findingsFromDiagnostics({
			pageErrors: [],
			consoleMessages: [],
			networkFailures: [
				{ url: '/api/save', status: 500, failure: null },
				{ url: '/api/missing', status: 404, failure: null },
				{ url: '/api/dns', status: null, failure: 'net::ERR_CONNECTION_REFUSED' },
			],
		}, 'Save');
		assert.strictEqual(f.length, 3);
		const byUrl = (u: string) => f.find(x => x.message.includes(u))!;
		assert.strictEqual(byUrl('/api/save').severity, 'high');
		assert.strictEqual(byUrl('/api/missing').severity, 'medium');
		assert.strictEqual(byUrl('/api/dns').severity, 'high');
	});

	test('findingsFromDiagnostics: 2+ 429s emit a single rate-limit-blind finding', () => {
		const f = findingsFromDiagnostics({
			pageErrors: [],
			consoleMessages: [],
			networkFailures: [
				{ url: '/api/poll', status: 429, failure: null },
				{ url: '/api/poll', status: 429, failure: null },
				{ url: '/api/poll', status: 429, failure: null },
			],
		}, 'Dashboard');
		const rl = f.filter(x => x.findingType === 'rate-limit-blind');
		assert.strictEqual(rl.length, 1, 'one summarized rate-limit finding, not one per 429');
		assert.match(rl[0].message, /429/);
	});

	test('htmlShowsSpinner: detects common loading markers', () => {
		assert.ok(htmlShowsSpinner('<div role="progressbar"></div>'));
		assert.ok(htmlShowsSpinner('<div class="spinner-lg"></div>'));
		assert.ok(!htmlShowsSpinner('<main><h1>Loaded</h1></main>'));
	});

	test('findingsFromMobileHtml: flags a fixed width wider than the viewport', () => {
		const f = findingsFromMobileHtml('<div style="width: 900px"></div>', 375, 'Home @375px (mobile)');
		assert.strictEqual(f.length, 1);
		assert.match(f[0].message, /Mobile layout break/);
		// A within-viewport width is fine.
		assert.strictEqual(findingsFromMobileHtml('<div style="width: 320px"></div>', 375, 'Home').length, 0);
	});
});

// --- End-to-end flow tests (fake channel) ------------------------------------

/** A scripted fake of the electron-main browser channel. */
function makeChannelStub(opts: {
	diagnosticsPerStep?: any[];
	htmlSequence?: string[];
	throwOnClick?: string;
}): { calls: Array<{ command: string; params: any }>; channel: IRibixBrowserChannel } {
	const calls: Array<{ command: string; params: any }> = [];
	let diagIdx = 0;
	let htmlIdx = 0;
	const channel = {
		async call(command: string, params: any): Promise<any> {
			calls.push({ command, params });
			switch (command) {
				case 'navigate': return { screenshotPath: 's', title: 't', url: params.url };
				case 'click':
					if (opts.throwOnClick && params.selector === opts.throwOnClick) {
						throw new Error(`selector not found: ${params.selector}`);
					}
					return { screenshotPath: 's' };
				case 'type': return { screenshotPath: 's' };
				case 'scroll': return { screenshotPath: 's' };
				case 'getHtml': return { html: opts.htmlSequence ? (opts.htmlSequence[htmlIdx++] ?? '') : '<main>ok</main>' };
				case 'diagnostics': return opts.diagnosticsPerStep ? (opts.diagnosticsPerStep[diagIdx++] ?? { consoleMessages: [], pageErrors: [], networkFailures: [] }) : { consoleMessages: [], pageErrors: [], networkFailures: [] };
				case 'close': return {};
				default: return {};
			}
		},
	} as unknown as IRibixBrowserChannel;
	return { calls, channel };
}

suite('ribixBrowserAgent — run', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const oneViewport = [1280];

	test('walks a flow, drains diagnostics per step, and reports a runtime error', async () => {
		const flow: UserFlow = {
			name: 'Login',
			steps: [
				{ kind: 'navigate', path: '/login' },
				{ kind: 'click', selector: '#submit', label: 'submit' },
			],
		};
		const { calls, channel } = makeChannelStub({
			diagnosticsPerStep: [
				{ consoleMessages: [], pageErrors: [], networkFailures: [] },
				{ consoleMessages: [], pageErrors: ['ReferenceError: foo'], networkFailures: [] },
			],
		});
		const agent = new RibixBrowserAgent(channel);
		const result = await agent.run({ baseUrl: 'http://localhost:3000', flows: [flow], viewports: oneViewport });

		assert.strictEqual(result.stepsRun, 2);
		assert.ok(result.findings.some(f => /Runtime error/.test(f.message)), 'page error surfaced');
		assert.ok(calls.some(c => c.command === 'navigate' && c.params.url === 'http://localhost:3000/login'));
		assert.ok(calls.some(c => c.command === 'close'), 'browser is always closed');
	});

	test('a step that throws is reported as a broken flow and stops the walk', async () => {
		const flow: UserFlow = {
			name: 'Checkout',
			steps: [
				{ kind: 'navigate', path: '/cart' },
				{ kind: 'click', selector: '#pay', label: 'pay' },
				{ kind: 'click', selector: '#confirm', label: 'confirm' },
			],
		};
		const { calls, channel } = makeChannelStub({ throwOnClick: '#pay' });
		const agent = new RibixBrowserAgent(channel);
		const result = await agent.run({ baseUrl: 'http://localhost:3000', flows: [flow], viewports: oneViewport });

		assert.ok(result.findings.some(f => /Broken flow/.test(f.message)), 'broken step surfaced');
		// The walk must stop at the broken step — #confirm is never clicked.
		assert.ok(!calls.some(c => c.command === 'click' && c.params.selector === '#confirm'), 'does not click past a broken state');
	});

	test('mobile viewport produces a layout-break finding from a too-wide element', async () => {
		const flow: UserFlow = { name: 'Home', steps: [{ kind: 'navigate', path: '/' }] };
		const { channel } = makeChannelStub({ htmlSequence: ['<main>ok</main>', '<div style="min-width: 1200px"></div>'] });
		const agent = new RibixBrowserAgent(channel);
		const result = await agent.run({ baseUrl: 'http://localhost:3000', flows: [flow], viewports: [375], spinnerStuckMs: 1 });

		assert.ok(result.findings.some(f => /Mobile layout break/.test(f.message)), 'layout break surfaced at 375px');
	});
});
