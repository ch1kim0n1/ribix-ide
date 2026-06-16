/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type AgentStage =
	| 'planning'
	| 'reading'
	| 'writing'
	| 'testing'
	| 'verifying'
	| 'complete'
	| 'error';

export interface AgentProgressEvent {
	agentId: string;
	agentRole: 'Planner' | 'Coder' | 'Tester' | 'Debugger' | 'Reviewer' | 'Docs' | 'Release';
	stage: AgentStage;
	message: string;
	timestamp: number;
	/** Paths of files read or written during this stage transition. */
	filesAffected?: string[];
}

/**
 * In-memory event bus for real-time agent progress updates.
 *
 * Usage:
 *   // Emitting (from a service):
 *   agentProgressFeed.emit({ agentId, agentRole: 'Coder', stage: 'writing', message: 'Editing foo.ts', timestamp: Date.now(), filesAffected: ['src/foo.ts'] });
 *
 *   // Subscribing (from a React component):
 *   useEffect(() => {
 *     return agentProgressFeed.onProgress(event => setEvents(prev => [...prev, event]));
 *   }, []);
 */
export class AgentProgressFeed {
	private events: AgentProgressEvent[] = [];
	private readonly listeners = new Set<(e: AgentProgressEvent) => void>();

	/**
	 * Appends the event to the internal log and notifies all subscribers
	 * synchronously on the same tick.
	 */
	emit(event: AgentProgressEvent): void {
		this.events.push(event);
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (e) {
				console.warn('AgentProgressFeed: listener threw', e);
			}
		}
	}

	/**
	 * Registers a progress listener. Returns an unsubscribe function — call it
	 * (e.g. from a React `useEffect` cleanup) to stop receiving events.
	 */
	onProgress(cb: (e: AgentProgressEvent) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/**
	 * Returns all events whose `agentId` matches the given mission ID prefix.
	 *
	 * Convention: agent IDs are formatted as `<missionId>:<agentRole>` so that
	 * `getEventsForMission(missionId)` returns all events for that mission.
	 */
	getEventsForMission(missionId: string): AgentProgressEvent[] {
		return this.events.filter(e => e.agentId.startsWith(missionId));
	}

	/** Clears the in-memory event log. Does not affect active listeners. */
	clear(): void {
		this.events = [];
	}
}

/** Module-level singleton — import and call `agentProgressFeed.emit()` from any agent. */
export const agentProgressFeed = new AgentProgressFeed();

// ---------------------------------------------------------------------------
// Wire-up TODOs
// ---------------------------------------------------------------------------
//
// TODO (ribixMissionService.ts — submitForPlanning):
//   agentProgressFeed.emit({ agentId: `${id}:Planner`, agentRole: 'Planner', stage: 'planning', message: 'Generating mission plan…', timestamp: Date.now() });
//
// TODO (ribixMissionService.ts — approvePlan):
//   agentProgressFeed.emit({ agentId: `${id}:Planner`, agentRole: 'Planner', stage: 'complete', message: 'Plan approved — starting execution', timestamp: Date.now() });
//
// TODO (ribixOrchestrationService.ts — per-agent stage transitions):
//   Emit at each stage change for the active agent, e.g.:
//   agentProgressFeed.emit({ agentId: `${missionId}:${agentRole}`, agentRole, stage: 'reading', message: `Reading ${filePath}`, timestamp: Date.now(), filesAffected: [filePath] });
//   agentProgressFeed.emit({ agentId: `${missionId}:${agentRole}`, agentRole, stage: 'writing', message: `Writing ${filePath}`, timestamp: Date.now(), filesAffected: [filePath] });
//
// TODO (ribixMissionService.ts — completeMission):
//   agentProgressFeed.emit({ agentId: `${id}:Release`, agentRole: 'Release', stage: 'complete', message: `Mission complete — ${findings} finding(s)`, timestamp: Date.now() });
//
// TODO (ribixMissionService.ts — abortMission / on error):
//   agentProgressFeed.emit({ agentId: `${id}:Planner`, agentRole: 'Planner', stage: 'error', message: `Mission aborted`, timestamp: Date.now() });
//
// ---------------------------------------------------------------------------
// TODO (ribixAgentActivityFeed.tsx or ribixCommandCenter.tsx — mission panel UI):
//   Import and subscribe to the progress feed to display a scrolling activity log:
//
//   import { agentProgressFeed, AgentProgressEvent } from '../agentProgressFeed.js';
//
//   const [events, setEvents] = useState<AgentProgressEvent[]>([]);
//   useEffect(() => {
//     // Replay any events already in the feed for the active mission.
//     if (activeMissionId) {
//       setEvents(agentProgressFeed.getEventsForMission(activeMissionId));
//     }
//     return agentProgressFeed.onProgress(e => {
//       if (!activeMissionId || e.agentId.startsWith(activeMissionId)) {
//         setEvents(prev => [...prev, e]);
//       }
//     });
//   }, [activeMissionId]);
//
//   // Render a scrolling log, newest at bottom:
//   // <div className="overflow-y-auto max-h-48 space-y-1">
//   //   {events.map((e, i) => (
//   //     <div key={i} className="text-xs font-mono">[{e.agentRole}] {e.stage}: {e.message}</div>
//   //   ))}
//   // </div>
// ---------------------------------------------------------------------------
