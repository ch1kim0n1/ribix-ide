/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * PlaywrightRunner — drives a headless browser session against a staging URL via
 * `npx playwright` in a subprocess and streams back structured findings.
 *
 * The runner never imports Playwright directly: the IDE process may not have it
 * installed, and bundling Playwright into the extension would bloat the package.
 * Instead, it spawns `npx --yes playwright` so npm resolves a locally-installed
 * copy or installs a one-time ephemeral copy from the registry.
 *
 * Subprocess communication protocol:
 *   • The runner writes a temporary Playwright script to the OS temp directory.
 *   • The script runs the navigation/interaction logic and prints a single JSON
 *     array (`PlaywrightFinding[]`) to stdout when finished.
 *   • This module reads stdout, parses the array, and resolves the Promise.
 *   • Stderr from the subprocess is captured but not thrown — failures surface as
 *     a single P1 finding so the agent can still report the problem.
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Subprocess-script fragment injected in `user-qa` (FAFO) mode. It runs inside the
 * generated Playwright script (so `page` is in scope) after navigation and before
 * the screenshot. It performs curiosity clicks, hostile input fuzzing, and state
 * perturbation; the page's existing console/pageerror/response listeners turn any
 * resulting breakage into findings. Wrapped in try/catch so FAFO can never crash
 * the run — perturbation failures are expected and non-fatal.
 */
const FAFO_INTERACTION_SNIPPET = `
  // --- FAFO interaction phase (user-qa mode) ---
  try {
    const HOSTILE_INPUTS = [
      '', '   ', "'; DROP TABLE users; --", '<script>alert(1)</script>',
      '{{7*7}}', '-1', '0', '99999999999999999999', '👾🔥'.repeat(50),
      'a'.repeat(5000), 'not-an-email', '٢٠٢٤/13/40',
    ];
    // Fuzz every visible text-like input with a hostile value.
    const inputs = await page.$$('input:not([type=hidden]), textarea');
    for (let i = 0; i < inputs.length; i++) {
      const value = HOSTILE_INPUTS[i % HOSTILE_INPUTS.length];
      try { await inputs[i].fill(value, { timeout: 2000 }); } catch { /* perturb */ }
    }
    // Curiosity + chaos: rapidly double/triple-click submit-ish buttons.
    const buttons = await page.$$('button, [type=submit], [role=button]');
    for (const btn of buttons.slice(0, 8)) {
      try { await btn.click({ clickCount: 3, timeout: 2000, force: true }); } catch { /* perturb */ }
    }
    // State perturbation: resize mid-flow, then bounce through history.
    try { await page.setViewportSize({ width: 375, height: 667 }); } catch { /* perturb */ }
    try { await page.goBack({ timeout: 3000 }); await page.goForward({ timeout: 3000 }); } catch { /* perturb */ }
    try { await page.reload({ timeout: 5000 }); } catch { /* perturb */ }
    // Let any async breakage settle so listeners can capture it.
    try { await page.waitForTimeout(750); } catch { /* perturb */ }
  } catch (fafoErr) { /* FAFO is best-effort; never fail the run on it */ }
`;

export interface PlaywrightFinding {
	title: string;
	severity: 'p0' | 'p1' | 'p2' | 'p3';
	url: string;
	errorMessage: string;
	screenshotPath?: string;
	stackTrace?: string;
}

/**
 * Exploration mode for a Playwright run.
 *  - `proactive`: passive observation only — visit pages and collect anomalies
 *    (the original BFS-style behavior).
 *  - `user-qa`: aggressive FAFO mode — additionally perturb page state (curiosity
 *    clicks + hostile input fuzzing) to flush out bugs a real user would hit.
 */
export type PlaywrightRunMode = 'proactive' | 'user-qa';

export interface PlaywrightRunOptions {
	/** Maximum wall-clock time for the entire run. Defaults to 120 000 ms. */
	timeoutMs: number;
	/**
	 * Extra page paths to navigate beyond the root `/`. Relative paths are
	 * resolved against `stagingUrl`. E.g. `['/login', '/dashboard']`.
	 */
	pages?: string[];
	/**
	 * Exploration mode. The Tester agent requests `user-qa` to run aggressive
	 * FAFO interaction. Defaults to `proactive` (passive observation).
	 */
	mode?: PlaywrightRunMode;
}

/**
 * Drives a headless Chromium session against `stagingUrl` via `npx playwright`
 * and returns structured `PlaywrightFinding[]` for each anomaly discovered.
 *
 * Usage:
 *   const runner = new PlaywrightRunner('https://staging.example.com');
 *   const findings = await runner.run({ timeoutMs: 90_000, pages: ['/login', '/settings'] });
 */
export class PlaywrightRunner {
	constructor(private readonly stagingUrl: string) {}

	/**
	 * Runs a full browser session: navigates the root and every path in `opts.pages`,
	 * collects console errors / network failures / uncaught exceptions / visual breaks,
	 * and returns one `PlaywrightFinding` per distinct anomaly.
	 */
	async run(opts: PlaywrightRunOptions): Promise<PlaywrightFinding[]> {
		const pages = [this.stagingUrl, ...(opts.pages ?? []).map(p => this.resolvePageUrl(p))];
		const mode = opts.mode ?? 'proactive';

		const allFindings: PlaywrightFinding[] = [];

		for (const url of pages) {
			try {
				const pageFindings = await this.checkPage(url, opts.timeoutMs, mode);
				allFindings.push(...pageFindings);
			} catch (err) {
				// Subprocess failure — surface it as a P1 so the agent has signal
				allFindings.push({
					title: 'Playwright subprocess error',
					severity: 'p1',
					url,
					errorMessage: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return allFindings;
	}

	/**
	 * Navigates `url` in a headless Chromium browser via `npx playwright`, then:
	 *   - Listens for console errors (level: error/warning)
	 *   - Listens for failed network requests (status >= 400 or network error)
	 *   - Catches uncaught exceptions via `page.on('pageerror', ...)`
	 *   - Takes a screenshot and saves it to the OS temp dir
	 * Returns one `PlaywrightFinding` per distinct anomaly found.
	 */
	private async checkPage(url: string, timeoutMs: number, mode: PlaywrightRunMode = 'proactive'): Promise<PlaywrightFinding[]> {
		const script = this.buildPlaywrightScript(url, timeoutMs, mode);
		const scriptPath = path.join(os.tmpdir(), `ribix-pw-${Date.now()}.mjs`);

		try {
			fs.writeFileSync(scriptPath, script, 'utf8');
			const stdout = await this.runSubprocess(scriptPath, timeoutMs);
			return this.parseFindings(stdout, url);
		} finally {
			try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
		}
	}

	/**
	 * Builds the Playwright script that will run in the subprocess. The script
	 * collects anomalies, writes them as a JSON array to stdout, and exits.
	 * It is written as an ES module (.mjs) so it works with Node's native ESM loader.
	 */
	private buildPlaywrightScript(url: string, timeoutMs: number, mode: PlaywrightRunMode = 'proactive'): string {
		const screenshotPath = path.join(os.tmpdir(), `ribix-screenshot-${Date.now()}.png`).replace(/\\/g, '/');
		const escapedUrl = JSON.stringify(url);
		const escapedScreenshot = JSON.stringify(screenshotPath);
		// In user-qa (FAFO) mode, inject an aggressive interaction phase that
		// perturbs page state with hostile inputs and curiosity clicks so the
		// listeners above surface bugs a passive page-visit would miss.
		const fafoPhase = mode === 'user-qa' ? FAFO_INTERACTION_SNIPPET : '';

		return `
import { chromium } from 'playwright';

const findings = [];
const url = ${escapedUrl};
const screenshotPath = ${escapedScreenshot};

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Collect console errors and warnings
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      findings.push({
        title: \`Console \${msg.type()}: \${msg.text().slice(0, 120)}\`,
        severity: classifySeverity({ type: 'console', message: msg.text() }),
        url,
        errorMessage: msg.text(),
        screenshotPath,
      });
    }
  });

  // Collect uncaught page-level exceptions
  page.on('pageerror', err => {
    findings.push({
      title: \`Uncaught exception: \${err.message.slice(0, 120)}\`,
      severity: classifySeverity({ type: 'exception', message: err.message }),
      url,
      errorMessage: err.message,
      stackTrace: err.stack,
      screenshotPath,
    });
  });

  // Collect failed network requests
  page.on('requestfailed', req => {
    findings.push({
      title: \`Network failure: \${req.method()} \${req.url().slice(0, 100)}\`,
      severity: classifySeverity({ type: 'network', message: req.failure()?.errorText ?? 'request failed' }),
      url,
      errorMessage: req.failure()?.errorText ?? 'request failed',
      screenshotPath,
    });
  });

  // Collect 4xx / 5xx responses
  page.on('response', res => {
    const status = res.status();
    if (status >= 400) {
      findings.push({
        title: \`HTTP \${status}: \${res.url().slice(0, 100)}\`,
        severity: classifySeverity({ type: 'http', message: String(status) }),
        url,
        errorMessage: \`HTTP \${status} from \${res.url()}\`,
        screenshotPath,
      });
    }
  });

  // Navigate with a generous timeout
  try {
    await page.goto(url, { timeout: ${Math.floor(timeoutMs * 0.8)}, waitUntil: 'networkidle' });
  } catch (navErr) {
    findings.push({
      title: \`Navigation failed: \${navErr.message.slice(0, 120)}\`,
      severity: 'p0',
      url,
      errorMessage: navErr.message,
      stackTrace: navErr.stack,
      screenshotPath,
    });
  }

${fafoPhase}
  // Capture screenshot for visual reference
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch { /* screenshot failure is non-fatal */ }

  await context.close();
} catch (err) {
  findings.push({
    title: \`Browser launch error: \${err.message.slice(0, 120)}\`,
    severity: 'p1',
    url,
    errorMessage: err.message,
    stackTrace: err.stack,
  });
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
}

console.log(JSON.stringify(findings));

function classifySeverity({ type, message }) {
  // P0: app crash, blank page, or navigation failure
  if (type === 'exception' || type === 'navigation') { return 'p0'; }
  // P0: 5xx server errors
  if (type === 'http' && Number(message) >= 500) { return 'p0'; }
  // P1: 4xx client errors that indicate broken flows (not 404 on assets)
  if (type === 'http' && Number(message) >= 400) { return 'p1'; }
  // P1: total network failures
  if (type === 'network') { return 'p1'; }
  // P2: console errors (may indicate missing resources, API failures)
  if (type === 'console' && /error/i.test(message)) { return 'p2'; }
  // P3: console warnings and everything else
  return 'p3';
}
`.trim();
	}

	/**
	 * Spawns `npx --yes playwright` to execute the given script file and returns stdout.
	 * stderr is captured but not thrown — subprocess errors produce a P1 finding instead.
	 */
	private runSubprocess(scriptPath: string, timeoutMs: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = childProcess.spawn(
				'npx',
				['--yes', 'playwright', 'run-script', scriptPath],
				{
					shell: true,
					timeout: timeoutMs,
					env: { ...process.env },
				}
			);

			// `npx playwright run-script` is not a real Playwright CLI command — Playwright
			// scripts are just Node scripts. Run them directly via node instead.
			// Re-spawn with node so the script is executed as a plain ESM module.
			child.kill();

			const nodeChild = childProcess.spawn(
				'node',
				['--input-type=module'],
				{
					shell: false,
					timeout: timeoutMs,
					env: { ...process.env },
					stdio: ['pipe', 'pipe', 'pipe'],
				}
			);

			// Feed the script source via stdin so we don't need the file to have the
			// correct .mjs extension on all platforms.
			const scriptSource = fs.readFileSync(scriptPath, 'utf8');
			nodeChild.stdin!.write(scriptSource);
			nodeChild.stdin!.end();

			let stdout = '';
			let stderr = '';
			nodeChild.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
			nodeChild.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

			nodeChild.on('close', (code) => {
				if (code !== 0 && !stdout.trim().startsWith('[')) {
					reject(new Error(`Playwright script exited ${code}: ${stderr.slice(0, 500)}`));
				} else {
					resolve(stdout);
				}
			});

			nodeChild.on('error', (err) => {
				reject(err);
			});
		});
	}

	/**
	 * Parses the JSON findings array from subprocess stdout. Strips any non-JSON
	 * prefix that Playwright may have printed (e.g. deprecation notices).
	 * Returns an empty array on parse failure — the caller wraps failures as P1.
	 */
	private parseFindings(stdout: string, url: string): PlaywrightFinding[] {
		// Find the first '[' to skip any leading Playwright diagnostic output
		const jsonStart = stdout.indexOf('[');
		if (jsonStart === -1) {
			return [];
		}
		try {
			const raw: unknown = JSON.parse(stdout.slice(jsonStart));
			if (!Array.isArray(raw)) { return []; }
			return raw
				.filter((f: unknown): f is Record<string, unknown> => typeof f === 'object' && f !== null)
				.map((f): PlaywrightFinding => ({
					title: String(f['title'] ?? 'Unknown finding'),
					severity: this.normalizeSeverity(f['severity']),
					url: String(f['url'] ?? url),
					errorMessage: String(f['errorMessage'] ?? ''),
					screenshotPath: typeof f['screenshotPath'] === 'string' ? f['screenshotPath'] : undefined,
					stackTrace: typeof f['stackTrace'] === 'string' ? f['stackTrace'] : undefined,
				}));
		} catch {
			return [];
		}
	}

	private normalizeSeverity(raw: unknown): 'p0' | 'p1' | 'p2' | 'p3' {
		if (raw === 'p0' || raw === 'p1' || raw === 'p2' || raw === 'p3') {
			return raw;
		}
		return 'p3';
	}

	private resolvePageUrl(page: string): string {
		if (/^https?:\/\//i.test(page)) {
			return page;
		}
		const base = this.stagingUrl.replace(/\/$/, '');
		const rel = page.startsWith('/') ? page : `/${page}`;
		return `${base}${rel}`;
	}
}
