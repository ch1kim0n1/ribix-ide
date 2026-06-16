/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SandboxPolicy {
	allowedDomains: string[];    // e.g. ["staging.example.com"]
	blockedDomains: string[];    // e.g. ["production.example.com", "api.stripe.com"]
	maxOutboundRequests: number; // per agent run
	allowFileWrites: boolean;
	allowShellCommands: boolean;
}

interface AgentStats {
	requestCount: number;
	blockedCount: number;
}

/**
 * AgentSandbox enforces outbound request policy for agent runs.
 * Each agent run is tracked by agentId. Calls to guardRequest() throw
 * SandboxBlockedError when the URL is denied or the per-run request budget
 * is exhausted.
 *
 * TODO (wire-up): call guardRequest() inside the agent HTTP tool in
 * ribixAgentService.ts before every outbound fetch. The agentId is available
 * on AgentInstance. A shared singleton (agentSandboxInstance) should be used
 * so the policy is consistent across all agent types.
 */
export class AgentSandbox {
	private readonly stats: Map<string, AgentStats> = new Map();

	constructor(private policy: SandboxPolicy) {}

	/**
	 * Returns whether the given URL is allowed by the current policy.
	 * Blocked domains take precedence over allowed domains.
	 */
	checkUrl(url: string): { allowed: boolean; reason?: string } {
		let hostname: string;
		try {
			hostname = new URL(url).hostname;
		} catch {
			return { allowed: false, reason: `Malformed URL: ${url}` };
		}

		// Blocked domains have priority.
		for (const blocked of this.policy.blockedDomains) {
			if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
				return { allowed: false, reason: `Domain ${hostname} is in the blocked list` };
			}
		}

		// If allowedDomains is non-empty, only those domains are permitted.
		if (this.policy.allowedDomains.length > 0) {
			const isAllowed = this.policy.allowedDomains.some(
				(allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
			);
			if (!isAllowed) {
				return {
					allowed: false,
					reason: `Domain ${hostname} is not in the allowed list`
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Call before each outbound HTTP request from an agent.
	 * Throws SandboxBlockedError if the request is not permitted.
	 */
	guardRequest(url: string, agentId: string): void {
		const agentStats = this.getOrCreateStats(agentId);

		if (agentStats.requestCount >= this.policy.maxOutboundRequests) {
			agentStats.blockedCount++;
			throw new SandboxBlockedError(
				agentId,
				url,
				`Agent ${agentId} exceeded maxOutboundRequests (${this.policy.maxOutboundRequests})`
			);
		}

		const check = this.checkUrl(url);
		if (!check.allowed) {
			agentStats.blockedCount++;
			throw new SandboxBlockedError(agentId, url, check.reason ?? 'URL blocked by policy');
		}

		agentStats.requestCount++;
	}

	/**
	 * Returns current usage stats for the given agentId.
	 */
	getStats(agentId: string): { requestCount: number; blockedCount: number } {
		return { ...this.getOrCreateStats(agentId) };
	}

	/**
	 * Resets stats for the given agentId. Call at the start of a new agent run.
	 */
	resetStats(agentId: string): void {
		this.stats.delete(agentId);
	}

	/**
	 * Updates the active policy. Takes effect on the next guardRequest call.
	 */
	updatePolicy(policy: SandboxPolicy): void {
		this.policy = policy;
	}

	getPolicy(): SandboxPolicy {
		return { ...this.policy };
	}

	private getOrCreateStats(agentId: string): AgentStats {
		if (!this.stats.has(agentId)) {
			this.stats.set(agentId, { requestCount: 0, blockedCount: 0 });
		}
		return this.stats.get(agentId)!;
	}

	/**
	 * Creates a default sandbox policy from a staging URL.
	 * The extracted domain becomes the only allowed domain; all others are blocked.
	 * This prevents agents configured for staging from accidentally hitting production.
	 */
	static fromStagingUrl(stagingUrl: string): SandboxPolicy {
		let domain: string;
		try {
			domain = new URL(stagingUrl).hostname;
		} catch {
			throw new Error(`Cannot create SandboxPolicy: invalid staging URL "${stagingUrl}"`);
		}

		return {
			allowedDomains: [domain],
			blockedDomains: [],
			maxOutboundRequests: 100,
			allowFileWrites: false,
			allowShellCommands: false,
		};
	}
}

/**
 * Thrown by AgentSandbox.guardRequest() when a request is denied.
 */
export class SandboxBlockedError extends Error {
	constructor(
		public readonly agentId: string,
		public readonly url: string,
		public readonly policyReason: string
	) {
		super(`[AgentSandbox] Request blocked for agent ${agentId}: ${policyReason} (url=${url})`);
		this.name = 'SandboxBlockedError';
	}
}

/**
 * Shared singleton for use in agent execution code.
 * TODO (wire-up): inject this into ribixAgentService.ts and call
 * agentSandboxInstance.guardRequest(url, agentId) before each tool HTTP call.
 * The policy should be populated from user settings or the staging connector URL.
 */
export const agentSandboxInstance = new AgentSandbox({
	allowedDomains: [],
	blockedDomains: [],
	maxOutboundRequests: 200,
	allowFileWrites: false,
	allowShellCommands: false,
});

/**
 * Registers the ribix.configureSandbox command.
 * Opens a QuickPick so the user can inspect and adjust the active sandbox policy.
 * Full settings UI is a TODO — this QuickPick covers the essentials for now.
 */
export function registerAgentSandboxCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('ribix.configureSandbox', async () => {
		const currentPolicy = agentSandboxInstance.getPolicy();

		const options: vscode.QuickPickItem[] = [
			{
				label: '$(globe) Allowed domains',
				description: currentPolicy.allowedDomains.length > 0
					? currentPolicy.allowedDomains.join(', ')
					: '(all domains allowed)',
			},
			{
				label: '$(circle-slash) Blocked domains',
				description: currentPolicy.blockedDomains.length > 0
					? currentPolicy.blockedDomains.join(', ')
					: '(none)',
			},
			{
				label: '$(arrow-up) Max outbound requests per run',
				description: String(currentPolicy.maxOutboundRequests),
			},
			{
				label: '$(file-code) Allow file writes',
				description: currentPolicy.allowFileWrites ? 'Yes' : 'No',
			},
			{
				label: '$(terminal) Allow shell commands',
				description: currentPolicy.allowShellCommands ? 'Yes' : 'No',
			},
			{
				label: '$(settings-gear) Set policy from staging URL…',
				description: 'Derive allowed domain from the current staging connector URL',
			},
		];

		const picked = await vscode.window.showQuickPick(options, {
			title: 'Agent Sandbox Policy',
			placeHolder: 'Current policy — full editor UI is a TODO',
		});

		if (!picked) {
			return;
		}

		if (picked.label.includes('Set policy from staging URL')) {
			const stagingUrl = await vscode.window.showInputBox({
				title: 'Staging URL',
				prompt: 'Enter the staging connector URL to derive sandbox policy from',
				placeHolder: 'https://staging.example.com',
				ignoreFocusOut: true,
			});
			if (!stagingUrl) {
				return;
			}
			try {
				const newPolicy = AgentSandbox.fromStagingUrl(stagingUrl);
				agentSandboxInstance.updatePolicy(newPolicy);
				// Persist the staging URL to workspace configuration so the tester agent
				// can read it via IConfigurationService ('ribix.stagingUrl').
				await vscode.workspace.getConfiguration().update(
					'ribix.stagingUrl',
					stagingUrl,
					vscode.ConfigurationTarget.Workspace
				);
				vscode.window.showInformationMessage(
					`Sandbox policy updated: only ${newPolicy.allowedDomains[0]} is allowed. Staging URL saved for Playwright QA.`
				);
			} catch (err) {
				vscode.window.showErrorMessage(
					err instanceof Error ? err.message : 'Failed to parse staging URL.'
				);
			}
		}
		// TODO: add interactive editing for individual policy fields via showInputBox calls.
	});
}
