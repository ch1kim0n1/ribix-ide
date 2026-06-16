/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentSandbox, SandboxBlockedError } from '../../browser/agentSandbox.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(over: Partial<ConstructorParameters<typeof AgentSandbox>[0]> = {}): ConstructorParameters<typeof AgentSandbox>[0] {
	return {
		allowedDomains: [],
		blockedDomains: [],
		maxOutboundRequests: 10,
		allowFileWrites: false,
		allowShellCommands: false,
		...over,
	};
}

// ---------------------------------------------------------------------------

suite('AgentSandbox — checkUrl()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('URL matching allowedDomain → allowed: true', () => {
		const sandbox = new AgentSandbox(makePolicy({ allowedDomains: ['staging.example.com'] }));
		const result = sandbox.checkUrl('https://staging.example.com/api/data');
		assert.strictEqual(result.allowed, true);
	});

	test('URL matching blockedDomain → allowed: false', () => {
		const sandbox = new AgentSandbox(makePolicy({
			allowedDomains: ['staging.example.com'],
			blockedDomains: ['production.example.com'],
		}));
		const result = sandbox.checkUrl('https://production.example.com/sensitive');
		assert.strictEqual(result.allowed, false);
		assert.ok(result.reason?.includes('blocked'), 'reason should mention blocked');
	});

	test('URL not in either list when allowedDomains is set → allowed: false (default deny)', () => {
		const sandbox = new AgentSandbox(makePolicy({ allowedDomains: ['staging.example.com'] }));
		const result = sandbox.checkUrl('https://some-other-domain.com/data');
		assert.strictEqual(result.allowed, false);
	});

	test('blockedDomain takes precedence over allowedDomain', () => {
		const sandbox = new AgentSandbox(makePolicy({
			allowedDomains: ['example.com'],
			blockedDomains: ['example.com'],
		}));
		const result = sandbox.checkUrl('https://example.com/api');
		assert.strictEqual(result.allowed, false, 'blocked list wins over allowed list');
	});

	test('subdomain of blockedDomain is also blocked', () => {
		const sandbox = new AgentSandbox(makePolicy({
			blockedDomains: ['stripe.com'],
			allowedDomains: [],
		}));
		const result = sandbox.checkUrl('https://api.stripe.com/v1/charges');
		assert.strictEqual(result.allowed, false);
	});

	test('malformed URL → allowed: false with reason', () => {
		const sandbox = new AgentSandbox(makePolicy());
		const result = sandbox.checkUrl('not-a-valid-url');
		assert.strictEqual(result.allowed, false);
		assert.ok(result.reason, 'should include a reason for malformed URL');
	});

	test('empty allowedDomains list → all non-blocked URLs allowed', () => {
		const sandbox = new AgentSandbox(makePolicy({ allowedDomains: [] }));
		const result = sandbox.checkUrl('https://any-domain.com/path');
		assert.strictEqual(result.allowed, true, 'open policy should allow everything not blocked');
	});
});

// ---------------------------------------------------------------------------

suite('AgentSandbox — guardRequest()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('throws SandboxBlockedError when URL is blocked', () => {
		const sandbox = new AgentSandbox(makePolicy({
			blockedDomains: ['danger.com'],
		}));

		assert.throws(
			() => sandbox.guardRequest('https://danger.com/secret', 'agent-1'),
			(err: unknown) => err instanceof SandboxBlockedError,
			'should throw SandboxBlockedError for blocked domain',
		);
	});

	test('throws SandboxBlockedError when request count exceeds maxOutboundRequests', () => {
		const sandbox = new AgentSandbox(makePolicy({ maxOutboundRequests: 3 }));

		// Exhaust the budget.
		sandbox.guardRequest('https://ok.com/1', 'agent-x');
		sandbox.guardRequest('https://ok.com/2', 'agent-x');
		sandbox.guardRequest('https://ok.com/3', 'agent-x');

		// Fourth call must throw.
		assert.throws(
			() => sandbox.guardRequest('https://ok.com/4', 'agent-x'),
			(err: unknown) => err instanceof SandboxBlockedError,
		);
	});

	test('succeeds within budget', () => {
		const sandbox = new AgentSandbox(makePolicy({ maxOutboundRequests: 5 }));

		assert.doesNotThrow(() => {
			sandbox.guardRequest('https://ok.com/a', 'agent-y');
			sandbox.guardRequest('https://ok.com/b', 'agent-y');
		});

		const stats = sandbox.getStats('agent-y');
		assert.strictEqual(stats.requestCount, 2);
		assert.strictEqual(stats.blockedCount, 0);
	});

	test('blocked request increments blockedCount', () => {
		const sandbox = new AgentSandbox(makePolicy({
			blockedDomains: ['evil.com'],
		}));

		try {
			sandbox.guardRequest('https://evil.com/path', 'agent-z');
		} catch {
			// expected
		}

		const stats = sandbox.getStats('agent-z');
		assert.strictEqual(stats.blockedCount, 1);
		assert.strictEqual(stats.requestCount, 0);
	});

	test('request budget is tracked per agentId independently', () => {
		const sandbox = new AgentSandbox(makePolicy({ maxOutboundRequests: 2 }));

		sandbox.guardRequest('https://ok.com/1', 'agent-a');
		sandbox.guardRequest('https://ok.com/2', 'agent-a');
		// agent-a is at limit

		// agent-b has its own independent budget.
		assert.doesNotThrow(() => sandbox.guardRequest('https://ok.com/1', 'agent-b'));
	});

	test('SandboxBlockedError has correct agentId and url properties', () => {
		const sandbox = new AgentSandbox(makePolicy({
			blockedDomains: ['blocked.com'],
		}));

		let caught: SandboxBlockedError | null = null;
		try {
			sandbox.guardRequest('https://blocked.com/path', 'my-agent');
		} catch (err) {
			caught = err as SandboxBlockedError;
		}

		assert.ok(caught instanceof SandboxBlockedError);
		assert.strictEqual(caught.agentId, 'my-agent');
		assert.strictEqual(caught.url, 'https://blocked.com/path');
		assert.ok(caught.policyReason, 'policyReason should be a non-empty string');
		assert.strictEqual(caught.name, 'SandboxBlockedError');
	});

	test('resetStats() clears the request count for an agent', () => {
		const sandbox = new AgentSandbox(makePolicy({ maxOutboundRequests: 10 }));

		sandbox.guardRequest('https://ok.com/1', 'agent-r');
		sandbox.guardRequest('https://ok.com/2', 'agent-r');
		assert.strictEqual(sandbox.getStats('agent-r').requestCount, 2);

		sandbox.resetStats('agent-r');
		assert.strictEqual(sandbox.getStats('agent-r').requestCount, 0);
	});
});

// ---------------------------------------------------------------------------

suite('AgentSandbox — fromStagingUrl()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test("fromStagingUrl('https://staging.example.com') → allowedDomains = ['staging.example.com']", () => {
		const policy = AgentSandbox.fromStagingUrl('https://staging.example.com');
		assert.deepStrictEqual(policy.allowedDomains, ['staging.example.com']);
	});

	test('fromStagingUrl blocks domains not in the derived allowedDomains', () => {
		const policy = AgentSandbox.fromStagingUrl('https://staging.example.com');
		const sandbox = new AgentSandbox(policy);
		const result = sandbox.checkUrl('https://production.example.com/api');
		assert.strictEqual(result.allowed, false, 'production domain must be blocked when staging policy is active');
	});

	test('fromStagingUrl allows the staging domain itself', () => {
		const policy = AgentSandbox.fromStagingUrl('https://staging.example.com');
		const sandbox = new AgentSandbox(policy);
		const result = sandbox.checkUrl('https://staging.example.com/api');
		assert.strictEqual(result.allowed, true);
	});

	test('fromStagingUrl sets blockedDomains to empty (allowlist-only policy)', () => {
		const policy = AgentSandbox.fromStagingUrl('https://staging.example.com');
		assert.deepStrictEqual(policy.blockedDomains, []);
	});

	test('fromStagingUrl sets maxOutboundRequests to 100', () => {
		const policy = AgentSandbox.fromStagingUrl('https://staging.example.com');
		assert.strictEqual(policy.maxOutboundRequests, 100);
	});

	test('fromStagingUrl with invalid URL throws an Error', () => {
		assert.throws(
			() => AgentSandbox.fromStagingUrl('not-a-url'),
			(err: unknown) => err instanceof Error,
		);
	});

	test('updatePolicy() takes effect on next guardRequest', () => {
		const sandbox = new AgentSandbox(makePolicy({ allowedDomains: ['a.com'] }));
		// Under old policy 'b.com' is not allowed.
		assert.strictEqual(sandbox.checkUrl('https://b.com').allowed, false);

		// Update to open policy (no allowedDomains restriction).
		sandbox.updatePolicy(makePolicy({ allowedDomains: [] }));
		assert.strictEqual(sandbox.checkUrl('https://b.com').allowed, true);
	});
});
