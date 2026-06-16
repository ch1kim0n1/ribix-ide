/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IRibixMissionService } from './ribixMissionService.js';
import { MissionContext } from '../common/ribixTypes.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

// ---------- Public types ----------

export interface CIFailedJob {
	/** Name of the GitHub Actions job. */
	name: string;
	/** The first step inside the job that failed. */
	failedStep: string;
	/** Last 2000 chars of the job log. */
	logs: string;
	/** Files changed in the triggering commit. */
	affectedFiles: string[];
}

export interface CIRunFailure {
	runId: string;
	workflowName: string;
	branch: string;
	commitSha: string;
	failedJobs: CIFailedJob[];
	htmlUrl: string;
}

// ---------- Poller ----------

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const JOB_LOG_TRIM_CHARS = 2000;

/** Pure network helper — no DI, constructed by the service with a resolved token. */
export class GitHubActionsPoller {
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	/** Run ID of the last failure we surfaced, to avoid re-firing for the same run. */
	private lastSeenRunId: string | null = null;

	constructor(
		private readonly token: string,
		private readonly repoFullName: string,
	) { }

	/**
	 * Start polling for failures on `branch` every 2 minutes.
	 * Fires `onFailure` immediately on the first tick if a failure is already present,
	 * and on every subsequent tick where a *new* failed run is detected.
	 * Calling this again stops any in-flight interval before starting a new one.
	 */
	async startPolling(branch: string, onFailure: (failure: CIRunFailure) => void): Promise<void> {
		this.stop();
		const tick = async () => {
			try {
				const failure = await this.getLatestRun(branch);
				if (failure && failure.runId !== this.lastSeenRunId) {
					this.lastSeenRunId = failure.runId;
					onFailure(failure);
				}
			} catch (e) {
				console.warn('[ciIntegration] poll error:', e);
			}
		};
		await tick(); // immediate first check, awaited so the caller knows the first result
		this.intervalHandle = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
	}

	/**
	 * Returns the most recent failed run on `branch`, or null if there is none
	 * or all recent runs are green.
	 */
	async getLatestRun(branch: string): Promise<CIRunFailure | null> {
		const url =
			`https://api.github.com/repos/${this.repoFullName}/actions/runs` +
			`?branch=${encodeURIComponent(branch)}&status=failure&per_page=1`;

		const resp = await this.ghFetch(url);
		if (!resp.ok) { return null; }

		const body = await resp.json() as { workflow_runs?: GHWorkflowRun[] };
		const run = body.workflow_runs?.[0];
		if (!run) { return null; }

		const failedJobs = await this.getFailedJobs(String(run.id), run.head_sha);
		if (failedJobs.length === 0) { return null; }

		return {
			runId: String(run.id),
			workflowName: run.name,
			branch,
			commitSha: run.head_sha,
			failedJobs,
			htmlUrl: run.html_url,
		};
	}

	/** Returns all failed jobs in a run, with trimmed logs and the commit's changed files. */
	private async getFailedJobs(runId: string, commitSha: string): Promise<CIFailedJob[]> {
		const jobsUrl = `https://api.github.com/repos/${this.repoFullName}/actions/runs/${runId}/jobs`;
		const resp = await this.ghFetch(jobsUrl);
		if (!resp.ok) { return []; }

		const body = await resp.json() as { jobs?: GHJob[] };
		const jobs = body.jobs ?? [];

		const affectedFiles = await this.getCommitFiles(commitSha);

		const failed: CIFailedJob[] = [];
		for (const job of jobs) {
			if (job.conclusion !== 'failure') { continue; }

			const failedStep =
				job.steps?.find(s => s.conclusion === 'failure')?.name ?? 'unknown step';

			const logs = await this.getJobLogs(String(job.id));

			failed.push({ name: job.name, failedStep, logs, affectedFiles });
		}
		return failed;
	}

	/** Fetches and trims the log text for a single job. */
	async getJobLogs(jobId: string): Promise<string> {
		const url = `https://api.github.com/repos/${this.repoFullName}/actions/jobs/${jobId}/logs`;
		try {
			const resp = await this.ghFetch(url);
			if (!resp.ok) { return ''; }
			const text = await resp.text();
			return text.length > JOB_LOG_TRIM_CHARS
				? text.slice(-JOB_LOG_TRIM_CHARS)
				: text;
		} catch {
			return '';
		}
	}

	/** Returns file paths changed in a commit (best-effort — returns [] on any error). */
	private async getCommitFiles(sha: string): Promise<string[]> {
		try {
			const url = `https://api.github.com/repos/${this.repoFullName}/commits/${sha}`;
			const resp = await this.ghFetch(url);
			if (!resp.ok) { return []; }
			const body = await resp.json() as { files?: Array<{ filename: string }> };
			return (body.files ?? []).map(f => f.filename);
		} catch {
			return [];
		}
	}

	/** Stop polling. Safe to call if not currently polling. */
	stop(): void {
		if (this.intervalHandle !== null) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	private ghFetch(url: string): Promise<Response> {
		return fetch(url, {
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
	}
}

// Minimal GitHub API response shapes used by the poller

interface GHWorkflowRun {
	id: number;
	name: string;
	head_sha: string;
	html_url: string;
}

interface GHJobStep {
	name: string;
	conclusion: string | null;
}

interface GHJob {
	id: number;
	name: string;
	conclusion: string | null;
	steps?: GHJobStep[];
}

// ---------- Service interface ----------

export interface IRibixCIService {
	readonly _serviceBrand: undefined;

	/** Fired when a newly-seen CI failure is detected on the polled branch. */
	readonly onDidDetectFailure: Event<CIRunFailure>;

	/**
	 * Start polling for the given branch. Idempotent — stops any previous poll
	 * before starting a new one. No-op if not configured.
	 */
	startPolling(branch: string): Promise<void>;

	/** Stop any active poll. */
	stopPolling(): void;

	/** Returns true when a GitHub token and repo name are both stored. */
	isConfigured(): Promise<boolean>;

	/** Persist a GitHub token (encrypted). */
	saveToken(rawToken: string): Promise<void>;

	/** Retrieve and decrypt the stored token. Returns null if absent. */
	getToken(): Promise<string | null>;

	/** Persist the repo full name (`owner/repo`). */
	saveRepoName(repoFullName: string): void;

	/** Read the stored repo full name. Returns null if absent. */
	getRepoName(): string | null;
}

export const IRibixCIService = createDecorator<IRibixCIService>('ribixCIService');

// ---------- Storage keys ----------

/** Encrypted GitHub token — APPLICATION scope so it persists across workspaces. */
const CI_GITHUB_TOKEN_KEY = 'ribix.ci.githubToken';
/** Plain-text repo full name (`owner/repo`) — APPLICATION scope. */
const CI_REPO_NAME_KEY = 'ribix.ci.repoFullName';

// ---------- Service implementation ----------

class RibixCIService extends Disposable implements IRibixCIService {
	readonly _serviceBrand: undefined;

	private readonly _onDidDetectFailure = this._register(new Emitter<CIRunFailure>());
	readonly onDidDetectFailure: Event<CIRunFailure> = this._onDidDetectFailure.event;

	private poller: GitHubActionsPoller | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
	) {
		super();
	}

	async isConfigured(): Promise<boolean> {
		const token = await this.getToken();
		const repo = this.getRepoName();
		return !!token && !!repo;
	}

	async startPolling(branch: string): Promise<void> {
		const token = await this.getToken();
		const repo = this.getRepoName();
		if (!token || !repo) { return; }

		this.poller?.stop();
		this.poller = new GitHubActionsPoller(token, repo);
		await this.poller.startPolling(branch, failure => {
			this._onDidDetectFailure.fire(failure);
		});
	}

	stopPolling(): void {
		this.poller?.stop();
		this.poller = null;
	}

	async saveToken(rawToken: string): Promise<void> {
		const encrypted = await this.encryptionService.encrypt(rawToken);
		this.storageService.store(
			CI_GITHUB_TOKEN_KEY, encrypted, StorageScope.APPLICATION, StorageTarget.USER,
		);
	}

	async getToken(): Promise<string | null> {
		const stored = this.storageService.get(CI_GITHUB_TOKEN_KEY, StorageScope.APPLICATION);
		if (!stored) { return null; }
		try {
			return await this.encryptionService.decrypt(stored as string);
		} catch {
			return null;
		}
	}

	saveRepoName(repoFullName: string): void {
		this.storageService.store(
			CI_REPO_NAME_KEY, repoFullName, StorageScope.APPLICATION, StorageTarget.USER,
		);
	}

	getRepoName(): string | null {
		return this.storageService.get(CI_REPO_NAME_KEY, StorageScope.APPLICATION) ?? null;
	}

	override dispose(): void {
		this.stopPolling();
		super.dispose();
	}
}

registerSingleton(IRibixCIService, RibixCIService, InstantiationType.Delayed);

// ---------- Workbench contribution — wires polling to the git branch ----------

const MISSION_LOG_TRIM = 500;

export class RibixCIContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.ribixCI';

	private readonly voidSCM: IVoidSCMService;

	constructor(
		@IRibixCIService private readonly ciService: IRibixCIService,
		@IRibixMissionService private readonly missionService: IRibixMissionService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		this.voidSCM = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));

		this._register(ciService.onDidDetectFailure(failure => {
			this.onFailure(failure);
		}));

		// Start polling asynchronously — non-blocking, best-effort.
		void this.tryStartPolling();
	}

	private async tryStartPolling(): Promise<void> {
		const configured = await this.ciService.isConfigured();
		if (!configured) { return; }

		const branch = await this.detectBranch();
		if (!branch) { return; }

		await this.ciService.startPolling(branch);
	}

	private async detectBranch(): Promise<string | null> {
		const workspacePath = this.getWorkspacePath();
		if (!workspacePath) { return null; }
		try {
			return await this.voidSCM.gitBranch(workspacePath);
		} catch {
			return null;
		}
	}

	private getWorkspacePath(): string | null {
		try {
			const folders = this.workspaceContextService.getWorkspace().folders;
			return folders.length > 0 ? folders[0].uri.fsPath : null;
		} catch {
			return null;
		}
	}

	private onFailure(failure: CIRunFailure): void {
		const job = failure.failedJobs[0];
		if (!job) { return; }

		const label = `\`${failure.branch}\`: ${job.failedStep}`;

		this.notificationService.prompt(
			Severity.Error,
			`CI failed on ${label} — open a repair mission?`,
			[
				{
					label: 'Open mission',
					run: () => { void this.openRepairMission(failure); },
				},
				{
					label: 'View on GitHub',
					run: () => {
						// Open the run URL in the system browser.
						// We use window.open (works in both web and Electron renderer).
						window.open(failure.htmlUrl, '_blank', 'noopener,noreferrer');
					},
				},
			],
		);
	}

	private async openRepairMission(failure: CIRunFailure): Promise<void> {
		const job = failure.failedJobs[0];
		if (!job) { return; }

		const logSnippet = job.logs.length > MISSION_LOG_TRIM
			? job.logs.slice(-MISSION_LOG_TRIM)
			: job.logs;

		const outcome =
			`Fix the failing CI: ${failure.workflowName} — ${job.failedStep}\n\n` +
			`Failing test output:\n${logSnippet}\n\n` +
			`Files changed in this commit:\n${job.affectedFiles.join('\n')}`;

		const context: MissionContext = {
			// Scope the mission to the commit's changed files so agents only look there.
			attachedFiles: job.affectedFiles,
			attachedSelections: [],
			issueUrls: [],
			notes:
				`CI run: ${failure.htmlUrl}\n` +
				`Branch: ${failure.branch}\n` +
				`Commit: ${failure.commitSha}`,
		};

		try {
			await this.missionService.createMission(outcome, context);
		} catch (e) {
			console.error('[ciIntegration] createMission failed:', e);
		}
	}
}

registerWorkbenchContribution2(
	RibixCIContribution.ID,
	RibixCIContribution,
	WorkbenchPhase.BlockRestore,
);

// ---------- Configure CI Integration command ----------

export const RIBIX_CONFIGURE_CI_COMMAND_ID = 'ribix.configureCiIntegration';

registerAction2(class ConfigureCIIntegrationAction extends Action2 {
	constructor() {
		super({
			id: RIBIX_CONFIGURE_CI_COMMAND_ID,
			title: localize2('ribix.configureCi', 'Ribix: Configure CI Integration'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const ciService = accessor.get(IRibixCIService);
		const mainProcessService = accessor.get(IMainProcessService);
		const notificationService = accessor.get(INotificationService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);

		// --- Step 1: GitHub token ---
		const existingToken = await ciService.getToken();
		const tokenResult = await quickInput.input({
			prompt: 'Enter your GitHub personal access token (scopes needed: repo, actions)',
			password: true,
			value: existingToken ?? '',
			placeHolder: 'ghp_...',
		});
		if (tokenResult === undefined) { return; } // user cancelled
		const token = tokenResult.trim();
		if (!token) { return; }

		// --- Step 2: repo full name — auto-detect from git remote, else prompt ---
		let detectedRepo: string | null = null;
		try {
			const workspacePath =
				workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? null;
			if (workspacePath) {
				const voidSCM = ProxyChannel.toService<IVoidSCMService>(
					mainProcessService.getChannel('void-channel-scm'),
				);
				const remote = await voidSCM.gitRemoteUrl(workspacePath);
				// Accept both SSH ("git@github.com:owner/repo.git") and HTTPS forms.
				const match =
					remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/) ??
					remote.match(/github\.com\/([^/]+\/[^/]+)/);
				detectedRepo = match?.[1] ?? null;
			}
		} catch {
			detectedRepo = null;
		}

		const existingRepo = ciService.getRepoName();
		const repoResult = await quickInput.input({
			prompt: 'Enter the GitHub repository (owner/repo)',
			value: detectedRepo ?? existingRepo ?? '',
			placeHolder: 'owner/repo',
		});
		if (repoResult === undefined) { return; } // user cancelled
		const repo = repoResult.trim();
		if (!repo || !repo.includes('/')) {
			notificationService.notify({
				severity: Severity.Warning,
				message: 'Repository must be in the format owner/repo. CI integration not saved.',
			});
			return;
		}

		// --- Persist ---
		await ciService.saveToken(token);
		ciService.saveRepoName(repo);

		notificationService.notify({
			severity: Severity.Info,
			message: `Ribix CI integration configured for ${repo}. Polling will start on the next branch detection.`,
		});
	}
});
