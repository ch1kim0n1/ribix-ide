/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';

// ---------- Types ----------

export type ReplayEventType =
	| 'file_read'
	| 'file_write'
	| 'tool_call'
	| 'llm_call'
	| 'test_run'
	| 'finding_created'
	| 'agent_stage_change'
	| 'mission_start'
	| 'mission_complete';

export interface ReplayEvent {
	id: string;
	missionId: string;
	agentId: string;
	agentRole: string;
	type: ReplayEventType;
	timestamp: number;
	durationMs?: number;
	/** Payload — file path, content snippet, tool name, result, etc. */
	data: Record<string, unknown>;
}

// ---------- MissionRecorder ----------

/**
 * Accumulates ReplayEvents during a mission run and persists them to
 * globalStorageUri as `<missionId>.replay.jsonl` (one JSON object per line).
 *
 * Wire-up: see the TODO block at the bottom of this file.
 */
export class MissionRecorder {
	private readonly events: ReplayEvent[] = [];
	private readonly missionId: string;

	constructor(missionId: string) {
		this.missionId = missionId;
	}

	/**
	 * Append a new event to the in-memory log. Automatically assigns a UUID and
	 * the current wall-clock timestamp.
	 */
	record(event: Omit<ReplayEvent, 'id' | 'missionId' | 'timestamp'>): void {
		this.events.push({
			id: generateUuid(),
			missionId: this.missionId,
			timestamp: Date.now(),
			...event,
		});
	}

	/** Returns a snapshot of all events recorded so far. */
	getEvents(): ReplayEvent[] {
		return [...this.events];
	}

	/**
	 * Serialises the recording to `<storageUri>/<missionId>.replay.jsonl`.
	 * Each line is a self-contained JSON object for streaming reads.
	 *
	 * @param storageUri  The extension globalStorageUri (an absolute file:// URI).
	 */
	async save(storageUri: URI): Promise<void> {
		const filePath = joinUri(storageUri, `${this.missionId}.replay.jsonl`);
		const lines = this.events.map(e => JSON.stringify(e)).join('\n');
		const bytes = new TextEncoder().encode(lines);
		await writeFileViaFetch(filePath.fsPath, bytes);
	}
}

// ---------- MissionReplayer ----------

/**
 * Loads and indexes previously saved `.replay.jsonl` recordings from
 * globalStorageUri.
 */
export class MissionReplayer {
	/**
	 * Reads `<storageUri>/<missionId>.replay.jsonl` and returns the ordered
	 * event list.
	 */
	async load(storageUri: URI, missionId: string): Promise<ReplayEvent[]> {
		const filePath = joinUri(storageUri, `${missionId}.replay.jsonl`);
		const text = await readFileText(filePath.fsPath);
		const events: ReplayEvent[] = [];
		for (const line of text.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) { continue; }
			try {
				events.push(JSON.parse(trimmed) as ReplayEvent);
			} catch {
				// Malformed line — skip.
			}
		}
		events.sort((a, b) => a.timestamp - b.timestamp);
		return events;
	}

	/**
	 * Lists all `*.replay.jsonl` files in storageUri.
	 * Returns summary metadata for display in the QuickPick without loading full event arrays.
	 */
	async listRecordings(storageUri: URI): Promise<{ missionId: string; eventCount: number; duration: number }[]> {
		const { readdir } = await import('fs/promises');
		let entries: string[];
		try {
			entries = await readdir(storageUri.fsPath);
		} catch {
			return [];
		}

		const results: { missionId: string; eventCount: number; duration: number }[] = [];
		for (const entry of entries) {
			if (!entry.endsWith('.replay.jsonl')) { continue; }
			const missionId = entry.replace(/\.replay\.jsonl$/, '');
			try {
				const events = await this.load(storageUri, missionId);
				if (events.length === 0) { continue; }
				const duration = events[events.length - 1].timestamp - events[0].timestamp;
				results.push({ missionId, eventCount: events.length, duration });
			} catch {
				// Unreadable recording — skip.
			}
		}
		return results;
	}
}

// ---------- Internal helpers ----------

/** Appends a path segment to a URI using the VS Code URI API. */
function joinUri(base: URI, segment: string): URI {
	return URI.joinPath(base, segment);
}

/**
 * Writes bytes to an absolute file path using Node's fs/promises API.
 * ribix-ide runs in a Node.js-backed Electron renderer/extension host context
 * where `fs` is available via dynamic import.
 */
async function writeFileViaFetch(fsPath: string, bytes: Uint8Array): Promise<void> {
	const { writeFile, mkdir } = await import('fs/promises');
	const { dirname } = await import('path');
	await mkdir(dirname(fsPath), { recursive: true });
	await writeFile(fsPath, bytes);
}

async function readFileText(fsPath: string): Promise<string> {
	const { readFile } = await import('fs/promises');
	const buf = await readFile(fsPath);
	return new TextDecoder().decode(buf);
}
