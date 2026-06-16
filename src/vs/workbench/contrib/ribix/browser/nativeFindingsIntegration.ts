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
import { AgentFinding } from '../common/ribixTypes.js';
import { BackendFinding, UnifiedFinding, FindingFilter } from './unifiedFindingsProvider.js';

// Re-export for callers that use this module as the single import point.
export type { BackendFinding, UnifiedFinding, FindingFilter };

// TODO: replace with the IDE's internal AgentFinding type from
// ../common/ribixTypes.ts once the port begins.
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

/**
 * Re-implements core ribix-vscode features natively for ribix-ide users.
 *
 * Usage (once implemented):
 *   const integration = new NativeFindingsIntegration();
 *   await integration.registerFindingsSidebar(context);
 *   await integration.registerFindingDecorations(context);
 *   integration.registerApproveRejectCommands(context);
 *   integration.startFindingsStream(apiUrl, token);
 */
export class NativeFindingsIntegration {
	// TODO: replace stubs with the real ported providers.
	// private treeProvider: FindingsTreeProvider | null = null;
	// private decorationProvider: FindingDecorationProvider | null = null;
	// private sseClient: SseClient | null = null;

	private readonly disposables: vscode.Disposable[] = [];

	/**
	 * Registers the findings sidebar panel.
	 *
	 * Port from: ribix-vscode/src/sidebar/findingsTreeProvider.ts
	 *   - FindingsTreeProvider implements vscode.TreeDataProvider<FindingTreeItem>
	 *   - FindingTreeItem (ribix-vscode/src/sidebar/findingTreeItem.ts &
	 *                       ribix-vscode/src/decorations/findingTreeItem.ts)
	 *     wraps a Finding and sets severity-based icons and contextValue.
	 *
	 * Registration pattern:
	 *   vscode.window.registerTreeDataProvider('ribix.nativeFindings', treeProvider)
	 *   vscode.window.createTreeView('ribix.nativeFindings', { treeDataProvider, showCollapseAll: true })
	 *
	 * TODO: after porting FindingsTreeProvider, replace the placeholder below with
	 * the real provider and remove this TODO comment.
	 */
	async registerFindingsSidebar(context: vscode.ExtensionContext): Promise<void> {
		// TODO: implement — port FindingsTreeProvider from:
		//   ribix-vscode/src/sidebar/findingsTreeProvider.ts
		//   ribix-vscode/src/sidebar/findingTreeItem.ts
		//   ribix-vscode/src/decorations/findingTreeItem.ts
		//
		// Steps:
		//   1. Copy FindingsTreeProvider into this file or a sibling file
		//      nativeFindingsTreeProvider.ts.
		//   2. Replace `Finding` with `FindingStub` (or AgentFinding from ribixTypes.ts).
		//   3. Register the tree view with ID 'ribix.nativeFindings'.
		//   4. Expose setFindings() so startFindingsStream() can update the tree.
		//
		// This stub registers a placeholder so the contribution point is wired up.
		const placeholder: vscode.TreeDataProvider<vscode.TreeItem> = {
			getTreeItem: (item) => item,
			getChildren: () => [],
		};
		const treeView = vscode.window.createTreeView('ribix.nativeFindings', {
			treeDataProvider: placeholder,
			showCollapseAll: true,
		});
		this.disposables.push(treeView);
		context.subscriptions.push(treeView);
	}

	/**
	 * Registers gutter icon decorations for affected lines.
	 *
	 * Port from: ribix-vscode/src/decorations/findingDecorationProvider.ts
	 *   - FindingDecorationProvider implements vscode.Disposable
	 *   - Creates TextEditorDecorationTypes for p0/p1, p2/p3, approved, rejected,
	 *     ai-smell, and token-cost findings.
	 *   - update(findings, visibleEditors) applies decorations per editor.
	 *   - provideHover() returns markdown with approve/reject command links.
	 *
	 * Asset dependency: the following SVGs must exist in
	 *   src/vs/workbench/contrib/ribix/browser/media/
	 *     gutter-red.svg   — p0/p1
	 *     gutter-yellow.svg — p2/p3
	 *     gutter-green.svg  — approved
	 *     gutter-grey.svg   — rejected
	 *
	 * TODO: copy SVGs from ribix-vscode/media/ and port FindingDecorationProvider.
	 */
	async registerFindingDecorations(context: vscode.ExtensionContext): Promise<void> {
		// TODO: implement — port FindingDecorationProvider from:
		//   ribix-vscode/src/decorations/findingDecorationProvider.ts
		//
		// Steps:
		//   1. Copy FindingDecorationProvider into nativeFindingDecorationProvider.ts.
		//   2. Swap context.asAbsolutePath("media/...") for the IDE's equivalent
		//      path resolution (see how other media paths are handled in sidebarPane.ts).
		//   3. Replace the `Finding` type with `FindingStub` / AgentFinding.
		//   4. Expose update() so startFindingsStream() can push new findings.
		//
		// No-op stub: decorations are not shown until implemented.
		void context; // suppress unused warning until implemented
	}

	/**
	 * Registers ribix.approveFinding and ribix.rejectFinding commands.
	 *
	 * Port from: ribix-vscode/src/commands/triggerRunCommand.ts
	 *   (approve/reject handlers, lines ~80–130 in current version)
	 *
	 * The commands call PATCH /cli/findings/:id/status with
	 *   { status: 'approved' | 'rejected' }
	 * using the active auth token from ribixAuthService.ts.
	 *
	 * After updating the finding, refresh the tree and decorations.
	 *
	 * TODO: wire up ribixAuthService.ts for the Bearer token, and call
	 * treeProvider.updateFindingStatus() + decorationProvider.update() after
	 * each approve/reject.
	 */
	registerApproveRejectCommands(context: vscode.ExtensionContext): void {
		// TODO: implement approve/reject commands — port from:
		//   ribix-vscode/src/commands/triggerRunCommand.ts
		//
		// Command IDs to register (matching ribix-vscode for parity):
		//   ribix.approveFinding
		//   ribix.rejectFinding
		//   ribix.markFalsePositive   (bonus — already defined in hover provider)
		//   ribix.ignoreFinding       (bonus)

		const approveFinding = vscode.commands.registerCommand(
			'ribix.approveFinding',
			async (args: { findingId: string }) => {
				// TODO: call PATCH /cli/findings/:id/status { status: 'approved' }
				//       using auth token from ribixAuthService.ts.
				//       Then: treeProvider.updateFindingStatus(args.findingId, 'approved')
				//             decorationProvider.update(...)
				void vscode.window.showInformationMessage(
					`[NativeFindingsIntegration] approveFinding not yet implemented (id=${args.findingId}). ` +
					'Port from ribix-vscode/src/commands/triggerRunCommand.ts.'
				);
			}
		);

		const rejectFinding = vscode.commands.registerCommand(
			'ribix.rejectFinding',
			async (args: { findingId: string }) => {
				// TODO: call PATCH /cli/findings/:id/status { status: 'rejected' }
				void vscode.window.showInformationMessage(
					`[NativeFindingsIntegration] rejectFinding not yet implemented (id=${args.findingId}). ` +
					'Port from ribix-vscode/src/commands/triggerRunCommand.ts.'
				);
			}
		);

		this.disposables.push(approveFinding, rejectFinding);
		context.subscriptions.push(approveFinding, rejectFinding);
	}

	/**
	 * Opens an SSE connection to the ribix backend and pushes findings into the
	 * tree and decoration providers as events arrive.
	 *
	 * Port from: ribix-vscode/src/events/sseClient.ts
	 *   - SseClient has no VS Code dependency — copy verbatim.
	 *   - Connect to GET /cli/agent-runs/:runId/stream (or the workspace-level
	 *     stream endpoint — confirm with the ribix backend API).
	 *   - On event type 'finding_discovered': call treeProvider.setFindings() and
	 *     decorationProvider.update(findings, vscode.window.visibleTextEditors).
	 *   - On event type 'run_completed': show a notification via
	 *     AgentNotificationService (ribix-vscode/src/notifications/agentNotifications.ts).
	 *
	 * TODO: implement — copy SseClient from ribix-vscode/src/events/sseClient.ts
	 * (no VS Code dependency, pure fetch/AbortController) and call it here.
	 */
	startFindingsStream(apiUrl: string, token: string): void {
		// TODO: implement SSE stream — port SseClient from:
		//   ribix-vscode/src/events/sseClient.ts
		//
		// Wire-up sketch:
		//   this.sseClient = new SseClient({
		//     getUrl: () => `${apiUrl}/cli/findings/stream`,
		//     getAccessToken: () => Promise.resolve(token),
		//     onEvent: (event) => {
		//       if (event.type === 'finding_discovered') {
		//         const findings = [...currentFindings, event.finding];
		//         this.treeProvider?.setFindings(findings);
		//         this.decorationProvider?.update(findings, vscode.window.visibleTextEditors);
		//       }
		//       if (event.type === 'run_completed') {
		//         notificationService.onRunCompleted({ runId: event.runId, findingsCount: event.count });
		//       }
		//     },
		//   });
		//   this.sseClient.connect();
		console.log(
			`[NativeFindingsIntegration] startFindingsStream called (apiUrl=${apiUrl}) — not yet implemented. ` +
			'Port SseClient from ribix-vscode/src/events/sseClient.ts.'
		);
		void token; // suppress unused warning
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

	/** Disposes all registrations and the SSE connection. */
	dispose(): void {
		// this.sseClient?.disconnect();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}
}
