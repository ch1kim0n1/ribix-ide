/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import {
	UnifiedFindingsProvider,
	BackendFinding,
	UnifiedFinding,
} from '../../browser/unifiedFindingsProvider.js';
import { AgentFinding } from '../../common/ribixTypes.js';
import { TaggedFinding } from '../../browser/ribixBackendSseService.js';

// ---------------------------------------------------------------------------
// Stub types
// ---------------------------------------------------------------------------

interface StubMission {
	id: string;
	result: { reviewerFindings: string[] } | null;
}

class FakeAuthService {
	private readonly apiUrl: string;
	private readonly token: string;
	private _reject = false;

	constructor(apiUrl = 'http://api.test', token = 'tok-abc') {
		this.apiUrl = apiUrl;
		this.token = token;
	}

	/** Call rejectNext() to make the next getRequiredConfig() throw (simulates not signed in). */
	rejectNext() { this._reject = true; }

	async getRequiredConfig(): Promise<{ apiUrl: string; accessToken: string }> {
		if (this._reject) {
			this._reject = false;
			throw new Error('Not signed in');
		}
		return { apiUrl: this.apiUrl, accessToken: this.token };
	}

	onDidChangeSession = () => ({ dispose() { } });
	readonly _serviceBrand: undefined = undefined;
}

class FakeMissionService {
	private _missions: StubMission[] = [];
	private readonly _onDidChangeMissions = new Emitter<void>();
	readonly onDidChangeMissions = this._onDidChangeMissions.event;

	setMissions(missions: StubMission[]) {
		this._missions = missions;
		this._onDidChangeMissions.fire();
	}

	getAllMissions() { return this._missions as any[]; }

	// Methods required by RibixMissionService interface but unused in these tests.
	onFindingApproved = () => { };
	onFindingRejected = () => { };
	readonly _serviceBrand: undefined = undefined;
}

class FakeBackendSseService {
	private readonly _onDidReceiveCloudFinding = new Emitter<TaggedFinding>();
	readonly onDidReceiveCloudFinding = this._onDidReceiveCloudFinding.event;

	fireCloudFinding(finding: TaggedFinding) {
		this._onDidReceiveCloudFinding.fire(finding);
	}

	tagIdeFindings(findings: AgentFinding[]): TaggedFinding[] {
		return findings.map(f => ({ ...f, origin: 'ide' as const }));
	}

	ensureSubscribed = async () => { };
	readonly _serviceBrand: undefined = undefined;
}

// ---------------------------------------------------------------------------
// Helper: build a provider with optional fetch override
// ---------------------------------------------------------------------------

type FetchFn = typeof fetch;

function makeProvider(
	auth?: FakeAuthService,
	missionService?: FakeMissionService,
	sseService?: FakeBackendSseService,
	fetchImpl?: FetchFn,
): { provider: UnifiedFindingsProvider; auth: FakeAuthService; missions: FakeMissionService; sse: FakeBackendSseService } {
	const a = auth ?? new FakeAuthService();
	const m = missionService ?? new FakeMissionService();
	const s = sseService ?? new FakeBackendSseService();

	// Patch global fetch for the duration of construction + returned lifetime.
	const originalFetch = globalThis.fetch;
	if (fetchImpl) {
		(globalThis as any).fetch = fetchImpl;
	}

	const provider = new UnifiedFindingsProvider(a as any, m as any, s as any);

	if (fetchImpl) {
		// Restore immediately — the provider has already registered its poll callback.
		// Since polling is async (Promise-chained), we restore after a tick.
		Promise.resolve().then(() => { (globalThis as any).fetch = originalFetch; });
	}

	return { provider, auth: a, missions: m, sse: s };
}

function makeAgentFinding(overrides: Partial<AgentFinding> = {}): AgentFinding {
	return {
		severity: 'medium',
		file: '/repo/src/a.ts',
		line: 10,
		message: 'test finding',
		...overrides,
	};
}

function makeBackendFinding(overrides: Partial<BackendFinding> = {}): BackendFinding {
	return {
		id: `bf-${Math.random().toString(36).slice(2)}`,
		title: 'backend finding',
		description: 'backend finding description',
		severity: 'medium',
		type: 'code-architecture',
		affectedFiles: ['/repo/src/b.ts'],
		createdAt: Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// mergeFindings() — sourceLabel and source
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider.mergeFindings() — source labelling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('mission findings get sourceLabel="Mission" and source="mission"', () => {
		const { provider } = makeProvider();

		const mf: AgentFinding[] = [
			makeAgentFinding({ message: 'null deref', severity: 'high' }),
			makeAgentFinding({ message: 'missing test', severity: 'low' }),
		];
		const result = provider.mergeFindings(mf, 'mission-1', []);

		assert.strictEqual(result.length, 2);
		for (const r of result) {
			assert.strictEqual(r.sourceLabel, 'Mission');
			assert.strictEqual(r.source, 'mission');
			assert.strictEqual(r.missionId, 'mission-1');
		}

		provider.dispose();
	});

	test('backend findings get sourceLabel="Backend" and source="backend"', () => {
		const { provider } = makeProvider();

		const bf: BackendFinding[] = [
			makeBackendFinding({ id: 'b1', title: 'cloud issue' }),
		];
		const result = provider.mergeFindings([], 'mission-1', bf);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].sourceLabel, 'Backend');
		assert.strictEqual(result[0].source, 'backend');
		assert.strictEqual(result[0].cloudId, 'b1');

		provider.dispose();
	});

	test('mission and backend findings coexist in a single merged result', () => {
		const { provider } = makeProvider();

		const mf = [makeAgentFinding({ message: 'mission finding' })];
		const bf = [makeBackendFinding({ id: 'bfX', title: 'backend finding' })];

		const result = provider.mergeFindings(mf, 'm1', bf);

		const missionItems = result.filter(r => r.source === 'mission');
		const backendItems = result.filter(r => r.source === 'backend');
		assert.strictEqual(missionItems.length, 1);
		assert.strictEqual(backendItems.length, 1);

		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// mergeFindings() — deduplication (same id keeps mission version)
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider.mergeFindings() — deduplication', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('mission findings always use unique generated IDs (no collision with backend)', () => {
		// Mission findings always get a fresh UUID, so they never collide with backend IDs.
		const { provider } = makeProvider();

		const mf = [
			makeAgentFinding({ message: 'a' }),
			makeAgentFinding({ message: 'b' }),
		];
		const bf = [makeBackendFinding({ id: 'shared-id' })];
		const result = provider.mergeFindings(mf, 'm1', bf);

		// All three should be present (no unintended dedup)
		assert.strictEqual(result.length, 3);

		provider.dispose();
	});

	test('backend findings with the same id: newer receivedAt wins', () => {
		const { provider } = makeProvider();

		const older = makeBackendFinding({ id: 'dup-id', title: 'old version', createdAt: 100 });
		const newer = makeBackendFinding({ id: 'dup-id', title: 'new version', createdAt: 500 });

		const result = provider.mergeFindings([], 'm1', [older, newer]);

		// Only one entry for dup-id
		const byId = result.filter(r => r.cloudId === 'dup-id');
		assert.strictEqual(byId.length, 1);
		// The newer one wins — message contains the newer title
		assert.ok(byId[0].message.includes('new version'), `expected "new version", got "${byId[0].message}"`);

		provider.dispose();
	});

	test('backend finding does NOT overwrite another backend finding with an older timestamp', () => {
		const { provider } = makeProvider();

		const first = makeBackendFinding({ id: 'dup2', title: 'first', createdAt: 1000 });
		const second = makeBackendFinding({ id: 'dup2', title: 'second (older)', createdAt: 50 });

		const result = provider.mergeFindings([], 'm1', [first, second]);
		const byId = result.filter(r => r.cloudId === 'dup2');
		assert.strictEqual(byId.length, 1);
		// first has higher receivedAt (1000 vs 50) — it should win
		assert.ok(byId[0].message.includes('first'), `expected "first", got "${byId[0].message}"`);

		provider.dispose();
	});

	test('empty mission + empty backend yields empty result', () => {
		const { provider } = makeProvider();
		const result = provider.mergeFindings([], 'm1', []);
		assert.deepStrictEqual(result, []);
		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// mergeFindings() — severity sorting (P0 → P1 → P2 → P3)
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider.mergeFindings() — severity sorting', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('sorts high before medium before low (mission findings)', () => {
		const { provider } = makeProvider();

		const findings: AgentFinding[] = [
			makeAgentFinding({ severity: 'low', message: 'low finding' }),
			makeAgentFinding({ severity: 'high', message: 'high finding' }),
			makeAgentFinding({ severity: 'medium', message: 'medium finding' }),
		];

		const result = provider.mergeFindings(findings, 'm1', []);

		assert.strictEqual(result[0].severity, 'high');
		assert.strictEqual(result[1].severity, 'medium');
		assert.strictEqual(result[2].severity, 'low');

		provider.dispose();
	});

	test('normalizes p0 to high, p2/p3 to low, unknown to medium (backend findings)', () => {
		const { provider } = makeProvider();

		const bf: BackendFinding[] = [
			makeBackendFinding({ id: 'p0-id', severity: 'p0', title: 'p0' }),
			makeBackendFinding({ id: 'p1-id', severity: 'p1', title: 'p1' }),
			makeBackendFinding({ id: 'p2-id', severity: 'p2', title: 'p2' }),
			makeBackendFinding({ id: 'p3-id', severity: 'p3', title: 'p3' }),
		];

		const result = provider.mergeFindings([], 'm1', bf);

		const bySeverity = result.map(r => r.severity);
		// First must be high (p0), last two must be low (p2, p3)
		assert.strictEqual(bySeverity[0], 'high', 'p0 → high');

		const p2 = result.find(r => r.cloudId === 'p2-id')!;
		const p3 = result.find(r => r.cloudId === 'p3-id')!;
		assert.strictEqual(p2.severity, 'low', 'p2 → low');
		assert.strictEqual(p3.severity, 'low', 'p3 → low');

		const p1 = result.find(r => r.cloudId === 'p1-id')!;
		assert.strictEqual(p1.severity, 'medium', 'unknown p1 → medium');

		provider.dispose();
	});

	test('P0 sorts before P1 which sorts before P2 which sorts before P3 (mixed backend)', () => {
		const { provider } = makeProvider();

		const bf: BackendFinding[] = [
			makeBackendFinding({ id: 'p3', severity: 'p3', title: 'p3', createdAt: 1000 }),
			makeBackendFinding({ id: 'p0', severity: 'p0', title: 'p0', createdAt: 1000 }),
			makeBackendFinding({ id: 'p2', severity: 'p2', title: 'p2', createdAt: 1000 }),
			makeBackendFinding({ id: 'p1', severity: 'p1', title: 'p1', createdAt: 1000 }),
		];

		const result = provider.mergeFindings([], 'm1', bf);

		// Order: high (p0) → medium (p1) → low (p2, p3)
		assert.strictEqual(result[0].cloudId, 'p0');
		assert.strictEqual(result[1].cloudId, 'p1');
		// p2 and p3 are both low — their relative order depends on createdAt (equal here) so just check they're last
		const last2 = result.slice(2).map(r => r.cloudId).sort();
		assert.deepStrictEqual(last2, ['p2', 'p3'].sort());

		provider.dispose();
	});

	test('within same severity, more recent receivedAt comes first', () => {
		const { provider } = makeProvider();

		const bf: BackendFinding[] = [
			makeBackendFinding({ id: 'older', severity: 'medium', title: 'older', createdAt: 100 }),
			makeBackendFinding({ id: 'newer', severity: 'medium', title: 'newer', createdAt: 999 }),
		];

		const result = provider.mergeFindings([], 'm1', bf);

		assert.strictEqual(result[0].cloudId, 'newer', 'newer receivedAt first within same severity');
		assert.strictEqual(result[1].cloudId, 'older');

		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// getFindings() / setFilter()
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider — getFindings() / setFilter()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Build a provider with a pre-seeded unifiedCache via mission events.
	 * We use setMissions() so the internal rebuildCache runs and populates the cache.
	 */
	function makeProviderWithMixedFindings(): {
		provider: UnifiedFindingsProvider;
		missions: FakeMissionService;
		sse: FakeBackendSseService;
	} {
		const missions = new FakeMissionService();
		const sse = new FakeBackendSseService();
		const auth = new FakeAuthService();
		auth.rejectNext(); // Prevent initial poll from succeeding (no network)

		// Provide a fetch that immediately returns empty array so pollBackendFindings is a no-op
		const stubFetch = async () => ({ ok: true, status: 200, json: async () => [] } as any) as Response;

		const { provider } = makeProvider(auth, missions, sse, stubFetch);
		return { provider, missions, sse };
	}

	test('setFilter("all"): getFindings() returns all findings', async () => {
		const { provider, missions, sse } = makeProviderWithMixedFindings();

		// Inject a cloud finding via SSE
		sse.fireCloudFinding({
			severity: 'high', file: '/cloud.ts', line: null, message: 'cloud issue',
			origin: 'cloud', cloudId: 'cloud-1', findingType: 'code-architecture',
		});

		// Set a mission with a reviewer finding
		missions.setMissions([{ id: 'm1', result: { reviewerFindings: ['mission finding text'] } }]);

		provider.setFilter('all');
		const findings = provider.getFindings();

		// Should contain at least the cloud finding
		assert.ok(findings.length >= 1, 'should have at least one finding');
		provider.dispose();
	});

	test('setFilter("mission"): getFindings() returns only mission-sourced findings', async () => {
		const { provider, missions, sse } = makeProviderWithMixedFindings();

		sse.fireCloudFinding({
			severity: 'medium', file: '/cloud.ts', line: null, message: 'cloud',
			origin: 'cloud', cloudId: 'cloud-2', findingType: 'code-architecture',
		});
		missions.setMissions([{ id: 'm2', result: { reviewerFindings: ['mission finding'] } }]);

		provider.setFilter('mission');
		const findings = provider.getFindings();

		for (const f of findings) {
			assert.strictEqual(f.source, 'mission', `expected source=mission, got ${f.source}`);
		}

		provider.dispose();
	});

	test('setFilter("backend"): getFindings() returns only backend-sourced findings', async () => {
		const { provider, missions, sse } = makeProviderWithMixedFindings();

		sse.fireCloudFinding({
			severity: 'medium', file: '/cloud.ts', line: null, message: 'cloud',
			origin: 'cloud', cloudId: 'cloud-3', findingType: 'code-architecture',
		});
		missions.setMissions([{ id: 'm3', result: { reviewerFindings: ['mission finding'] } }]);

		provider.setFilter('backend');
		const findings = provider.getFindings();

		for (const f of findings) {
			assert.strictEqual(f.source, 'backend', `expected source=backend, got ${f.source}`);
		}

		provider.dispose();
	});

	test('setFilter fires onDidChangeFindings event', () => {
		const { provider } = makeProviderWithMixedFindings();

		let fired = false;
		const disposable = provider.onDidChangeFindings(() => { fired = true; });

		provider.setFilter('mission');
		assert.strictEqual(fired, true, 'onDidChangeFindings must fire on setFilter');

		disposable.dispose();
		provider.dispose();
	});

	test('getFilter() returns the currently active filter', () => {
		const { provider } = makeProviderWithMixedFindings();

		assert.strictEqual(provider.getFilter(), 'all', 'default filter is all');

		provider.setFilter('mission');
		assert.strictEqual(provider.getFilter(), 'mission');

		provider.setFilter('backend');
		assert.strictEqual(provider.getFilter(), 'backend');

		provider.setFilter('all');
		assert.strictEqual(provider.getFilter(), 'all');

		provider.dispose();
	});

	test('setFilter("all"): getFindings() returns a copy (mutations do not affect internal cache)', () => {
		const { provider } = makeProviderWithMixedFindings();

		provider.setFilter('all');
		const snapshot = provider.getFindings();
		const len = snapshot.length;
		snapshot.push({} as UnifiedFinding);

		assert.strictEqual(provider.getFindings().length, len, 'internal cache must not be mutated by caller');

		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// syncBackendFindings() — fetch wrapper
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider.syncBackendFindings() — fetch behaviour', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let originalFetch: typeof fetch;

	setup(() => { originalFetch = globalThis.fetch; });
	teardown(() => { (globalThis as any).fetch = originalFetch; });

	function installFetch(impl: FetchFn) {
		(globalThis as any).fetch = impl;
	}

	test('calls GET /cli/findings with Authorization: Bearer <token>', async () => {
		const captured: { url: string; init?: RequestInit }[] = [];

		installFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
			captured.push({ url: String(input), init });
			return { ok: true, status: 200, json: async () => [] } as Response;
		});

		const { provider } = makeProvider();
		await provider.syncBackendFindings('http://api.test', 'token-123');

		assert.strictEqual(captured.length, 1);
		assert.ok(captured[0].url.endsWith('/cli/findings'), `expected /cli/findings, got ${captured[0].url}`);
		assert.strictEqual(captured[0].init?.method, 'GET');
		assert.strictEqual((captured[0].init?.headers as Record<string, string>)?.['Authorization'], 'Bearer token-123');

		provider.dispose();
	});

	test('strips trailing slash from apiUrl before appending /cli/findings', async () => {
		const captured: string[] = [];
		installFetch(async (input: RequestInfo | URL) => {
			captured.push(String(input));
			return { ok: true, status: 200, json: async () => [] } as Response;
		});

		const { provider } = makeProvider();
		await provider.syncBackendFindings('http://api.test/', 'tok');

		assert.ok(!captured[0].includes('//cli/findings'), `double slash found in ${captured[0]}`);
		assert.ok(captured[0].endsWith('/cli/findings'));

		provider.dispose();
	});

	test('returns parsed BackendFinding[] on success', async () => {
		const findings: BackendFinding[] = [
			makeBackendFinding({ id: 'f1', title: 'remote finding' }),
			makeBackendFinding({ id: 'f2', title: 'another remote finding' }),
		];

		installFetch(async () => ({
			ok: true, status: 200, json: async () => findings,
		} as Response));

		const { provider } = makeProvider();
		const result = await provider.syncBackendFindings('http://api.test', 'tok');

		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].id, 'f1');
		assert.strictEqual(result[1].id, 'f2');

		provider.dispose();
	});

	test('returns [] on non-200 response without throwing', async () => {
		installFetch(async () => ({ ok: false, status: 403, json: async () => [] } as Response));

		const { provider } = makeProvider();
		const result = await provider.syncBackendFindings('http://api.test', 'tok');

		assert.deepStrictEqual(result, []);

		provider.dispose();
	});

	test('returns [] when response body is not an array', async () => {
		installFetch(async () => ({
			ok: true, status: 200, json: async () => ({ error: 'unexpected' }),
		} as Response));

		const { provider } = makeProvider();
		const result = await provider.syncBackendFindings('http://api.test', 'tok');

		assert.deepStrictEqual(result, []);

		provider.dispose();
	});

	test('returns [] on network error without throwing', async () => {
		installFetch(async () => { throw new Error('network error'); });

		const { provider } = makeProvider();
		const result = await provider.syncBackendFindings('http://api.test', 'tok');

		assert.deepStrictEqual(result, []);

		provider.dispose();
	});

	test('filters out array items that are not objects with a string id', async () => {
		const mixed = [
			makeBackendFinding({ id: 'good' }),
			null,
			{ title: 'no id field' },
			42,
			makeBackendFinding({ id: 'also-good' }),
		];

		installFetch(async () => ({
			ok: true, status: 200, json: async () => mixed,
		} as Response));

		const { provider } = makeProvider();
		const result = await provider.syncBackendFindings('http://api.test', 'tok');

		assert.strictEqual(result.length, 2);
		assert.ok(result.every(r => typeof r.id === 'string'));

		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// startBackendStream() — returns cleanup function
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider.startBackendStream() — SSE setup', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let originalFetch: typeof fetch;
	setup(() => { originalFetch = globalThis.fetch; });
	teardown(() => { (globalThis as any).fetch = originalFetch; });

	function installFetch(impl: FetchFn) {
		(globalThis as any).fetch = impl;
	}

	test('startBackendStream() returns a cleanup function', () => {
		// A fetch that never resolves — simulates a long-lived SSE connection
		installFetch(() => new Promise<Response>(() => { /* never resolves */ }));

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', () => { });

		assert.strictEqual(typeof cleanup, 'function', 'must return a cleanup function');
		cleanup(); // calling cleanup must not throw
		provider.dispose();
	});

	test('startBackendStream() calls /cli/stream with Authorization header', async () => {
		const captured: { url: string; init?: RequestInit }[] = [];

		installFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
			captured.push({ url: String(input), init });
			// Return an empty body so the stream loop exits immediately
			const emptyStream = new ReadableStream<Uint8Array>({
				start(controller) { controller.close(); },
			});
			return new Response(emptyStream, { status: 200 });
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test/', 'my-token', () => { });

		// Allow the async run() inside startBackendStream to proceed
		await new Promise<void>(res => setTimeout(res, 20));

		assert.ok(captured.length >= 1, 'fetch should have been called');
		assert.ok(captured[0].url.endsWith('/cli/stream'), `expected /cli/stream, got ${captured[0].url}`);
		assert.strictEqual(
			(captured[0].init?.headers as Record<string, string>)?.['Authorization'],
			'Bearer my-token',
		);

		cleanup();
		provider.dispose();
	});

	test('startBackendStream() calls onFinding for each valid SSE finding event', async () => {
		const receivedFindings: BackendFinding[] = [];
		const bf = makeBackendFinding({ id: 'stream-finding-1', title: 'streamed issue' });

		// Build an SSE payload with one finding event
		const ssePayload = [
			'event: finding',
			`data: ${JSON.stringify(bf)}`,
			'',
		].join('\n') + '\n';

		installFetch(async () => {
			const encoder = new TextEncoder();
			const bytes = encoder.encode(ssePayload);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				},
			});
			return new Response(stream, { status: 200 });
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', (f) => receivedFindings.push(f));

		// Allow async read loop to complete
		await new Promise<void>(res => setTimeout(res, 50));

		assert.strictEqual(receivedFindings.length, 1, 'should have received one finding via SSE');
		assert.strictEqual(receivedFindings[0].id, 'stream-finding-1');

		cleanup();
		provider.dispose();
	});

	test('startBackendStream() also handles "finding_discovered" event type', async () => {
		const receivedFindings: BackendFinding[] = [];
		const bf = makeBackendFinding({ id: 'stream-finding-2', title: 'discovered issue' });

		const ssePayload = [
			'event: finding_discovered',
			`data: ${JSON.stringify(bf)}`,
			'',
		].join('\n') + '\n';

		installFetch(async () => {
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(ssePayload));
					controller.close();
				},
			});
			return new Response(stream, { status: 200 });
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', (f) => receivedFindings.push(f));

		await new Promise<void>(res => setTimeout(res, 50));

		assert.strictEqual(receivedFindings.length, 1);
		assert.strictEqual(receivedFindings[0].id, 'stream-finding-2');

		cleanup();
		provider.dispose();
	});

	test('startBackendStream() handles { data: BackendFinding } wrapper payload', async () => {
		const receivedFindings: BackendFinding[] = [];
		const bf = makeBackendFinding({ id: 'stream-wrapped', title: 'wrapped' });

		const ssePayload = [
			'event: finding',
			`data: ${JSON.stringify({ data: bf })}`,
			'',
		].join('\n') + '\n';

		installFetch(async () => {
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(ssePayload));
					controller.close();
				},
			});
			return new Response(stream, { status: 200 });
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', (f) => receivedFindings.push(f));

		await new Promise<void>(res => setTimeout(res, 50));

		assert.strictEqual(receivedFindings.length, 1);
		assert.strictEqual(receivedFindings[0].id, 'stream-wrapped');

		cleanup();
		provider.dispose();
	});

	test('startBackendStream() skips malformed SSE data without crashing', async () => {
		const receivedFindings: BackendFinding[] = [];

		const ssePayload = [
			'event: finding',
			'data: this is not valid json {{{',
			'',
		].join('\n') + '\n';

		installFetch(async () => {
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(ssePayload));
					controller.close();
				},
			});
			return new Response(stream, { status: 200 });
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', (f) => receivedFindings.push(f));

		await new Promise<void>(res => setTimeout(res, 50));

		assert.strictEqual(receivedFindings.length, 0, 'malformed SSE data must be skipped');

		cleanup();
		provider.dispose();
	});

	test('calling cleanup() aborts the stream (AbortError does not propagate)', async () => {
		let abortSignal: AbortSignal | undefined;

		installFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
			abortSignal = init?.signal ?? undefined;
			// Stall forever so the abort can be observed
			return new Promise<Response>((_resolve, _reject) => {
				init?.signal?.addEventListener('abort', () => _reject(new DOMException('aborted', 'AbortError')));
			});
		});

		const { provider } = makeProvider();
		const cleanup = provider.startBackendStream('http://api.test', 'tok', () => { });

		// Give fetch a tick to be called
		await new Promise<void>(res => setTimeout(res, 5));

		assert.ok(abortSignal, 'fetch should have received an AbortSignal');
		assert.strictEqual(abortSignal!.aborted, false, 'signal should not yet be aborted');

		cleanup(); // triggers abort

		await new Promise<void>(res => setTimeout(res, 10));

		assert.strictEqual(abortSignal!.aborted, true, 'cleanup() must abort the signal');

		provider.dispose();
	});

	test('startBackendStream() returns [] silently when response is not ok', async () => {
		installFetch(async () => ({ ok: false, status: 401, body: null } as Response));

		const { provider } = makeProvider();
		const receivedFindings: BackendFinding[] = [];
		const cleanup = provider.startBackendStream('http://api.test', 'tok', (f) => receivedFindings.push(f));

		await new Promise<void>(res => setTimeout(res, 30));

		assert.strictEqual(receivedFindings.length, 0, 'non-ok response should yield no findings');

		cleanup();
		provider.dispose();
	});
});

// ---------------------------------------------------------------------------
// SSE cloud finding → internal cache (via FakeBackendSseService)
// ---------------------------------------------------------------------------

suite('UnifiedFindingsProvider — cloud SSE findings in cache', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('onDidReceiveCloudFinding (cloud origin) adds finding to the unified cache', () => {
		const sse = new FakeBackendSseService();
		const missions = new FakeMissionService();
		const auth = new FakeAuthService();
		auth.rejectNext();

		const { provider } = makeProvider(auth, missions, sse);

		let changeCount = 0;
		const d = provider.onDidChangeFindings(() => changeCount++);

		sse.fireCloudFinding({
			severity: 'high', file: '/src/danger.ts', line: 5,
			message: 'critical bug', origin: 'cloud', cloudId: 'cloud-abc',
		});

		// After the cloud finding fires, the cache should have it
		provider.setFilter('backend');
		const findings = provider.getFindings();
		assert.ok(findings.some(f => f.cloudId === 'cloud-abc'), 'cloud finding must appear in backend findings');
		assert.ok(changeCount >= 1, 'onDidChangeFindings must fire at least once');

		d.dispose();
		provider.dispose();
	});

	test('onDidReceiveCloudFinding with origin="ide" is ignored', () => {
		const sse = new FakeBackendSseService();
		const missions = new FakeMissionService();
		const auth = new FakeAuthService();
		auth.rejectNext();

		const { provider } = makeProvider(auth, missions, sse);

		// Fire an IDE-origin tagged finding — should be ignored by the provider
		sse.fireCloudFinding({
			severity: 'high', file: '/src/x.ts', line: null,
			message: 'ide finding', origin: 'ide', cloudId: undefined,
		});

		provider.setFilter('backend');
		const findings = provider.getFindings();
		assert.strictEqual(findings.length, 0, 'ide-origin findings must not be added to the cloud cache');

		provider.dispose();
	});
});
