/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { NativeFindingsIntegration } from './nativeFindingsIntegration.js';
import * as vscode from 'vscode';

/**
 * Workbench contribution that activates IDE-native findings:
 *   - Findings tree sidebar panel ('ribix.nativeFindings')
 *   - Findings diagnostics (Problems panel)
 *   - Real approve / reject / false-positive commands
 *   - SSE stream from the ribix backend
 *
 * Starts after sign-in and restarts the stream on token refresh.
 */
class NativeFindingsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.ribix.nativeFindings';

	private readonly integration = new NativeFindingsIntegration();

	constructor(
		@IRibixAuthService private readonly authService: IRibixAuthService,
	) {
		super();

		const fakeContext = this.buildFakeContext();

		// Register sidebar tree and diagnostics provider.
		this.integration.registerFindingsSidebar(fakeContext);
		this.integration.registerFindingDecorations(fakeContext);

		// Register approve/reject commands with auth-aware config getter.
		this.integration.registerApproveRejectCommands(fakeContext, async () => {
			try {
				return await this.authService.getRequiredConfig();
			} catch {
				return null;
			}
		});

		// Start the backend SSE stream if already signed in.
		this.authService.getAuthSummary().then(summary => {
			if (summary.status === 'signed_in') {
				this.startStream();
			}
		});

		// Re-start the stream on each auth state change.
		this._register(this.authService.onDidChangeSession(summary => {
			if (summary.status === 'signed_in') {
				this.startStream();
			} else {
				this.integration.dispose();
			}
		}));

		this._register(this.integration);
	}

	private startStream(): void {
		this.authService.getRequiredConfig().then(config => {
			// Initial fetch to populate the tree before the stream delivers events.
			this.integration.syncBackendFindings(config.apiUrl, config.accessToken).then(findings => {
				(this.integration as any).treeProvider?.setFindings(findings);
			});
			this.integration.startFindingsStream(config.apiUrl, config.accessToken);
		}).catch(() => {
			// Not signed in or token expired — stream will restart on next auth change.
		});
	}

	/**
	 * Builds a minimal ExtensionContext-shaped object for API calls that require one.
	 * In the workbench context, subscriptions are managed by the contribution's
	 * Disposable registry, so this is a thin shim.
	 */
	private buildFakeContext(): vscode.ExtensionContext {
		const disposables: vscode.Disposable[] = [];
		this._register({ dispose: () => { for (const d of disposables) { d.dispose(); } } });
		return {
			subscriptions: disposables,
			// The remaining fields are not used by NativeFindingsIntegration.
		} as unknown as vscode.ExtensionContext;
	}
}

registerWorkbenchContribution2(
	NativeFindingsContribution.ID,
	NativeFindingsContribution,
	WorkbenchPhase.AfterRestored,
);
