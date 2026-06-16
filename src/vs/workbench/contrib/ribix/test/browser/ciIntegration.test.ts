/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import {
	GitHubActionsPoller,
	CIRunFailure,
	RibixCIContribution,
} from '../../browser/ciIntegration.js';
import { Severity } from '../../../../../platform/notification/common/notification.js';

// ---------------------------------------------------------------------------
// Fake fetch helper
// ---------------------------------------------------------------------------

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function makeFakeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	} as unknown as Response;
}

/**
 * Install a per-test fetch mock. Returns a restore function.
 * The handler receives the URL and returns a Response promise.
 */
function installFetchMock(handler: (url: string) => Promise<Response>): () => void {
	const orig = (globalThis as any).fetch as FetchImpl | undefined;
	(globalThis as any).fetch = (url: string, _init?: RequestInit) => handler(url);
	return () => {
		if (orig === undefined) {
			delete (globalThis as any).fetch;
		} else {
			(globalThis as any).fetch = orig;
		}
	};
}

// ---------------------------------------------------------------------------
// Pre-built GitHub API response fixtures
// ---------------------------------------------------------------------------

function makeWorkflowRunResponse(id: number, name = 'CI') {
	return {
		workflow_runs: [{
			id,
			name,
			head_sha: `sha${id}`,
			html_url: `https://github.com/owner/repo/actions/runs/${id}`,
		}],
	};
}

function makeJobsResponse(jobId: number, jobName = 'build', failedStep = 'Run tests') {
	return {
		jobs: [{
			id: jobId,
			name: jobName,
			conclusion: 'failure',
			steps: [
				{ name: 'Set up Node', conclusion: 'success' },
				{ name: failedStep, conclusion: 'failure' },
			],
		}],
	};
}

function makeCommitFilesResponse(files: string[]) {
	return { files: files.map(f => ({ filename: f })) };
}

// ---------------------------------------------------------------------------
// URL routing helper — builds a fetch mock that routes by URL substring
// ---------------------------------------------------------------------------

function makeRouter(routes: Array<{ match: string; response: unknown; ok?: boolean }>): FetchImpl {
	return async (url: string) => {
		const route = routes.find(r => url.includes(r.match));
		if (!route) {
			return makeFakeResponse({ error: `no mock for ${url}` }, false, 404);
		}
		return makeFakeResponse(route.response, route.ok ?? true);
	};
}

// ---------------------------------------------------------------------------
// Suite 1 — GitHubActionsPoller: URL parsing
// ---------------------------------------------------------------------------

suite('GitHubActionsPoller — URL parsing (via ConfigureCIIntegrationAction regex)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * The regex used in ConfigureCIIntegrationAction.run() to parse git remote URLs
	 * into "owner/repo" form is duplicated here so we can test it independently without
	 * needing the full DI stack.
	 */
	function parseRepoName(remote: string): string | null {
		const match =
			remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/) ??
			remote.match(/github\.com\/([^/]+\/[^/]+)/);
		return match?.[1] ?? null;
	}

	test('SSH remote URL git@github.com:owner/repo.git parses to owner/repo', () => {
		assert.strictEqual(parseRepoName('git@github.com:owner/repo.git'), 'owner/repo');
	});

	test('HTTPS remote URL https://github.com/owner/repo.git parses to owner/repo', () => {
		assert.strictEqual(parseRepoName('https://github.com/owner/repo.git'), 'owner/repo');
	});

	test('HTTPS remote URL without .git parses to owner/repo', () => {
		assert.strictEqual(parseRepoName('https://github.com/owner/repo'), 'owner/repo');
	});

	test('SSH remote URL without .git parses to owner/repo', () => {
		assert.strictEqual(parseRepoName('git@github.com:owner/repo'), 'owner/repo');
	});

	test('invalid format returns null', () => {
		assert.strictEqual(parseRepoName('not-a-remote'), null);
		assert.strictEqual(parseRepoName(''), null);
		assert.strictEqual(parseRepoName('gitlab.com/owner/repo.git'), null);
	});

	test('URL with username and port does not parse as a github remote', () => {
		// This is not a GitHub URL — should return null
		assert.strictEqual(parseRepoName('https://notgithub.com/owner/repo.git'), null);
	});
});

// ---------------------------------------------------------------------------
// Suite 2 — GitHubActionsPoller: polling / deduplication
// ---------------------------------------------------------------------------

suite('GitHubActionsPoller — polling and deduplication', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Build a poller wired to a deterministic sequence of fake API responses.
	 * Each call to getLatestRun() (triggered by startPolling) returns the next
	 * fixture in the sequence.
	 */
	function makePoller(runSequence: Array<CIRunFailure | null>): {
		poller: GitHubActionsPoller;
		callCount: () => number;
		restore: () => void;
	} {
		let idx = 0;
		const fetchCalls: string[] = [];

		const restore = installFetchMock(async (url) => {
			fetchCalls.push(url);

			// Detect which run is being requested by examining idx
			const currentRun = runSequence[idx] ?? null;

			// Route responses based on URL shape:
			if (url.includes('/actions/runs') && !url.includes('/jobs')) {
				if (currentRun === null) {
					return makeFakeResponse({ workflow_runs: [] });
				}
				return makeFakeResponse(makeWorkflowRunResponse(Number(currentRun.runId)));
			}

			if (url.includes('/actions/runs') && url.includes('/jobs')) {
				if (currentRun === null) { return makeFakeResponse({ jobs: [] }); }
				const job = currentRun.failedJobs[0];
				return makeFakeResponse(makeJobsResponse(1, job?.name ?? 'build', job?.failedStep ?? 'step'));
			}

			if (url.includes('/actions/jobs') && url.includes('/logs')) {
				if (currentRun === null) { return makeFakeResponse(''); }
				return makeFakeResponse(currentRun.failedJobs[0]?.logs ?? '');
			}

			if (url.includes('/commits/')) {
				if (currentRun === null) { return makeFakeResponse({ files: [] }); }
				return makeFakeResponse(makeCommitFilesResponse(currentRun.failedJobs[0]?.affectedFiles ?? []));
			}

			return makeFakeResponse({}, false, 404);
		});

		const poller = new GitHubActionsPoller('fake-token', 'owner/repo');

		// Override getLatestRun to return scripted fixtures directly,
		// bypassing the real HTTP stack (which we have already mocked but
		// the fixture shape differs from what the real method constructs).
		const scripted = runSequence;
		let callCount = 0;
		(poller as any).getLatestRun = async (_branch: string): Promise<CIRunFailure | null> => {
			const result = scripted[callCount] ?? null;
			callCount++;
			return result;
		};

		return {
			poller,
			callCount: () => callCount,
			restore,
		};
	}

	function makeFailure(runId: string, branch = 'main'): CIRunFailure {
		return {
			runId,
			workflowName: 'CI',
			branch,
			commitSha: `sha-${runId}`,
			failedJobs: [{
				name: 'build',
				failedStep: 'Run tests',
				logs: 'FAIL src/foo.test.ts',
				affectedFiles: ['src/foo.ts'],
			}],
			htmlUrl: `https://github.com/owner/repo/actions/runs/${runId}`,
		};
	}

	test('onFailure fires when a new failed run ID is detected', async () => {
		const fired: CIRunFailure[] = [];
		const { poller, restore } = makePoller([makeFailure('42')]);

		try {
			await poller.startPolling('main', f => fired.push(f));
			poller.stop();
		} finally {
			restore();
		}

		assert.strictEqual(fired.length, 1);
		assert.strictEqual(fired[0].runId, '42');
	});

	test('onFailure does NOT fire again for the same runId (dedup)', async () => {
		const fired: CIRunFailure[] = [];
		// Same failure repeated — second tick should be deduped
		const failure = makeFailure('99');

		// Use a poller with a controlled getLatestRun
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		let callCount = 0;
		(poller as any).getLatestRun = async () => {
			callCount++;
			return failure; // always returns the same runId
		};

		// Start polling — fires the immediate tick
		await poller.startPolling('main', f => fired.push(f));
		poller.stop();

		// Simulate a second tick manually by calling the internal tick logic directly.
		// We do this by calling startPolling again (it stops the previous interval first).
		await poller.startPolling('main', f => fired.push(f));
		poller.stop();

		// onFailure should only have fired once despite being called twice
		assert.strictEqual(fired.length, 1, 'dedup: same runId does not fire twice');
		assert.strictEqual(fired[0].runId, '99');
	});

	test('onFailure fires again when a new (different) runId appears', async () => {
		const fired: CIRunFailure[] = [];
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		const failures = [makeFailure('10'), makeFailure('20')];
		let callCount = 0;
		(poller as any).getLatestRun = async () => failures[callCount++] ?? null;

		await poller.startPolling('main', f => fired.push(f));
		poller.stop();
		// Second poll — different runId
		await poller.startPolling('main', f => fired.push(f));
		poller.stop();

		assert.strictEqual(fired.length, 2);
		assert.strictEqual(fired[0].runId, '10');
		assert.strictEqual(fired[1].runId, '20');
	});

	test('onFailure does not fire when run is null (no failures)', async () => {
		const fired: CIRunFailure[] = [];
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		(poller as any).getLatestRun = async () => null;

		await poller.startPolling('main', f => fired.push(f));
		poller.stop();

		assert.strictEqual(fired.length, 0);
	});

	test('stop() is safe to call when not polling', () => {
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		assert.doesNotThrow(() => poller.stop());
	});
});

// ---------------------------------------------------------------------------
// Suite 3 — GitHubActionsPoller: getJobLogs trimming
// ---------------------------------------------------------------------------

suite('GitHubActionsPoller — getJobLogs trimming', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('job logs longer than 2000 chars are trimmed to the last 2000 chars', async () => {
		const longLog = 'A'.repeat(1000) + 'B'.repeat(1500); // 2500 chars total
		const restore = installFetchMock(async () => makeFakeResponse(longLog));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getJobLogs('job-123');
			assert.strictEqual(result.length, 2000);
			// Should be the LAST 2000 chars — the trailing Bs
			assert.ok(result.startsWith('B'), 'trimmed to last 2000 chars');
		} finally {
			restore();
		}
	});

	test('job logs shorter than 2000 chars are returned as-is', async () => {
		const shortLog = 'FAIL src/foo.test.ts: expected true but got false';
		const restore = installFetchMock(async () => makeFakeResponse(shortLog));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getJobLogs('job-456');
			assert.strictEqual(result, shortLog);
		} finally {
			restore();
		}
	});

	test('job logs exactly 2000 chars are returned unchanged', async () => {
		const exactLog = 'X'.repeat(2000);
		const restore = installFetchMock(async () => makeFakeResponse(exactLog));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getJobLogs('job-789');
			assert.strictEqual(result.length, 2000);
		} finally {
			restore();
		}
	});

	test('getJobLogs returns empty string when response is not ok', async () => {
		const restore = installFetchMock(async () => makeFakeResponse('forbidden', false, 403));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getJobLogs('job-000');
			assert.strictEqual(result, '');
		} finally {
			restore();
		}
	});

	test('getJobLogs returns empty string when fetch throws', async () => {
		const restore = installFetchMock(async () => { throw new Error('network error'); });
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getJobLogs('job-err');
			assert.strictEqual(result, '');
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 4 — GitHubActionsPoller: getLatestRun API shape
// ---------------------------------------------------------------------------

suite('GitHubActionsPoller — getLatestRun', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns null when API call is not ok', async () => {
		const restore = installFetchMock(async () => makeFakeResponse({}, false, 401));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getLatestRun('main');
			assert.strictEqual(result, null);
		} finally {
			restore();
		}
	});

	test('returns null when workflow_runs is empty', async () => {
		const restore = installFetchMock(async () => makeFakeResponse({ workflow_runs: [] }));
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getLatestRun('main');
			assert.strictEqual(result, null);
		} finally {
			restore();
		}
	});

	test('returns null when all jobs pass (no failed jobs)', async () => {
		const router = makeRouter([
			{
				match: '/actions/runs',
				response: makeWorkflowRunResponse(100),
			},
			{
				match: '/actions/runs/100/jobs',
				response: { jobs: [{ id: 1, name: 'build', conclusion: 'success', steps: [] }] },
			},
			{ match: '/commits/', response: { files: [] } },
		]);
		const restore = installFetchMock(router);
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getLatestRun('main');
			assert.strictEqual(result, null);
		} finally {
			restore();
		}
	});

	test('returns a CIRunFailure with correct shape when a failed job exists', async () => {
		let callIndex = 0;
		const restore = installFetchMock(async (url) => {
			callIndex++;
			if (url.includes('/actions/runs') && !url.includes('/jobs')) {
				return makeFakeResponse(makeWorkflowRunResponse(200, 'My Workflow'));
			}
			if (url.includes('/actions/runs/200/jobs')) {
				return makeFakeResponse(makeJobsResponse(55, 'test-job', 'npm test'));
			}
			if (url.includes('/actions/jobs/55/logs')) {
				return makeFakeResponse('Error: expect(received).toBe(expected)');
			}
			if (url.includes('/commits/')) {
				return makeFakeResponse(makeCommitFilesResponse(['src/index.ts', 'src/utils.ts']));
			}
			return makeFakeResponse({}, false, 404);
		});
		const poller = new GitHubActionsPoller('token', 'owner/repo');
		try {
			const result = await poller.getLatestRun('main');
			assert.ok(result !== null, 'should return a failure');
			assert.strictEqual(result!.runId, '200');
			assert.strictEqual(result!.workflowName, 'My Workflow');
			assert.strictEqual(result!.branch, 'main');
			assert.strictEqual(result!.failedJobs.length, 1);
			assert.strictEqual(result!.failedJobs[0].name, 'test-job');
			assert.strictEqual(result!.failedJobs[0].failedStep, 'npm test');
			assert.ok(result!.failedJobs[0].logs.includes('expect'));
			assert.deepStrictEqual(result!.failedJobs[0].affectedFiles, ['src/index.ts', 'src/utils.ts']);
		} finally {
			restore();
		}
	});

	test('request includes Authorization header with Bearer token', async () => {
		let capturedHeaders: Record<string, string> = {};
		const origFetch = (globalThis as any).fetch;
		(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
			capturedHeaders = { ...(init?.headers as Record<string, string> ?? {}) };
			return makeFakeResponse({ workflow_runs: [] });
		};
		const poller = new GitHubActionsPoller('ghp_test_token', 'owner/repo');
		try {
			await poller.getLatestRun('main');
			assert.strictEqual(capturedHeaders['Authorization'], 'Bearer ghp_test_token');
			assert.strictEqual(capturedHeaders['Accept'], 'application/vnd.github+json');
		} finally {
			(globalThis as any).fetch = origFetch;
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 5 — RibixCIContribution: notification on failure
// ---------------------------------------------------------------------------

suite('RibixCIContribution — notification on failure', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// --- Stubs ---

	class FakeNotificationService {
		readonly prompts: Array<{
			severity: Severity;
			message: string;
			actions: Array<{ label: string; run: () => void }>;
		}> = [];

		prompt(
			severity: Severity,
			message: string,
			actions: Array<{ label: string; run: () => void }>,
		) {
			this.prompts.push({ severity, message, actions });
		}

		notify(_opts: any) { /* not used in these tests */ }
	}

	class FakeMissionService {
		readonly created: Array<{ outcome: string; context: any }> = [];
		async createMission(outcome: string, context: any) {
			this.created.push({ outcome, context });
			return { id: 'mission-1' } as any;
		}
	}

	/** Exposes onDidDetectFailure as an emitter we can fire in tests. */
	class FakeCIService {
		readonly _serviceBrand: undefined = undefined;
		private readonly _emitter = new Emitter<CIRunFailure>();
		readonly onDidDetectFailure = this._emitter.event;

		fire(failure: CIRunFailure) { this._emitter.fire(failure); }

		async isConfigured() { return false; } // contribution skips polling in tests
		async startPolling(_branch: string) { /* noop */ }
		stopPolling() { /* noop */ }
		async saveToken(_t: string) { /* noop */ }
		async getToken() { return null; }
		saveRepoName(_r: string) { /* noop */ }
		getRepoName() { return null; }
	}

	const workspaceStub = {
		getWorkspace: () => ({ folders: [{ uri: { fsPath: '/repo' } }] }),
	} as any;

	const mainProcessStub = {
		getChannel: (_n: string) => ({
			call: async () => undefined,
			listen: () => ({ dispose() { } }),
		}),
	} as any;

	function makeFailure(overrides: Partial<CIRunFailure> = {}): CIRunFailure {
		return {
			runId: '1',
			workflowName: 'CI',
			branch: 'main',
			commitSha: 'abc123',
			failedJobs: [{
				name: 'build',
				failedStep: 'Run tests',
				logs: 'FAIL src/foo.test.ts',
				affectedFiles: ['src/foo.ts'],
			}],
			htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
			...overrides,
		};
	}

	/**
	 * Builds a RibixCIContribution using lightweight stubs.
	 * We call the constructor directly instead of going through DI so there is
	 * no Emitter/Disposable leak from workbench registration machinery.
	 */
	function makeContribution(ciService: FakeCIService, notificationService: FakeNotificationService, missionService: FakeMissionService): RibixCIContribution {
		// Construct with positional args matching the DI constructor order:
		// @IRibixCIService, @IRibixMissionService, @INotificationService, @IWorkspaceContextService, @IMainProcessService
		return new (RibixCIContribution as any)(
			ciService,
			missionService,
			notificationService,
			workspaceStub,
			mainProcessStub,
		);
	}

	test('notification is shown on failure', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure());

		assert.strictEqual(notificationService.prompts.length, 1, 'one notification shown');
		assert.strictEqual(notificationService.prompts[0].severity, Severity.Error);
		assert.ok(notificationService.prompts[0].message.includes('CI failed'));

		contribution.dispose();
	});

	test('notification has "Open mission" action button', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure());

		const prompt = notificationService.prompts[0];
		const openMission = prompt.actions.find(a => a.label === 'Open mission');
		assert.ok(openMission, '"Open mission" action button present');

		contribution.dispose();
	});

	test('notification has "View on GitHub" action button', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure());

		const prompt = notificationService.prompts[0];
		const viewGH = prompt.actions.find(a => a.label === 'View on GitHub');
		assert.ok(viewGH, '"View on GitHub" action button present');

		contribution.dispose();
	});

	test('notification message includes the branch name', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure({ branch: 'feature/my-branch' }));

		assert.ok(notificationService.prompts[0].message.includes('feature/my-branch'), 'branch name in message');

		contribution.dispose();
	});

	test('notification message includes the failed step name', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure({ failedJobs: [{ name: 'build', failedStep: 'npm run test', logs: '', affectedFiles: [] }] }));

		assert.ok(notificationService.prompts[0].message.includes('npm run test'), 'failed step name in message');

		contribution.dispose();
	});

	test('"Open mission" action triggers createMission with correct outcome', async () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		// Stub window.open so it doesn't throw in test environment
		const origOpen = (globalThis as any).window?.open;
		if (!(globalThis as any).window) { (globalThis as any).window = {}; }
		(globalThis as any).window.open = () => { /* noop */ };

		const contribution = makeContribution(ciService, notificationService, missionService);
		const failure = makeFailure({ workflowName: 'Integration CI' });

		ciService.fire(failure);

		const prompt = notificationService.prompts[0];
		const openMission = prompt.actions.find(a => a.label === 'Open mission')!;
		openMission.run();

		// createMission is async inside run(); yield to let the microtask queue drain
		await new Promise<void>(res => setTimeout(res, 0));

		assert.strictEqual(missionService.created.length, 1, 'createMission was called');
		assert.ok(missionService.created[0].outcome.includes('Integration CI'), 'workflow name in outcome');

		if (origOpen !== undefined) {
			(globalThis as any).window.open = origOpen;
		}

		contribution.dispose();
	});

	test('notification is not shown when failedJobs is empty', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure({ failedJobs: [] }));

		assert.strictEqual(notificationService.prompts.length, 0, 'no prompt when no failed jobs');

		contribution.dispose();
	});

	test('multiple failures each produce a separate notification', () => {
		const ciService = new FakeCIService();
		const notificationService = new FakeNotificationService();
		const missionService = new FakeMissionService();

		const contribution = makeContribution(ciService, notificationService, missionService);

		ciService.fire(makeFailure({ runId: '1' }));
		ciService.fire(makeFailure({ runId: '2' }));

		assert.strictEqual(notificationService.prompts.length, 2, 'one notification per failure event');

		contribution.dispose();
	});
});
