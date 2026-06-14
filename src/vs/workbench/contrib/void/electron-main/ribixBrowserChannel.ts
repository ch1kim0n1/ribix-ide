/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';

// Screenshot storage — written to system temp so paths are accessible in-process
const SCREENSHOT_DIR = join(tmpdir(), 'ribix-browser');

function ensureScreenshotDir() {
	if (!existsSync(SCREENSHOT_DIR)) {
		mkdirSync(SCREENSHOT_DIR, { recursive: true });
	}
}

function screenshotPath(label: string): string {
	ensureScreenshotDir();
	const ts = Date.now();
	return join(SCREENSHOT_DIR, `${label}-${ts}.png`);
}

/** A console message captured from the running page. */
interface CapturedConsole {
	type: string;   // 'error' | 'warning' | 'log' | ...
	text: string;
}

/** A network request that failed or returned a non-2xx/3xx status. */
interface CapturedNetworkFailure {
	url: string;
	status: number | null;   // null when the request errored before a response (DNS/refused)
	failure: string | null;  // playwright failure text, when available
}

export class RibixBrowserChannel implements IServerChannel {
	private browser: any = null;
	private page: any = null;
	private playwright: any = null;

	// Runtime signal buffers — populated by page listeners attached in ensureBrowser(),
	// drained by drainDiagnostics(). The browser agent reads these to detect runtime
	// errors, console errors, and failed network requests.
	private consoleMessages: CapturedConsole[] = [];
	private pageErrors: string[] = [];
	private networkFailures: CapturedNetworkFailure[] = [];

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			switch (command) {
				case 'navigate': return await this.navigate(params);
				case 'screenshot': return await this.screenshot();
				case 'click': return await this.click(params);
				case 'type': return await this.typeText(params);
				case 'scroll': return await this.scroll(params);
				case 'getHtml': return await this.getHtml(params);
				case 'diagnostics': return await this.drainDiagnostics();
				case 'close': return await this.close();
				default: throw new Error(`Ribix browser channel: command "${command}" not recognized.`);
			}
		} catch (e) {
			console.error('Ribix browser channel error:', e);
			throw e;
		}
	}

	/**
	 * Returns and clears the runtime signals accumulated since the last drain:
	 * console errors/warnings, uncaught page errors, and failed/erroring network requests.
	 * The browser agent calls this after each interaction turn to detect runtime problems.
	 */
	private async drainDiagnostics(): Promise<{ consoleMessages: CapturedConsole[]; pageErrors: string[]; networkFailures: CapturedNetworkFailure[] }> {
		const out = {
			consoleMessages: this.consoleMessages.slice(),
			pageErrors: this.pageErrors.slice(),
			networkFailures: this.networkFailures.slice(),
		};
		this.consoleMessages = [];
		this.pageErrors = [];
		this.networkFailures = [];
		return out;
	}

	private async ensureBrowser(): Promise<void> {
		if (!this.playwright) {
			// Dynamic import — playwright is a Node.js dep only available in electron-main
			this.playwright = await import('playwright');
		}
		if (!this.browser) {
			this.browser = await this.playwright.chromium.launch({
				headless: true,
				args: ['--no-sandbox', '--disable-setuid-sandbox'],
			});
		}
		if (!this.page) {
			const context = await this.browser.newContext({
				viewport: { width: 1280, height: 720 },
				deviceScaleFactor: 1,
			});
			this.page = await context.newPage();
			this.attachDiagnosticListeners(this.page);
		}
	}

	/**
	 * Wires page-level listeners that feed the runtime-signal buffers. Buffers are capped
	 * so a noisy app cannot grow them without bound (day-2 leak guard).
	 */
	private attachDiagnosticListeners(page: any): void {
		const CAP = 200;
		page.on('console', (msg: any) => {
			const type = typeof msg.type === 'function' ? msg.type() : msg.type;
			const text = typeof msg.text === 'function' ? msg.text() : String(msg.text ?? '');
			if (this.consoleMessages.length < CAP) {
				this.consoleMessages.push({ type, text });
			}
		});
		page.on('pageerror', (err: any) => {
			if (this.pageErrors.length < CAP) {
				this.pageErrors.push(err?.message ? String(err.message) : String(err));
			}
		});
		page.on('requestfailed', (req: any) => {
			if (this.networkFailures.length < CAP) {
				this.networkFailures.push({
					url: typeof req.url === 'function' ? req.url() : String(req.url),
					status: null,
					failure: req.failure?.()?.errorText ?? null,
				});
			}
		});
		page.on('response', (res: any) => {
			const status = typeof res.status === 'function' ? res.status() : res.status;
			if (typeof status === 'number' && status >= 400 && this.networkFailures.length < CAP) {
				this.networkFailures.push({
					url: typeof res.url === 'function' ? res.url() : String(res.url),
					status,
					failure: null,
				});
			}
		});
	}

	private async navigate(params: { url: string; width?: number; height?: number }): Promise<{ screenshotPath: string; title: string; url: string }> {
		await this.ensureBrowser();
		const { url, width = 1280, height = 720 } = params;
		await this.page.setViewportSize({ width, height });
		await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
		const title = await this.page.title();
		const actualUrl = this.page.url();
		const shot = screenshotPath('navigate');
		await this.page.screenshot({ path: shot, fullPage: false });
		return { screenshotPath: shot, title, url: actualUrl };
	}

	private async screenshot(): Promise<{ screenshotPath: string; width: number; height: number }> {
		await this.ensureBrowser();
		const shot = screenshotPath('screenshot');
		await this.page.screenshot({ path: shot, fullPage: false });
		const viewport = this.page.viewportSize();
		return { screenshotPath: shot, width: viewport?.width ?? 1280, height: viewport?.height ?? 720 };
	}

	private async click(params: { selector: string }): Promise<{ screenshotPath: string }> {
		await this.ensureBrowser();
		await this.page.click(params.selector, { timeout: 10000 });
		await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
		const shot = screenshotPath('click');
		await this.page.screenshot({ path: shot, fullPage: false });
		return { screenshotPath: shot };
	}

	private async typeText(params: { selector: string; text: string }): Promise<{ screenshotPath: string }> {
		await this.ensureBrowser();
		await this.page.fill(params.selector, params.text);
		const shot = screenshotPath('type');
		await this.page.screenshot({ path: shot, fullPage: false });
		return { screenshotPath: shot };
	}

	private async scroll(params: { direction: string; amount?: number }): Promise<{ screenshotPath: string }> {
		await this.ensureBrowser();
		const { direction = 'down', amount = 300 } = params;
		const deltaY = direction === 'up' ? -amount : amount;
		const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
		await this.page.mouse.wheel(deltaX, deltaY);
		await this.page.waitForTimeout(300);
		const shot = screenshotPath('scroll');
		await this.page.screenshot({ path: shot, fullPage: false });
		return { screenshotPath: shot };
	}

	private async getHtml(params: { selector?: string }): Promise<{ html: string }> {
		await this.ensureBrowser();
		const html = params?.selector
			? await this.page.$eval(params.selector, (el: Element) => el.outerHTML)
			: await this.page.content();
		return { html };
	}

	private async close(): Promise<{}> {
		if (this.page) { await this.page.close().catch(() => {}); this.page = null; }
		if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
		this.consoleMessages = [];
		this.pageErrors = [];
		this.networkFailures = [];
		return {};
	}
}
