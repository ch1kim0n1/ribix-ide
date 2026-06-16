/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Mission Replay Panel
 *
 * A VS Code WebviewPanel that lets engineers scrub through a saved mission recording.
 *
 * Features:
 *   - Timeline scrubber (0–100 % of mission duration)
 *   - Scrollable event feed: timestamp, agent role icon, event type, data summary
 *   - Clicking file_read / file_write events opens the affected file in the editor
 *   - Agent role transitions are color-coded
 *   - Auto-play at 10× speed with pause/resume button
 */

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ReplayEvent, MissionReplayer } from './missionReplay.js';

// ---------- Role color map ----------

/** CSS color for each agent role label.  Extend as new roles are added. */
const ROLE_COLOR: Record<string, string> = {
	planner: '#4da6ff',   // blue
	coder: '#4dff88',     // green
	tester: '#ff9a3c',    // orange
	debugger: '#ff4d4d',  // red
	reviewer: '#cc88ff',  // purple
	docs: '#ffdd57',      // yellow
	release: '#57d7ff',   // cyan
};

function roleColor(role: string): string {
	return ROLE_COLOR[role.toLowerCase()] ?? '#aaaaaa';
}

/** Single Unicode icon for each role (no image assets required). */
const ROLE_ICON: Record<string, string> = {
	planner: '🗺',
	coder: '💻',
	tester: '🧪',
	debugger: '🔍',
	reviewer: '🔎',
	docs: '📝',
	release: '🚀',
};

function roleIcon(role: string): string {
	return ROLE_ICON[role.toLowerCase()] ?? '🤖';
}

// ---------- HTML generation ----------

function buildHtml(events: ReplayEvent[], nonce: string): string {
	const totalMs = events.length > 1
		? events[events.length - 1].timestamp - events[0].timestamp
		: 0;
	const origin = events.length > 0 ? events[0].timestamp : 0;

	function pct(ts: number): number {
		if (totalMs === 0) { return 0; }
		return Math.round(((ts - origin) / totalMs) * 1000) / 10;
	}

	function fmt(ts: number): string {
		const rel = ts - origin;
		const s = Math.floor(rel / 1000);
		const ms = rel % 1000;
		return `+${s}.${String(ms).padStart(3, '0')}s`;
	}

	function dataSummary(e: ReplayEvent): string {
		const d = e.data;
		if (e.type === 'file_read' || e.type === 'file_write') {
			return `<code class="filepath" data-path="${escHtml(String(d.filePath ?? ''))}">${escHtml(String(d.filePath ?? ''))}</code>`;
		}
		if (e.type === 'tool_call') {
			return `<span class="dim">${escHtml(String(d.toolName ?? ''))}</span>`;
		}
		if (e.type === 'llm_call') {
			const tokens = d.inputTokens ? `${d.inputTokens} in / ${d.outputTokens ?? '?'} out` : '';
			return `<span class="dim">${escHtml(String(d.model ?? ''))}</span>${tokens ? ` <span class="badge">${escHtml(tokens)}</span>` : ''}`;
		}
		if (e.type === 'finding_created') {
			return `<span class="dim">${escHtml(String(d.message ?? ''))}</span>`;
		}
		if (e.type === 'agent_stage_change') {
			return `<span class="dim">${escHtml(String(d.from ?? '?'))} → ${escHtml(String(d.to ?? '?'))}</span>`;
		}
		// Generic fallback: show first meaningful key=value pair
		const keys = Object.keys(d).slice(0, 2);
		return keys.map(k => `<span class="dim">${escHtml(k)}=${escHtml(String(d[k]))}</span>`).join(' ');
	}

	function escHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	const rows = events.map((e, i) => {
		const color = roleColor(e.agentRole);
		const icon = roleIcon(e.agentRole);
		const isFile = e.type === 'file_read' || e.type === 'file_write';
		return `<tr class="event-row${isFile ? ' clickable-file' : ''}" data-idx="${i}" data-pct="${pct(e.timestamp)}" data-path="${escHtml(String(e.data.filePath ?? ''))}">
      <td class="ts">${escHtml(fmt(e.timestamp))}</td>
      <td class="role" style="color:${color}">${escHtml(icon)} ${escHtml(e.agentRole)}</td>
      <td class="etype">${escHtml(e.type)}</td>
      <td class="summary">${dataSummary(e)}</td>
    </tr>`;
	}).join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, monospace); font-size: 12px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 12px; }
  h2 { font-size: 14px; margin-bottom: 10px; opacity: 0.85; }
  #controls { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  #scrubber { flex: 1; accent-color: var(--vscode-focusBorder); }
  #pct-label { min-width: 40px; text-align: right; opacity: 0.6; font-size: 11px; }
  #play-btn { padding: 3px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  #play-btn:hover { background: var(--vscode-button-hoverBackground); }
  #event-table { width: 100%; border-collapse: collapse; }
  #event-table th { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); opacity: 0.6; font-size: 11px; }
  .event-row td { padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border, #333); vertical-align: top; }
  .event-row:hover { background: var(--vscode-list-hoverBackground); }
  .event-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .clickable-file { cursor: pointer; }
  .ts { font-family: monospace; opacity: 0.55; white-space: nowrap; }
  .role { white-space: nowrap; font-weight: 600; }
  .etype { opacity: 0.8; white-space: nowrap; }
  .summary { word-break: break-all; }
  .dim { opacity: 0.65; }
  code.filepath { font-family: monospace; opacity: 0.9; text-decoration: underline; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 1px 6px; font-size: 10px; }
  #feed-wrap { max-height: calc(100vh - 120px); overflow-y: auto; }
</style>
</head>
<body>
<h2>Mission Replay</h2>
<div id="controls">
  <button id="play-btn">▶ Play (10×)</button>
  <input id="scrubber" type="range" min="0" max="100" step="0.1" value="0">
  <span id="pct-label">0%</span>
</div>
<div id="feed-wrap">
<table id="event-table">
  <thead><tr><th>Time</th><th>Agent</th><th>Event</th><th>Detail</th></tr></thead>
  <tbody id="event-body">
${rows}
  </tbody>
</table>
</div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const rows = Array.from(document.querySelectorAll('.event-row'));
  const scrubber = document.getElementById('scrubber');
  const pctLabel = document.getElementById('pct-label');
  const playBtn = document.getElementById('play-btn');

  let currentPct = 0;
  let playing = false;
  let rafId = null;
  // Store real event percentages as numbers
  const pcts = rows.map(r => parseFloat(r.dataset.pct || '0'));

  function applyPct(pct) {
    currentPct = Math.max(0, Math.min(100, pct));
    scrubber.value = currentPct;
    pctLabel.textContent = currentPct.toFixed(1) + '%';
    // Highlight events up to currentPct
    let lastActive = -1;
    rows.forEach((r, i) => {
      if (pcts[i] <= currentPct) { r.classList.add('active'); lastActive = i; }
      else { r.classList.remove('active'); }
    });
    // Scroll active row into view
    if (lastActive >= 0) {
      rows[lastActive].scrollIntoView({ block: 'nearest' });
    }
  }

  // Playback at ~60 fps, advancing 10× real speed (totalMs / 10 per second of wall time)
  const TOTAL_MS = ${totalMs};
  let playStartWall = 0;
  let playStartPct = 0;

  function tick(now) {
    if (!playing) { return; }
    const wallElapsed = now - playStartWall;
    // 10× speed: 1 s of wall time = 10 s of mission time
    const missionElapsed = wallElapsed * 10;
    const pct = TOTAL_MS > 0 ? playStartPct + (missionElapsed / TOTAL_MS) * 100 : 100;
    applyPct(pct);
    if (currentPct < 100) {
      rafId = requestAnimationFrame(tick);
    } else {
      playing = false;
      playBtn.textContent = '▶ Play (10×)';
    }
  }

  playBtn.addEventListener('click', () => {
    if (playing) {
      playing = false;
      cancelAnimationFrame(rafId);
      playBtn.textContent = '▶ Play (10×)';
    } else {
      if (currentPct >= 100) { applyPct(0); }
      playing = true;
      playStartWall = performance.now();
      playStartPct = currentPct;
      playBtn.textContent = '⏸ Pause';
      rafId = requestAnimationFrame(tick);
    }
  });

  scrubber.addEventListener('input', () => {
    if (playing) {
      playing = false;
      cancelAnimationFrame(rafId);
      playBtn.textContent = '▶ Play (10×)';
    }
    applyPct(parseFloat(scrubber.value));
  });

  // Click on file_read / file_write rows to open the file
  document.getElementById('event-body').addEventListener('click', (evt) => {
    const row = evt.target.closest('.clickable-file');
    if (!row) { return; }
    const path = row.dataset.path;
    if (path) { vscode.postMessage({ type: 'openFile', path }); }
  });
})();
</script>
</body>
</html>`;
}

// ---------- MissionReplayPanel ----------

/** Nonce for CSP. */
function makeNonce(): string {
	const arr = new Uint8Array(16);
	crypto.getRandomValues(arr);
	return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Opens (or re-uses) a VS Code WebviewPanel showing the mission replay UI.
 *
 * @param context     ExtensionContext — provides globalStorageUri and webview resource roots.
 * @param missionId   The mission whose `.replay.jsonl` recording to load.
 * @param openerService  Injected to open files in the editor when the user clicks an event.
 */
export class MissionReplayPanel extends Disposable {
	private static panels = new Map<string, MissionReplayPanel>();

	private readonly panel: import('vscode').WebviewPanel;

	private constructor(
		missionId: string,
		events: ReplayEvent[],
		private readonly openerService: IOpenerService,
	) {
		super();

		// Dynamic import: vscode is only available inside extension hosts /
		// the renderer process — not at module evaluation time.
		const vscode = (globalThis as any).vscode ?? (() => { throw new Error('vscode not in scope'); })();

		this.panel = vscode.window.createWebviewPanel(
			'ribixMissionReplay',
			`Replay: ${missionId.substring(0, 8)}`,
			vscode.ViewColumn.Two,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);

		const nonce = makeNonce();
		this.panel.webview.html = buildHtml(events, nonce);

		this._register(this.panel.webview.onDidReceiveMessage(msg => {
			if (msg.type === 'openFile' && typeof msg.path === 'string' && msg.path) {
				const fileUri = URI.file(msg.path);
				this.openerService.open(fileUri).catch(() => { /* best-effort */ });
			}
		}));

		this._register(this.panel.onDidDispose(() => {
			MissionReplayPanel.panels.delete(missionId);
			this.dispose();
		}));

		MissionReplayPanel.panels.set(missionId, this);
	}

	/**
	 * Opens the replay panel for a mission, loading events from globalStorageUri.
	 * Reveals an existing panel rather than opening a duplicate.
	 */
	static async open(
		storageUri: URI,
		missionId: string,
		openerService: IOpenerService,
	): Promise<void> {
		const existing = MissionReplayPanel.panels.get(missionId);
		if (existing) {
			existing.panel.reveal();
			return;
		}

		const replayer = new MissionReplayer();
		const events = await replayer.load(storageUri, missionId);
		new MissionReplayPanel(missionId, events, openerService);
	}
}
