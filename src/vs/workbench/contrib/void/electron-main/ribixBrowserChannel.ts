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

export class RibixBrowserChannel implements IServerChannel {
	private browser: any = null;
	private page: any = null;
	private playwright: any = null;

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
				case 'close': return await this.close();
				default: throw new Error(`Ribix browser channel: command "${command}" not recognized.`);
			}
		} catch (e) {
			console.error('Ribix browser channel error:', e);
			throw e;
		}
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
		}
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
		return {};
	}
}
