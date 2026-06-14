/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixBrowserAgent.ts
 *
 * The browser agent ("acts like a real user") drives a locally-running dev server the way
 * a person would — navigating, clicking through the main flows, and watching for the app
 * falling over: runtime errors, broken UI states, infinite spinners, console errors,
 * failed network requests, and mobile layout breaks.
 *
 * Architecture note: Playwright only runs in electron-main (it is a Node.js dependency),
 * so this renderer-side agent does not drive Playwright directly. It speaks to the
 * existing `void-channel-ribixBrowser` IPC channel (see electron-main/ribixBrowserChannel.ts),
 * which owns the headless Chromium instance and exposes navigate/click/type/scroll/getHtml,
 * plus a `diagnostics` command that drains console errors, uncaught page errors, and failed
 * network requests captured since the last drain.
 *
 * Findings emitted use the shared AgentFinding shape and these finding types:
 *  - 'data-loss-risk'   — a destructive/data-bearing flow left the app in a broken state
 *  - 'rate-limit-blind' — repeated 429s with no backoff/visible handling
 *  - (runtime bugs)     — runtime errors, console errors, infinite spinners, layout breaks
 *
 * Registered as agent type 'browser' (see ribixTypes.ts / ribixAgentLoopTypes.ts).
 */

import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { AgentFinding, AgentFindingType, RiskLevel } from '../common/ribixTypes.js';

// ---------------------------------------------------------------------------
// Channel contract (mirrors electron-main/ribixBrowserChannel.ts)
// ---------------------------------------------------------------------------

interface CapturedConsole { type: string; text: string }
interface CapturedNetworkFailure { url: string; status: number | null; failure: string | null }
interface BrowserDiagnostics {
	consoleMessages: CapturedConsole[];
	pageErrors: string[];
	networkFailures: CapturedNetworkFailure[];
}

/** Minimal view of the IPC channel the browser agent depends on. Kept narrow for testing. */
export interface IRibixBrowserChannel {
	call<T>(command: 'navigate', params: { url: string; width?: number; height?: number }): Promise<{ screenshotPath: string; title: string; url: string }>;
	call<T>(command: 'click', params: { selector: string }): Promise<{ screenshotPath: string }>;
	call<T>(command: 'type', params: { selector: string; text: string }): Promise<{ screenshotPath: string }>;
	call<T>(command: 'scroll', params: { direction: string; amount?: number }): Promise<{ screenshotPath: string }>;
	call<T>(command: 'getHtml', params: { selector?: string }): Promise<{ html: string }>;
	call<T>(command: 'diagnostics', params: {}): Promise<BrowserDiagnostics>;
	call<T>(command: 'close', params: {}): Promise<{}>;
	call<T>(command: string, params: any): Promise<any>;
}

// ---------------------------------------------------------------------------
// A single user flow the agent walks
// ---------------------------------------------------------------------------

/** One step in a scripted user flow. The agent applies steps in order, draining diagnostics after each. */
export type FlowStep =
	| { kind: 'navigate'; path: string }
	| { kind: 'click'; selector: string; label: string }
	| { kind: 'type'; selector: string; text: string; label: string }
	| { kind: 'scroll'; direction: 'up' | 'down'; label: string }
	| { kind: 'wait'; ms: number; label: string };

/** A named flow (e.g. "Sign up", "Create project"). */
export interface UserFlow {
	name: string;
	steps: FlowStep[];
}

export interface BrowserAgentRunOptions {
	/** Base dev-server URL, e.g. http://localhost:3000 */
	baseUrl: string;
	/** Flows to walk. If omitted, the agent runs a default smoke flow (load root + scroll). */
	flows?: UserFlow[];
	/** Viewport widths to test for mobile layout breaks. Defaults to [375, 1280]. */
	viewports?: number[];
	/** Spinner that stays visible longer than this (ms) after a step is treated as an infinite spinner. */
	spinnerStuckMs?: number;
}

export interface BrowserAgentResult {
	findings: AgentFinding[];
	stepsRun: number;
	flowsRun: number;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the browser agent when it is driven through the model loop. The
 * deterministic detectors below cover the mechanical signals (console/network/spinner/
 * layout); the prompt is used when a model is asked to reason about screenshots/DOM and
 * decide the next interaction or judge whether a UI state is "broken".
 */
export const BROWSER_AGENT_PROMPT = `You are the Ribix Browser agent. You drive a running web app the way a real user would and report every place the app breaks under real use.

You are NOT reviewing source code or visual polish. You are exercising the running application and watching for failure.

## What you have
- A headless browser pointed at a local dev server.
- Tools: browser_navigate, browser_click, browser_type, browser_scroll, browser_get_html, plus diagnostics (console errors, uncaught page errors, failed network requests) captured since your last check.
- A list of the app's main user flows. Walk each one end to end.

## What to detect
1. Runtime errors — uncaught exceptions / page errors thrown while interacting. (bug)
2. Console errors — error-level console output during a flow. (bug)
3. Failed network requests — 4xx/5xx responses or requests that never resolve. (bug)
4. Infinite spinners — a loading indicator that never resolves into content within a reasonable wait. (bug)
5. Broken UI states — a flow that dead-ends, a blank screen after an action, a form that cannot be submitted, an error toast with no recovery path. (bug)
6. Mobile layout breaks — horizontal overflow, overlapping or clipped elements, or controls that become unreachable at a 375px viewport. (bug)
7. Data-loss risk — a destructive or data-bearing action (delete, save, submit) that fails silently or leaves the app inconsistent. Tag [data-loss-risk].
8. Rate-limit blindness — repeated requests that hit 429 with no visible backoff, retry, or user-facing message. Tag [rate-limit-blind].

## How to run
For each flow: navigate to the entry point, then perform each step. After every step, check diagnostics and the rendered DOM. The moment a step produces a runtime error, a failed request, a stuck spinner, or a dead-end, file a finding — do not keep clicking past a broken state as if it worked.

Re-run the most important flow at a 375px-wide viewport to catch mobile layout breaks.

## Severity
- high: the user is blocked — the flow cannot complete, data is lost, or the page is unusable.
- medium: the flow completes but with errors in the console/network, or visible degradation.
- low: minor breakage the user might not notice.

## Output
Emit findings as a fenced JSON array:
\`\`\`json
[{"severity":"high","file":"<flow step or route>","line":null,"message":"<what broke, what you did, what you observed>","findingType":"data-loss-risk"}]
\`\`\`
Ground every finding in a specific step and an observed signal (the error text, the request URL+status, the screenshot state). Do not file vague "UX could be better" entries.`;

// ---------------------------------------------------------------------------
// Detection helpers (pure — unit-testable without a real browser)
// ---------------------------------------------------------------------------

/** Console message types treated as errors. */
const CONSOLE_ERROR_TYPES = new Set(['error', 'assert']);

/** Heuristic selectors/markers that indicate a loading spinner is present in the DOM. */
const SPINNER_MARKERS = ['role="progressbar"', 'aria-busy="true"', 'class="spinner', 'class="loading', 'data-loading="true"'];

function severityForStatus(status: number | null): RiskLevel {
	if (status === null) { return 'high'; }       // request never resolved
	if (status >= 500) { return 'high'; }
	if (status === 429) { return 'medium'; }
	return 'medium';                                // other 4xx
}

/** Builds findings from a drained diagnostics payload observed at a given flow step. */
export function findingsFromDiagnostics(diagnostics: BrowserDiagnostics, where: string): AgentFinding[] {
	const findings: AgentFinding[] = [];

	for (const err of diagnostics.pageErrors) {
		findings.push({
			severity: 'high',
			file: where,
			line: null,
			message: `Runtime error during "${where}": ${err}`,
			findingType: 'data-loss-risk',
		});
	}

	for (const msg of diagnostics.consoleMessages) {
		if (CONSOLE_ERROR_TYPES.has(msg.type)) {
			findings.push({
				severity: 'medium',
				file: where,
				line: null,
				message: `Console error during "${where}": ${msg.text}`,
				findingType: 'observability-gap',
			});
		}
	}

	// Rate-limit blindness: 2+ 429s in the same step with no other handling signal.
	const rateLimited = diagnostics.networkFailures.filter(f => f.status === 429);
	if (rateLimited.length >= 2) {
		findings.push({
			severity: 'medium',
			file: where,
			line: null,
			message: `Rate-limit blindness during "${where}": ${rateLimited.length} requests returned 429 with no visible backoff (e.g. ${rateLimited[0].url}).`,
			findingType: 'rate-limit-blind',
		});
	}

	for (const fail of diagnostics.networkFailures) {
		if (fail.status === 429) { continue; } // already summarized above
		const detail = fail.status !== null ? `status ${fail.status}` : `request failed${fail.failure ? ` (${fail.failure})` : ''}`;
		findings.push({
			severity: severityForStatus(fail.status),
			file: where,
			line: null,
			message: `Failed network request during "${where}": ${fail.url} — ${detail}.`,
			findingType: 'third-party-resilience',
		});
	}

	return findings;
}

/** True when the rendered HTML still shows a loading indicator (used for the infinite-spinner check). */
export function htmlShowsSpinner(html: string): boolean {
	const lower = html.toLowerCase();
	return SPINNER_MARKERS.some(marker => lower.includes(marker.toLowerCase()));
}

/**
 * Heuristic mobile-layout-break detection from rendered HTML at a narrow viewport. We look
 * for inline fixed pixel widths wider than the viewport and known horizontal-overflow markers.
 * This is intentionally conservative — it only flags strong signals.
 */
export function findingsFromMobileHtml(html: string, viewportWidth: number, where: string): AgentFinding[] {
	const findings: AgentFinding[] = [];
	const widthMatches = [...html.matchAll(/(?:min-)?width\s*:\s*(\d{3,5})px/gi)];
	for (const m of widthMatches) {
		const px = Number(m[1]);
		if (px > viewportWidth + 32) {
			findings.push({
				severity: 'medium',
				file: where,
				line: null,
				message: `Mobile layout break at ${viewportWidth}px during "${where}": element declares a fixed ${px}px width, wider than the viewport — causes horizontal overflow.`,
				findingType: 'copy-consistency',
			});
			break; // one representative finding per step is enough
		}
	}
	return findings;
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORTS = [375, 1280];
const DEFAULT_SPINNER_STUCK_MS = 8000;

export class RibixBrowserAgent {
	private readonly channel: IRibixBrowserChannel;

	/**
	 * @param channel  Pass a channel directly (tests), or omit and pass mainProcessService to
	 *                 resolve the real `void-channel-ribixBrowser` electron-main channel.
	 */
	constructor(channelOrMainProcess: IRibixBrowserChannel | IMainProcessService) {
		if ('getChannel' in channelOrMainProcess && typeof (channelOrMainProcess as IMainProcessService).getChannel === 'function') {
			this.channel = (channelOrMainProcess as IMainProcessService).getChannel('void-channel-ribixBrowser') as unknown as IRibixBrowserChannel;
		} else {
			this.channel = channelOrMainProcess as IRibixBrowserChannel;
		}
	}

	/** Default smoke flow when the caller does not supply flows: load root, scroll, observe. */
	private defaultFlows(): UserFlow[] {
		return [{
			name: 'Smoke: load app root',
			steps: [
				{ kind: 'navigate', path: '/' },
				{ kind: 'wait', ms: 1500, label: 'initial load' },
				{ kind: 'scroll', direction: 'down', label: 'scroll main view' },
			],
		}];
	}

	/**
	 * Walks the supplied (or default) flows against the running app, draining runtime
	 * diagnostics after each step and an infinite-spinner / mobile-layout check at flow end.
	 * Always closes the browser when finished. Never throws on a per-step failure — a
	 * navigation/click error is itself recorded as a finding.
	 */
	async run(options: BrowserAgentRunOptions): Promise<BrowserAgentResult> {
		const baseUrl = options.baseUrl.replace(/\/$/, '');
		const flows = options.flows && options.flows.length > 0 ? options.flows : this.defaultFlows();
		const viewports = options.viewports && options.viewports.length > 0 ? options.viewports : DEFAULT_VIEWPORTS;
		const spinnerStuckMs = options.spinnerStuckMs ?? DEFAULT_SPINNER_STUCK_MS;

		const findings: AgentFinding[] = [];
		let stepsRun = 0;

		try {
			for (const flow of flows) {
				for (const viewport of viewports) {
					await this.walkFlow(baseUrl, flow, viewport, spinnerStuckMs, findings, () => { stepsRun++; });
				}
			}
		} finally {
			await this.channel.call('close', {}).catch(() => { /* best-effort */ });
		}

		return { findings, stepsRun, flowsRun: flows.length };
	}

	private async walkFlow(
		baseUrl: string,
		flow: UserFlow,
		viewport: number,
		spinnerStuckMs: number,
		findings: AgentFinding[],
		onStep: () => void,
	): Promise<void> {
		const flowLabel = viewport <= 480 ? `${flow.name} @${viewport}px (mobile)` : flow.name;

		for (const step of flow.steps) {
			const where = `${flowLabel} › ${this.stepLabel(step)}`;
			try {
				await this.applyStep(baseUrl, step, viewport);
			} catch (e) {
				// A step that throws (selector missing, navigation failed, dead-end) is a broken UI state.
				findings.push({
					severity: 'high',
					file: where,
					line: null,
					message: `Broken flow during "${where}": ${e instanceof Error ? e.message : String(e)}. The user cannot continue this flow.`,
					findingType: 'data-loss-risk',
				});
				onStep();
				break; // stop walking past a broken state
			}

			// Drain runtime signals produced by this step.
			const diagnostics = await this.channel.call('diagnostics', {}).catch((): BrowserDiagnostics => ({ consoleMessages: [], pageErrors: [], networkFailures: [] }));
			findings.push(...findingsFromDiagnostics(diagnostics, where));
			onStep();
		}

		// End-of-flow infinite-spinner check: wait, then confirm the spinner cleared.
		await this.checkInfiniteSpinner(flowLabel, spinnerStuckMs, findings);

		// Mobile layout-break check at narrow viewports.
		if (viewport <= 480) {
			const { html } = await this.channel.call('getHtml', {}).catch(() => ({ html: '' }));
			findings.push(...findingsFromMobileHtml(html, viewport, flowLabel));
		}
	}

	private async checkInfiniteSpinner(flowLabel: string, spinnerStuckMs: number, findings: AgentFinding[]): Promise<void> {
		const first = await this.channel.call('getHtml', {}).catch(() => ({ html: '' }));
		if (!htmlShowsSpinner(first.html)) { return; }
		// Spinner present — wait then re-check. If still spinning, it never resolved.
		await this.delay(spinnerStuckMs);
		const second = await this.channel.call('getHtml', {}).catch(() => ({ html: '' }));
		if (htmlShowsSpinner(second.html)) {
			findings.push({
				severity: 'high',
				file: flowLabel,
				line: null,
				message: `Infinite spinner in "${flowLabel}": a loading indicator was still present after ${spinnerStuckMs}ms and never resolved into content.`,
				findingType: 'data-loss-risk',
			});
		}
	}

	private async applyStep(baseUrl: string, step: FlowStep, viewport: number): Promise<void> {
		switch (step.kind) {
			case 'navigate':
				await this.channel.call('navigate', { url: `${baseUrl}${step.path.startsWith('/') ? '' : '/'}${step.path}`, width: viewport, height: 720 });
				return;
			case 'click':
				await this.channel.call('click', { selector: step.selector });
				return;
			case 'type':
				await this.channel.call('type', { selector: step.selector, text: step.text });
				return;
			case 'scroll':
				await this.channel.call('scroll', { direction: step.direction });
				return;
			case 'wait':
				await this.delay(step.ms);
				return;
		}
	}

	private stepLabel(step: FlowStep): string {
		switch (step.kind) {
			case 'navigate': return `navigate ${step.path}`;
			case 'click': return `click ${step.label}`;
			case 'type': return `type ${step.label}`;
			case 'scroll': return `scroll ${step.label}`;
			case 'wait': return step.label;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/** Re-export for callers that want to classify browser findings without importing ribixTypes directly. */
export const BROWSER_AGENT_FINDING_TYPES: AgentFindingType[] = ['data-loss-risk', 'rate-limit-blind', 'third-party-resilience', 'observability-gap'];
