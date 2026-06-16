/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface MissionOutcome {
	missionId: string;
	status: 'success' | 'partial' | 'failed' | 'user_cancelled';
	agentCount: number;
	findingsCount: number;
	durationMs: number;
	tokenCount?: number;
}

export class MissionTelemetryService {
	private outcomes: MissionOutcome[] = [];

	record(outcome: MissionOutcome): void {
		this.outcomes.push(outcome);
	}

	/**
	 * Returns the fraction of missions that completed with status 'success',
	 * in the range [0, 1]. Returns 0 when no missions have been recorded.
	 */
	getSuccessRate(): number {
		if (this.outcomes.length === 0) {
			return 0;
		}
		const successes = this.outcomes.filter(o => o.status === 'success').length;
		return successes / this.outcomes.length;
	}

	getSummary(): { total: number; success: number; failed: number; successRate: string } {
		const total = this.outcomes.length;
		const success = this.outcomes.filter(o => o.status === 'success').length;
		const failed = this.outcomes.filter(
			o => o.status === 'failed' || o.status === 'user_cancelled',
		).length;
		const rate = this.getSuccessRate();
		const successRate = `${(rate * 100).toFixed(1)}%`;
		return { total, success, failed, successRate };
	}

	/**
	 * Appends all recorded outcomes to a JSONL file at `storageUri` for offline
	 * inspection. Each line is a JSON-encoded MissionOutcome followed by a newline.
	 * The file is created if it does not yet exist.
	 */
	async persist(storageUri: vscode.Uri): Promise<void> {
		const lines = this.outcomes.map(o => JSON.stringify(o)).join('\n') + '\n';
		const encoder = new TextEncoder();
		const data = encoder.encode(lines);

		// Append to any existing content.
		let existing = new Uint8Array(0);
		try {
			existing = await vscode.workspace.fs.readFile(storageUri);
		} catch {
			// File doesn't exist yet — start fresh.
		}

		const merged = new Uint8Array(existing.length + data.length);
		merged.set(existing, 0);
		merged.set(data, existing.length);

		await vscode.workspace.fs.writeFile(storageUri, merged);
	}
}

/** Module-level singleton — import and use directly from any service or agent. */
export const missionTelemetry = new MissionTelemetryService();

// ---------------------------------------------------------------------------
// TODO (ribixMissionsPanel.tsx): Render mission success rate in the Ribix panel.
//
// Example placement — add near the top of the missions list header or in a
// dedicated stats row:
//
//   import { missionTelemetry } from '../missionTelemetry.js';
//
//   const summary = missionTelemetry.getSummary();
//   // Render: `Missions: ${summary.total} total · ${summary.successRate} success rate`
//
// ---------------------------------------------------------------------------
