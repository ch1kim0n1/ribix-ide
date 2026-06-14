/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IRibixMemoryService } from './ribixMemoryService.js';
import { Mission, MissionContext, PlanTask, MISSION_SCHEMA_VERSION, isMission, AgentFinding } from '../common/ribixTypes.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { IRibixPlanningService } from './ribixPlanningService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { RibixApiClient } from '../common/ribixApiClient.js';
import { ChangedChunk } from '../common/ribixChangedChunk.js';
import { SemverBump, maxBump, semverBumpFromConventionalCommits, semverBumpFromDiff } from '../common/ribixSemver.js';

export interface IRibixMissionService {
	readonly _serviceBrand: undefined;

	// Create
	createMission(outcome: string, context: MissionContext): Promise<Mission>;

	/**
	 * Auto-on-change entrypoint: create a QA mission scoped to a changed chunk with a
	 * pre-scoped Tester-led plan (planner scope -> tester -> debugger). The mission's
	 * context is populated from the chunk so the planner/agents are actually scoped.
	 * Respects maxConcurrentMissions: returns null (does not throw) when at capacity.
	 */
	createScopedQAMission(chunk: ChangedChunk): Promise<Mission | null>;

	// Read
	getMission(id: string): Mission | null;
	getAllMissions(): Mission[];
	getActiveMissions(): Mission[];

	// Transitions
	submitForPlanning(id: string): Promise<void>;
	setPlanReady(id: string, tasks: PlanTask[]): Promise<void>;
	setReviewing(id: string): Promise<void>;
	approvePlan(id: string, modifiedTasks?: PlanTask[]): Promise<void>;
	abortMission(id: string): Promise<void>;
	completeMission(id: string, result: Mission['result']): Promise<void>;
	prepareRelease(id: string): Promise<void>;

	// Persistence
	onDidChangeMissions: Event<void>;
}

export const IRibixMissionService = createDecorator<IRibixMissionService>('ribixMissionService');

/** Dedicated, versioned storage key for missions — separate from the memory store. */
const RIBIX_MISSIONS_STORAGE_KEY = 'ribix.missions.v1';
/** One-shot migration guard flag. */
const RIBIX_MISSIONS_MIGRATED_KEY = 'ribix.missions.migrated';

type PersistedMissions = { schemaVersion: number; missions: Mission[] };

export class RibixMissionService extends Disposable implements IRibixMissionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeMissions = new Emitter<void>();
	readonly onDidChangeMissions = this._onDidChangeMissions.event;

	private missions: Mission[] = [];
	private maxConcurrentMissions: number = 3;
	private voidSCM: IVoidSCMService;
	private _loadPromise: Promise<void>;

	constructor(
		@IRibixMemoryService private readonly memoryService: IRibixMemoryService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IRibixAuthService private readonly authService: IRibixAuthService,
		@IRibixPlanningService private readonly planningService: IRibixPlanningService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._register(this._onDidChangeMissions);
		this.voidSCM = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));
		this._loadPromise = this.loadMissions();
	}

	private async loadMissions(): Promise<void> {
		try {
			await this.migrateLegacyMissionsIfNeeded();

			const stored = this.storageService.get(RIBIX_MISSIONS_STORAGE_KEY, StorageScope.WORKSPACE);
			if (stored) {
				const parsed = JSON.parse(stored) as PersistedMissions;
				const candidates = Array.isArray(parsed?.missions) ? parsed.missions : [];
				this.missions = candidates.filter(isMission);
			} else {
				this.missions = [];
			}
			// Sort by createdAt descending
			this.missions.sort((a, b) => b.createdAt - a.createdAt);
		} catch (e) {
			console.error('Failed to load missions:', e);
			this.missions = [];
		}
	}

	/**
	 * One-shot migration: legacy missions were stored as `mission_summary` memory entries
	 * that collided with agent-written summaries. Salvage the well-formed Mission records,
	 * move them into the dedicated mission store, and remove the migrated legacy entries.
	 * Guarded by a flag so it runs at most once.
	 */
	private async migrateLegacyMissionsIfNeeded(): Promise<void> {
		if (this.storageService.getBoolean(RIBIX_MISSIONS_MIGRATED_KEY, StorageScope.WORKSPACE, false)) {
			return;
		}
		try {
			const workspaceId = await this.memoryService.getWorkspaceId();
			const legacyEntries = await this.memoryService.getEntries('mission_summary', workspaceId);
			const salvaged: Mission[] = [];
			for (const entry of legacyEntries) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(entry.content);
				} catch {
					continue; // malformed — skip
				}
				if (isMission(parsed)) {
					// Ensure schemaVersion present on migrated records.
					const mission = parsed as Mission;
					if (typeof mission.schemaVersion !== 'number') {
						mission.schemaVersion = MISSION_SCHEMA_VERSION;
					}
					// Deduplicate by id, keep latest createdAt.
					const existing = salvaged.find(m => m.id === mission.id);
					if (!existing) {
						salvaged.push(mission);
					} else if (mission.createdAt > existing.createdAt) {
						salvaged[salvaged.indexOf(existing)] = mission;
					}
					// Delete the legacy mission-shaped entry (leave agent-shaped ones).
					await this.memoryService.deleteEntry(entry.id).catch(() => { /* best-effort */ });
				}
			}
			if (salvaged.length > 0) {
				this.storageService.store(
					RIBIX_MISSIONS_STORAGE_KEY,
					JSON.stringify({ schemaVersion: MISSION_SCHEMA_VERSION, missions: salvaged } satisfies PersistedMissions),
					StorageScope.WORKSPACE,
					StorageTarget.USER,
				);
			}
		} catch (e) {
			console.error('Mission migration failed:', e);
		} finally {
			this.storageService.store(RIBIX_MISSIONS_MIGRATED_KEY, true, StorageScope.WORKSPACE, StorageTarget.USER);
		}
	}

	private async saveMission(mission: Mission): Promise<void> {
		// Update-in-place: replace the mission with matching id (or prepend), then persist
		// the whole array once — no per-transition appends.
		const all = this.missions.slice();
		const i = all.findIndex(m => m.id === mission.id);
		if (i >= 0) {
			all[i] = mission;
		} else {
			all.unshift(mission);
		}
		this.missions = all;
		this.storageService.store(
			RIBIX_MISSIONS_STORAGE_KEY,
			JSON.stringify({ schemaVersion: MISSION_SCHEMA_VERSION, missions: all } satisfies PersistedMissions),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		this._onDidChangeMissions.fire();
	}

	async createMission(outcome: string, context: MissionContext): Promise<Mission> {
		await this._loadPromise;
		const activeMissions = this.getActiveMissions();
		if (activeMissions.length >= this.maxConcurrentMissions) {
			throw new Error(`Maximum concurrent missions (${this.maxConcurrentMissions}) reached`);
		}

		const now = Date.now();
		const mission: Mission = {
			schemaVersion: MISSION_SCHEMA_VERSION,
			id: generateUuid(),
			outcome,
			state: 'awaiting_outcome',
			tasks: [],
			agentIds: [],
			branchName: '',
			context,
			createdAt: now,
			completedAt: null,
			result: null,
		};

		await this.saveMission(mission);
		return mission;
	}

	async createScopedQAMission(chunk: ChangedChunk): Promise<Mission | null> {
		await this._loadPromise;

		// Respect the concurrency cap WITHOUT throwing — auto-runs must never crash
		// the watcher; at capacity we simply skip this chunk.
		const activeMissions = this.getActiveMissions();
		if (activeMissions.length >= this.maxConcurrentMissions) {
			return null;
		}

		const fileList = chunk.files.map(f => f.uri);
		const context: MissionContext = {
			attachedFiles: fileList,
			attachedSelections: chunk.files.flatMap(f =>
				f.ranges.map(range => ({ filePath: f.uri, range, content: '' }))
			),
			issueUrls: [],
			notes: `Auto QA on changed chunk (trigger: ${chunk.trigger}${chunk.branch ? `, branch: ${chunk.branch}` : ''}). Scope strictly to the changed files/ranges.`,
		};

		const outcome = `Auto QA: verify the ${fileList.length} changed file(s) on ${chunk.trigger}`;

		const now = Date.now();
		const mission: Mission = {
			schemaVersion: MISSION_SCHEMA_VERSION,
			id: generateUuid(),
			outcome,
			state: 'awaiting_outcome',
			tasks: [],
			agentIds: [],
			branchName: '',
			context,
			autoTriggered: true,
			createdAt: now,
			completedAt: null,
			result: null,
		};
		await this.saveMission(mission);
		return mission;
	}

	getMission(id: string): Mission | null {
		return this.missions.find(m => m.id === id) || null;
	}

	getAllMissions(): Mission[] {
		return [...this.missions];
	}

	getActiveMissions(): Mission[] {
		return this.missions.filter(m => 
			['awaiting_outcome', 'planning', 'plan_ready', 'executing', 'reviewing'].includes(m.state)
		);
	}

	async submitForPlanning(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'awaiting_outcome') {
			throw new Error(`Cannot submit for planning: mission is in state ${mission.state}`);
		}

		mission.state = 'planning';
		await this.saveMission(mission);

		// Kick off the planning service — produces task graph and transitions to plan_ready.
		// Pass the mission's stored context so the planner is actually scoped (G-CONTEXT)
		// instead of the previously-hardcoded empty context.
		const planningContext: MissionContext = mission.context ?? {
			attachedFiles: [],
			attachedSelections: [],
			issueUrls: [],
			notes: '',
		};
		this.planningService.plan(id, mission.outcome, planningContext).then(tasks => {
			this.setPlanReady(id, tasks).catch(e => console.error('setPlanReady failed:', e));
		}).catch(e => {
			console.error('Planning failed:', e);
			const m = this.getMission(id);
			if (m) { m.state = 'failed'; this.saveMission(m); }
		});
	}

	async setPlanReady(id: string, tasks: PlanTask[]): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'planning') {
			throw new Error(`Cannot set plan ready: mission is in state ${mission.state}`);
		}
		mission.tasks = tasks;
		mission.state = 'plan_ready';
		await this.saveMission(mission);
	}

	async setReviewing(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'executing') {
			throw new Error(`Cannot set reviewing: mission is in state ${mission.state}`);
		}
		mission.state = 'reviewing';
		await this.saveMission(mission);
	}

	async approvePlan(id: string, modifiedTasks?: PlanTask[]): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'plan_ready') {
			throw new Error(`Cannot approve plan: mission is in state ${mission.state}`);
		}

		if (modifiedTasks) {
			mission.tasks = modifiedTasks;
		}

		// Create git branch
		const branchName = `ribix/mission-${mission.id.substring(0, 8)}`;
		mission.branchName = branchName;

		try {
			// Try to create branch via voidSCM
			const workspaceFolders = await this.getWorkspacePath();
			if (workspaceFolders) {
				await this.voidSCM.gitCreateBranch(workspaceFolders, branchName);
			}
		} catch (e) {
			console.error('Failed to create git branch:', e);
			// Continue without branch creation
		}

		mission.state = 'executing';
		await this.saveMission(mission);
	}

	async abortMission(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (['complete', 'aborted', 'failed'].includes(mission.state)) {
			throw new Error(`Cannot abort mission in state ${mission.state}`);
		}

		mission.state = 'aborted';
		mission.completedAt = Date.now();
		await this.saveMission(mission);
	}

	async completeMission(id: string, result: Mission['result']): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'executing' && mission.state !== 'reviewing') {
			throw new Error(`Cannot complete mission in state ${mission.state}`);
		}

		mission.state = 'complete';
		mission.completedAt = Date.now();
		mission.result = result;
		await this.saveMission(mission);

		// Sync memory to org on mission complete
		try {
			await this.memoryService.syncToOrg();
		} catch (e) {
			console.warn('Failed to sync memory to org after mission completion:', e);
		}

		// Fire-and-forget: submit IDE findings to the backend.
		// If the backend is unreachable we warn and continue — never fail the mission.
		this.submitFindingsToBackend(mission).catch(e => {
			console.warn('submitFindingsToBackend: unexpected error:', e);
		});
	}

	/**
	 * Collect all AgentFindings from the mission result and submit them to the backend.
	 * Silently skips if auth, workspace path, or repoFullName are unavailable.
	 */
	private async submitFindingsToBackend(mission: Mission): Promise<void> {
		try {
			// Collect findings from the mission result's reviewer findings.
			// reviewerFindings are plain strings; we also surface any structured
			// AgentFindings that agents wrote into their output (available via result).
			const findings: AgentFinding[] = [];

			if (mission.result) {
				// Map plain reviewer finding strings into AgentFinding shape
				for (const text of mission.result.reviewerFindings) {
					findings.push({
						severity: 'medium',
						file: '',
						line: null,
						message: text,
					});
				}
			}

			if (findings.length === 0) {
				return; // Nothing to submit
			}

			// Resolve auth config — skip silently if not signed in
			let config;
			try {
				config = await this.authService.getRequiredConfig();
			} catch {
				return; // Not signed in
			}

			// Resolve workspace path — skip silently if unavailable
			const workspacePath = await this.getWorkspacePath();
			if (!workspacePath) {
				return;
			}

			// Resolve repoFullName from the git remote URL
			let repoFullName: string | null = null;
			try {
				const remoteUrl = await this.voidSCM.gitRemoteUrl(workspacePath);
				repoFullName = this.parseRepoFullName(remoteUrl);
			} catch {
				// No git remote configured — skip submission
			}

			if (!repoFullName) {
				return;
			}

			const apiClient = new RibixApiClient();
			const response = await apiClient.submitFindings(config, repoFullName, findings, mission.id);
			console.log(`submitFindingsToBackend: submitted ${response.submitted} findings for mission ${mission.id}`);
		} catch (e) {
			console.warn('submitFindingsToBackend: failed to submit findings:', e);
		}
	}

	/**
	 * Parse a git remote URL into "owner/repo" format.
	 * Handles both HTTPS (https://github.com/owner/repo.git) and
	 * SSH (git@github.com:owner/repo.git) URL formats.
	 * Returns null if the URL cannot be parsed.
	 */
	private parseRepoFullName(remoteUrl: string): string | null {
		if (!remoteUrl) { return null; }

		// SSH format: git@github.com:owner/repo.git
		const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
		if (sshMatch) { return sshMatch[1]; }

		// HTTPS format: https://github.com/owner/repo.git
		const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
		if (httpsMatch) { return httpsMatch[1]; }

		return null;
	}

	async prepareRelease(id: string): Promise<void> {
		const mission = this.getMission(id);
		if (!mission) throw new Error(`Mission ${id} not found`);
		if (mission.state !== 'complete') {
			throw new Error(`Cannot prepare release: mission is in state ${mission.state}`);
		}

		if (!mission.result) {
			throw new Error(`Cannot prepare release: mission has no result`);
		}

		const workspacePath = await this.getWorkspacePath();
		if (!workspacePath) {
			throw new Error('Cannot prepare release: workspace path not available');
		}

		// Step 1: Analyze mission diff to determine semver bump
		const semverBump = await this.determineSemverBump(mission, workspacePath);

		// Step 2: Draft changelog entry from mission history + agent notes
		const changelogEntry = await this.draftChangelogEntry(mission);

		// Step 3: Bump version in package.json
		const newVersion = await this.bumpVersion(workspacePath, semverBump);

		// Step 4: Create git tag
		const tagName = `v${newVersion}`;
		await this.voidSCM.gitCreateTag(workspacePath, tagName, `Release ${newVersion}: ${mission.outcome.substring(0, 70)}`);

		// Step 5: Call ribixApiClient.createPR() with full context
		const config = await this.authService.getRequiredConfig();
		const apiClient = new RibixApiClient();

		const prTitle = mission.outcome.substring(0, 70);
		const prBody = this.buildPRBody(mission, changelogEntry, newVersion);

		const prResponse = await apiClient.createPR(config, {
			workspaceId: config.workspaceId,
			branchName: mission.branchName,
			title: prTitle,
			description: prBody,
		});

		// Update mission result with PR URL
		if (mission.result) {
			mission.result.prUrl = prResponse.prUrl;
		}
		await this.saveMission(mission);
	}

	private async determineSemverBump(mission: Mission, workspacePath: string): Promise<'patch' | 'minor' | 'major'> {
		// Strategy: parse conventional-commit prefixes from the mission branch's log
		// (feat -> minor, fix/chore -> patch, ! / BREAKING CHANGE -> major), fall back
		// to diff heuristics over the sampled diff, and take the max bump. Safe default
		// is `patch` — if SCM access fails we never over-bump.
		let bump: SemverBump = 'patch';
		try {
			const gitLog = await this.voidSCM.gitLog(workspacePath);
			bump = maxBump(bump, semverBumpFromConventionalCommits(gitLog));
		} catch (e) {
			console.warn('determineSemverBump: gitLog failed, ignoring:', e);
		}
		try {
			const diff = await this.voidSCM.gitSampledDiffs(workspacePath);
			bump = maxBump(bump, semverBumpFromDiff(diff));
		} catch (e) {
			console.warn('determineSemverBump: gitSampledDiffs failed, ignoring:', e);
		}
		return bump;
	}

	private async draftChangelogEntry(mission: Mission): Promise<string> {
		const lines: string[] = [];
		lines.push(`## ${new Date().toISOString().split('T')[0]}`);
		lines.push('');
		lines.push(`### Mission: ${mission.outcome.substring(0, 100)}`);
		lines.push('');
		if (mission.result) {
			lines.push(mission.result.summary);
			lines.push('');
			if (mission.result.testReport) {
				lines.push('**Test Report:**');
				lines.push('```');
				lines.push(mission.result.testReport);
				lines.push('```');
				lines.push('');
			}
			if (mission.result.reviewerFindings.length > 0) {
				lines.push('**Reviewer Findings:**');
				for (const finding of mission.result.reviewerFindings) {
					lines.push(`- ${finding}`);
				}
				lines.push('');
			}
		}
		return lines.join('\n');
	}

	private async bumpVersion(workspacePath: string, bumpType: 'patch' | 'minor' | 'major'): Promise<string> {
		// Read package.json
		const fs = await import('fs');
		const path = await import('path');
		const packageJsonPath = path.join(workspacePath, 'package.json');
		const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
		const packageJson = JSON.parse(packageJsonContent);

		// Parse current version
		const versionParts = packageJson.version.split('.').map(Number);
		let [major, minor, patch] = versionParts;

		// Bump version based on type
		switch (bumpType) {
			case 'major':
				major++;
				minor = 0;
				patch = 0;
				break;
			case 'minor':
				minor++;
				patch = 0;
				break;
			case 'patch':
				patch++;
				break;
		}

		const newVersion = `${major}.${minor}.${patch}`;
		packageJson.version = newVersion;

		// Write back to package.json
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

		return newVersion;
	}

	private buildPRBody(mission: Mission, changelogEntry: string, version: string): string {
		const lines: string[] = [];
		lines.push('## Mission Summary');
		lines.push('');
		lines.push(mission.outcome);
		lines.push('');
		lines.push('## Task List');
		lines.push('');
		for (const task of mission.tasks) {
			lines.push(`- [${task.status === 'complete' ? 'x' : ' '}] ${task.description} (${task.agentType})`);
		}
		lines.push('');
		lines.push('## Test Report');
		lines.push('');
		if (mission.result?.testReport) {
			lines.push('```');
			lines.push(mission.result.testReport);
			lines.push('```');
		} else {
			lines.push('No test report available.');
		}
		lines.push('');
		lines.push('## Agent Notes');
		lines.push('');
		for (const task of mission.tasks) {
			if (task.notes) {
				lines.push(`### ${task.description}`);
				lines.push(task.notes);
				lines.push('');
			}
		}
		lines.push('');
		lines.push('## Changelog');
		lines.push('');
		lines.push(changelogEntry);
		lines.push('');
		lines.push(`**Version:** ${version}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('*This PR was created by the Ribix Release Agent*');
		return lines.join('\n');
	}

	private async getWorkspacePath(): Promise<string | null> {
		try {
			const workspace = this.workspaceContextService.getWorkspace();
			if (workspace.folders.length > 0) {
				return workspace.folders[0].uri.fsPath;
			}
		} catch (e) {
			console.error('Failed to get workspace path:', e);
		}
		return null;
	}
}

registerSingleton(IRibixMissionService, RibixMissionService, InstantiationType.Delayed);