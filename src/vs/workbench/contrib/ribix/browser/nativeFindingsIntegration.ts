/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * NativeFindingsIntegration — IDE-Native Findings (Phase: PLANNED)
 *
 * Re-implements the core ribix-vscode extension features natively so ribix-ide
 * users get identical findings functionality without needing to install the
 * separate VS Code extension.
 *
 * ## Implementation source map (ribix-vscode → this file)
 *
 * | Feature                     | Source file in ribix-vscode                          |
 * |-----------------------------|------------------------------------------------------|
 * | Findings sidebar tree       | src/sidebar/findingsTreeProvider.ts                  |
 * | Findings tree item          | src/sidebar/findingTreeItem.ts  (& decorations/)     |
 * | Gutter decorations          | src/decorations/findingDecorationProvider.ts         |
 * | Approve/reject commands     | src/commands/triggerRunCommand.ts (approve/reject)   |
 * | SSE stream from backend     | src/events/sseClient.ts                              |
 * | Notifications on run done   | src/notifications/agentNotifications.ts              |
 * | Run detail / findings API   | src/api/agentFindings.ts + src/core/apiClient.ts     |
 *
 * ## Port strategy
 *
 * 1. FindingsTreeProvider (src/sidebar/findingsTreeProvider.ts)
 *    - Copy the class verbatim; swap the `import * as vscode from 'vscode'`
 *      for the VS Code API re-export available in the IDE build.
 *    - Replace all `Finding` type imports with the equivalent type from
 *      ../common/ribixTypes.ts (AgentFinding).
 *    - The tree view ID to register: 'ribix.nativeFindings'.
 *
 * 2. FindingDecorationProvider (src/decorations/findingDecorationProvider.ts)
 *    - Copy the class; replace media asset paths with the IDE-native media path
 *      (src/vs/workbench/contrib/ribix/browser/media/).
 *    - The gutter icon SVGs (gutter-red.svg, gutter-yellow.svg, gutter-green.svg,
 *      gutter-grey.svg) must be added to that media directory.
 *    - Wire update() calls from the SSE stream handler below.
 *
 * 3. Approve/reject commands (src/commands/triggerRunCommand.ts)
 *    - Register ribix.approveFinding and ribix.rejectFinding via
 *      CommandsRegistry.registerCommand (same pattern as ribixReleaseActions.ts).
 *    - These commands call the backend endpoint PATCH /cli/findings/:id/status.
 *
 * 4. SSE stream (src/events/sseClient.ts)
 *    - Copy SseClient verbatim — it has no VS Code dependency, only fetch().
 *    - Use it in startFindingsStream() below to consume the
 *      GET /cli/agent-runs/:runId/stream endpoint.
 *    - On each 'finding_discovered' event call decorationProvider.update() and
 *      treeProvider.setFindings().
 *
 * ## Status: PLANNED — stubs below, ready for implementation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AgentFinding } from '../common/ribixTypes.js';
import { BackendFinding, UnifiedFinding, FindingFilter } from './unifiedFindingsProvider.js';

// Re-export for callers that use this module as the single import point.
export type { BackendFinding, UnifiedFinding, FindingFilter };

export interface FindingStub {
	id: string;
	title: string;
	severity: 'p0' | 'p1' | 'p2' | 'p3';
	status: 'new' | 'pending' | 'approved' | 'rejected' | 'false_positive';
	type: string;
	affectedFiles: string[];
	description: string;
	createdAt: string;
}

// Alias so external callers can refer to AgentFinding through this module.
export type { AgentFinding as Finding };

// ---------------------------------------------------------------------------
// FindingTreeItem — wraps a BackendFinding as a VS Code tree item
// ---------------------------------------------------------------------------

const FINDING_TYPE_LABEL: Record<string, string> = {
	crash: 'CRASH', logic: 'LOGIC', visual: 'VISUAL', perf: 'PERF',
	a11y: 'A11Y', security: 'SECURITY', 'data-loss-risk': 'DATA LOSS',
	'rate-limit-blind': 'RATE LIMIT', 'env-parity': 'ENV PARITY',
	'third-party-resilience': 'RESILIENCE', 'legal-compliance': 'LEGAL',
	'copy-consistency': 'COPY', 'observability-gap': 'OBSERVABILITY',
	'day-2-failure': 'DAY-2', 'code-architecture': 'ARCHITECTURE',
	'onboarding-drop-off': 'ONBOARDING', 'ai-smell': 'AI SMELL',
	'token-cost': 'TOKEN COST',
};

export class FindingTreeItem extends vscode.TreeItem {
	constructor(public readonly finding: BackendFinding) {
		super(finding.title, vscode.TreeItemCollapsibleState.None);
		this.id = finding.id;
		const typeLabel = FINDING_TYPE_LABEL[finding.type] ?? finding.type.toUpperCase();
		this.description = `${finding.severity.toUpperCase()} · ${typeLabel}`;
		this.tooltip = new vscode.MarkdownString(
			`**${finding.severity.toUpperCase()}** — ${finding.title}\n\nType: ${typeLabel}\n\n${finding.description}`
		);
		this.iconPath = FindingTreeItem.iconForSeverity(finding.severity);
		this.contextValue = 'ribixNativeFinding';
		this.command = {
			command: 'ribix.viewFinding',
			title: 'View Finding',
			arguments: [finding.id],
		};
	}

	static iconForSeverity(severity: string): vscode.ThemeIcon {
		if (severity === 'p0' || severity === 'p1') {
			return new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
		}
		return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
	}
}

// ---------------------------------------------------------------------------
// FindingsTreeProvider — tree data provider for native findings sidebar
// ---------------------------------------------------------------------------

export class FindingsTreeProvider implements vscode.TreeDataProvider<FindingTreeItem>, vscode.Disposable {
	private static readonly MAX_FINDINGS = 2000;
	private _findings: BackendFinding[] = [];
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<FindingTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	getTreeItem(element: FindingTreeItem): vscode.TreeItem { return element; }

	getChildren(element?: FindingTreeItem): FindingTreeItem[] {
		if (element) { return []; }
		const sorted = [...this._findings].sort((a, b) => {
			const rank: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
			const diff = (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2);
			return diff !== 0 ? diff : b.createdAt - a.createdAt;
		});
		return sorted.map(f => new FindingTreeItem(f));
	}

	setFindings(findings: BackendFinding[]): void {
		this._findings = findings.slice(0, FindingsTreeProvider.MAX_FINDINGS);
		this._onDidChangeTreeData.fire();
	}

	addFinding(finding: BackendFinding): void {
		if (!this._findings.some(f => f.id === finding.id)) {
			this._findings = [finding, ...this._findings].slice(0, FindingsTreeProvider.MAX_FINDINGS);
			this._onDidChangeTreeData.fire();
		}
	}

	clear(): void {
		this._findings = [];
		this._onDidChangeTreeData.fire();
	}

	getFindings(): BackendFinding[] { return this._findings; }

	dispose(): void { this._onDidChangeTreeData.dispose(); }
}

// ---------------------------------------------------------------------------
// FindingDiagnosticProvider — surfaces findings in the Problems panel
// ---------------------------------------------------------------------------

export class FindingDiagnosticProvider implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection('ribix');

	update(findings: BackendFinding[], workspacePath: string): void {
		const byFile = new Map<string, BackendFinding[]>();
		for (const f of findings) {
			const filePath = f.affectedFiles[0];
			if (!filePath) { continue; }
			byFile.set(filePath, [...(byFile.get(filePath) ?? []), f]);
		}

		this.collection.clear();
		for (const [filePath, fileFindings] of byFile) {
			const uri = vscode.Uri.file(path.join(workspacePath, filePath));
			this.collection.set(uri, fileFindings.map(f => {
				const d = new vscode.Diagnostic(
					new vscode.Range(0, 0, 0, 0),
					`[Ribix] ${f.title}`,
					f.severity === 'p0' || f.severity === 'p1'
						? vscode.DiagnosticSeverity.Error
						: vscode.DiagnosticSeverity.Warning,
				);
				d.source = 'Ribix';
				d.code = f.id;
				return d;
			}));
		}
	}

	dispose(): void { this.collection.dispose(); }
}

/**
 * Re-implements core ribix-vscode features natively for ribix-ide users.
 *
 * Usage:
 *   const integration = new NativeFindingsIntegration();
 *   await integration.registerFindingsSidebar(context);
 *   await integration.registerFindingDecorations(context);
 *   integration.registerApproveRejectCommands(context, apiUrl, token);
 *   integration.startFindingsStream(apiUrl, token);
 */
export class NativeFindingsIntegration {
	private treeProvider: FindingsTreeProvider | null = null;
	private diagnosticProvider: FindingDiagnosticProvider | null = null;
	private streamStop: (() => void) | null = null;

	private readonly disposables: vscode.Disposable[] = [];

	/**
	 * Registers the findings sidebar panel using FindingsTreeProvider.
	 * The view ID 'ribix.nativeFindings' must be declared in the workbench view registry.
	 */
	async registerFindingsSidebar(context: vscode.ExtensionContext): Promise<void> {
		this.treeProvider = new FindingsTreeProvider();
		const treeView = vscode.window.createTreeView('ribix.nativeFindings', {
			treeDataProvider: this.treeProvider,
			showCollapseAll: true,
		});
		this.disposables.push(treeView, this.treeProvider);
		context.subscriptions.push(treeView);
	}

	/**
	 * Registers a FindingDiagnosticProvider that surfaces findings in the Problems panel.
	 * Gutter-icon decorations (requiring SVG assets) are not yet implemented.
	 */
	async registerFindingDecorations(context: vscode.ExtensionContext): Promise<void> {
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		this.diagnosticProvider = new FindingDiagnosticProvider();
		this.disposables.push(this.diagnosticProvider);
		context.subscriptions.push(this.diagnosticProvider);
		// diagnosticProvider.update() is called when findings arrive via startFindingsStream().
		void workspacePath;
	}

	/**
	 * Registers ribix.approveFinding and ribix.rejectFinding commands.
	 * Calls PATCH /cli/findings/:id/status on the backend.
	 */
	registerApproveRejectCommands(
		context: vscode.ExtensionContext,
		getConfig: () => Promise<{ apiUrl: string; accessToken: string } | null>,
	): void {
		const patchStatus = async (findingId: string, status: 'approved' | 'rejected' | 'false_positive'): Promise<void> => {
			const config = await getConfig();
			if (!config) {
				void vscode.window.showErrorMessage('Sign in to Ribix to approve or reject findings.');
				return;
			}
			const url = `${config.apiUrl.replace(/\/$/, '')}/cli/findings/${encodeURIComponent(findingId)}/status`;
			const response = await fetch(url, {
				method: 'PATCH',
				headers: {
					'Authorization': `Bearer ${config.accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ status }),
			});
			if (!response.ok) {
				void vscode.window.showErrorMessage(`Ribix: failed to update finding status (HTTP ${response.status}).`);
				return;
			}
			// Refresh the tree to reflect the new status.
			this.treeProvider?.clear();
			const findings = await this.syncBackendFindings(config.apiUrl, config.accessToken);
			this.treeProvider?.setFindings(findings);
		};

		const approveFinding = vscode.commands.registerCommand(
			'ribix.approveFinding',
			(args: { findingId: string }) => void patchStatus(args.findingId, 'approved'),
		);
		const rejectFinding = vscode.commands.registerCommand(
			'ribix.rejectFinding',
			(args: { findingId: string }) => void patchStatus(args.findingId, 'rejected'),
		);
		const markFalsePositive = vscode.commands.registerCommand(
			'ribix.markFalsePositive',
			(args: { findingId: string }) => void patchStatus(args.findingId, 'false_positive'),
		);

		this.disposables.push(approveFinding, rejectFinding, markFalsePositive);
		context.subscriptions.push(approveFinding, rejectFinding, markFalsePositive);
	}

	/**
	 * Opens an SSE connection to /cli/stream and pushes each arriving finding into
	 * the tree provider and diagnostic provider. Stops any previous stream.
	 */
	startFindingsStream(apiUrl: string, token: string): void {
		this.streamStop?.();
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

		this.streamStop = this.startBackendStream(apiUrl, token, (finding) => {
			this.treeProvider?.addFinding(finding);
			if (this.diagnosticProvider && this.treeProvider) {
				this.diagnosticProvider.update(this.treeProvider.getFindings(), workspacePath);
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Backend findings integration
	// ---------------------------------------------------------------------------

	/**
	 * Fetches findings from the backend /cli/findings API.
	 * Returns an empty array on any error — callers must not throw.
	 */
	async syncBackendFindings(apiUrl: string, token: string): Promise<BackendFinding[]> {
		try {
			const url = `${apiUrl.replace(/\/$/, '')}/cli/findings`;
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				console.warn(`[NativeFindingsIntegration] /cli/findings responded with ${response.status}`);
				return [];
			}

			const data = await response.json() as unknown;
			if (!Array.isArray(data)) {
				console.warn('[NativeFindingsIntegration] /cli/findings returned unexpected shape');
				return [];
			}

			return (data as BackendFinding[]).filter(item =>
				typeof item === 'object' && item !== null && typeof (item as any).id === 'string',
			);
		} catch (e) {
			console.warn('[NativeFindingsIntegration] syncBackendFindings failed:', e);
			return [];
		}
	}

	/**
	 * Starts an SSE stream to /cli/stream for real-time finding updates.
	 * Returns a cleanup function that closes the stream.
	 */
	startBackendStream(apiUrl: string, token: string, onFinding: (f: BackendFinding) => void): () => void {
		const controller = new AbortController();
		const url = `${apiUrl.replace(/\/$/, '')}/cli/stream`;

		const run = async (): Promise<void> => {
			try {
				const response = await fetch(url, {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Accept': 'text/event-stream',
					},
					signal: controller.signal,
				});

				if (!response.ok || !response.body) {
					console.warn(`[NativeFindingsIntegration] /cli/stream responded with ${response.status}`);
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					buffer += decoder.decode(value, { stream: true });

					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventType = '';
					let eventData = '';

					for (const line of lines) {
						if (line.startsWith('event:')) {
							eventType = line.slice(6).trim();
						} else if (line.startsWith('data:')) {
							eventData += line.slice(5).trim();
						} else if (line === '' && eventData) {
							try {
								const parsed = JSON.parse(eventData) as unknown;
								if (eventType === 'finding' || eventType === 'finding_discovered') {
									const payload = parsed as { data?: BackendFinding } | BackendFinding;
									const finding = (payload as { data?: BackendFinding }).data ?? (payload as BackendFinding);
									if (finding && typeof (finding as any).id === 'string') {
										onFinding(finding as BackendFinding);
									}
								}
							} catch {
								// Malformed SSE event — skip silently.
							}
							eventType = '';
							eventData = '';
						}
					}
				}
			} catch (e: unknown) {
				if (e instanceof Error && e.name === 'AbortError') {
					return; // Normal cleanup.
				}
				console.warn('[NativeFindingsIntegration] stream error:', e);
			}
		};

		run();
		return () => controller.abort();
	}

	/**
	 * Merges mission findings and backend findings into a unified list.
	 * Mission findings are labelled "Mission"; backend findings are labelled "Backend".
	 * Deduplicates by id (backend findings use their cloud id; mission findings get new UUIDs).
	 * Result is sorted by severity (high first) then receivedAt descending.
	 */
	mergeFindings(missionFindings: AgentFinding[], backendFindings: BackendFinding[]): UnifiedFinding[] {
		const now = Date.now();
		const map = new Map<string, UnifiedFinding>();

		const normalizeSeverity = (s: string | undefined): 'low' | 'medium' | 'high' => {
			if (s === 'high' || s === 'p0') { return 'high'; }
			if (s === 'low' || s === 'p2' || s === 'p3') { return 'low'; }
			return 'medium';
		};

		for (const f of missionFindings) {
			const id = `mission-${Math.random().toString(36).slice(2)}`;
			const uf: UnifiedFinding = {
				id,
				sourceLabel: 'Mission',
				source: 'mission',
				severity: normalizeSeverity(f.severity),
				file: f.file,
				line: f.line,
				message: f.message,
				findingType: f.findingType,
				receivedAt: now,
			};
			map.set(id, uf);
		}

		for (const b of backendFindings) {
			const uf: UnifiedFinding = {
				id: b.id,
				sourceLabel: 'Backend',
				source: 'backend',
				severity: normalizeSeverity(b.severity),
				file: b.affectedFiles?.[0] ?? '',
				line: null,
				message: b.title + (b.description && b.description !== b.title ? ': ' + b.description : ''),
				findingType: b.type,
				cloudId: b.id,
				receivedAt: b.createdAt ?? now,
			};
			const existing = map.get(b.id);
			if (!existing || uf.receivedAt >= existing.receivedAt) {
				map.set(b.id, uf);
			}
		}

		const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
		return [...map.values()].sort((a, b) => {
			const diff = (severityRank[a.severity] ?? 1) - (severityRank[b.severity] ?? 1);
			if (diff !== 0) { return diff; }
			return b.receivedAt - a.receivedAt;
		});
	}

	/** Stops the SSE stream and disposes all registrations. */
	dispose(): void {
		this.streamStop?.();
		this.streamStop = null;
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}
}
