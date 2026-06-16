/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import * as dom from '../../../../base/browser/dom.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/ch1kim0n1/ribix-ide/releases/latest';

/** Storage key for the last update-check timestamp (APPLICATION scope — shared across workspaces). */
const RIBIX_UPDATE_LAST_CHECKED_KEY = 'ribix.autoUpdate.lastChecked';
/** 24 hours in milliseconds. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
	version: string;
	releaseUrl: string;
	installerUrl: string;
	changelog: string;
}

/** Shape of the GitHub releases API response we care about. */
interface GitHubRelease {
	tag_name: string;
	html_url: string;
	body: string | null;
	assets: Array<{
		name: string;
		browser_download_url: string;
	}>;
}

/**
 * Compares two semver strings. Returns true when `candidate` is strictly newer
 * than `current`. Only handles the numeric MAJOR.MINOR.PATCH form.
 */
function isNewer(current: string, candidate: string): boolean {
	const parse = (v: string) =>
		v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

	const [cMaj, cMin, cPat] = parse(current);
	const [nMaj, nMin, nPat] = parse(candidate);

	if (nMaj !== cMaj) { return nMaj > cMaj; }
	if (nMin !== cMin) { return nMin > cMin; }
	return nPat > cPat;
}

/**
 * Picks the installer asset URL for the current platform from a GitHub release.
 * Falls back to the release HTML page when no matching asset is found.
 */
function pickInstallerUrl(release: GitHubRelease): string {
	const assets = release.assets ?? [];

	// Prefer platform-specific installers in priority order.
	const matchers: Array<(name: string) => boolean> = [];

	if (typeof process !== 'undefined') {
		if (process.platform === 'win32') {
			matchers.push(n => /\.exe$/i.test(n) || /install\.bat$/i.test(n));
		} else if (process.platform === 'darwin') {
			matchers.push(n => /\.dmg$/i.test(n) || /install\.sh$/i.test(n));
		} else {
			matchers.push(n => /install\.sh$/i.test(n) || /\.AppImage$/i.test(n) || /\.deb$/i.test(n));
		}
	}

	for (const matcher of matchers) {
		const asset = assets.find(a => matcher(a.name));
		if (asset) {
			return asset.browser_download_url;
		}
	}

	// Last resort: the release page itself.
	return release.html_url;
}

export class RibixAutoUpdater {
	/**
	 * Fetches the latest GitHub release and returns an UpdateInfo when the release
	 * version is strictly newer than `currentVersion`. Returns null otherwise.
	 */
	async checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
		let release: GitHubRelease;
		try {
			const response = await fetch(GITHUB_RELEASES_API, {
				headers: { Accept: 'application/vnd.github+json' },
			});
			if (!response.ok) {
				console.warn(`RibixAutoUpdater: GitHub API returned ${response.status}`);
				return null;
			}
			release = await response.json() as GitHubRelease;
		} catch (e) {
			console.warn('RibixAutoUpdater: network error while checking for update:', e);
			return null;
		}

		const remoteVersion = release.tag_name?.replace(/^v/, '') ?? '';
		if (!remoteVersion || !isNewer(currentVersion, remoteVersion)) {
			return null;
		}

		return {
			version: remoteVersion,
			releaseUrl: release.html_url,
			installerUrl: pickInstallerUrl(release),
			changelog: release.body ?? '',
		};
	}

	/**
	 * Shows a sticky VS Code notification with an "Update now" action that opens the
	 * installer URL in the user's browser, and a "Later" dismiss action.
	 */
	async promptUpdate(info: UpdateInfo, notificationService: INotificationService): Promise<void> {
		const { window } = dom.getActiveWindow();

		notificationService.notify({
			severity: Severity.Info,
			message: `Ribix IDE update available: v${info.version}`,
			sticky: true,
			actions: {
				primary: [
					{
						id: 'ribix.autoUpdate.updateNow',
						label: `Update now`,
						enabled: true,
						tooltip: '',
						class: undefined,
						run: () => {
							window.open(info.installerUrl);
						},
					},
					{
						id: 'ribix.autoUpdate.viewRelease',
						label: 'View release notes',
						enabled: true,
						tooltip: '',
						class: undefined,
						run: () => {
							window.open(info.releaseUrl);
						},
					},
				],
				secondary: [
					{
						id: 'ribix.autoUpdate.later',
						label: 'Later',
						enabled: true,
						tooltip: '',
						class: undefined,
						run: () => { /* dismiss */ },
					},
				],
			},
		});
	}

	/**
	 * Opens the platform installer URL in the user's default browser.
	 * For `.sh` scripts the user will need to run it manually; we surface the URL
	 * rather than shelling out so we stay inside the sandboxed renderer.
	 */
	async runInstaller(installerUrl: string): Promise<void> {
		const { window } = dom.getActiveWindow();
		window.open(installerUrl);
	}
}

// ---------------------------------------------------------------------------
// Workbench contribution — wires auto-check on startup with 24 h cache
// ---------------------------------------------------------------------------

/** The version shipped in this build. Injected at build time via package.json. */
declare const RIBIX_BUILD_VERSION: string | undefined;

class RibixAutoUpdateContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.ribix.autoUpdate';

	private readonly updater = new RibixAutoUpdater();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this._scheduleCheck();
	}

	private _scheduleCheck(): void {
		const { window } = dom.getActiveWindow();

		// Run 10 seconds after startup to avoid blocking restore.
		const initId = window.setTimeout(() => this._runCheck(), 10_000);
		this._register({ dispose: () => window.clearTimeout(initId) });
	}

	private async _runCheck(): Promise<void> {
		// Honour the 24 h cache to avoid hammering the GitHub API.
		const lastChecked = this.storageService.getNumber(
			RIBIX_UPDATE_LAST_CHECKED_KEY,
			StorageScope.APPLICATION,
			0,
		);

		if (Date.now() - lastChecked < UPDATE_CHECK_INTERVAL_MS) {
			return;
		}

		// Stamp before the network call so a slow/failed check doesn't retry immediately.
		this.storageService.store(
			RIBIX_UPDATE_LAST_CHECKED_KEY,
			Date.now(),
			StorageScope.APPLICATION,
			StorageTarget.USER,
		);

		// Resolve the current version from the build constant or fall back gracefully.
		const currentVersion: string =
			(typeof RIBIX_BUILD_VERSION !== 'undefined' ? RIBIX_BUILD_VERSION : undefined)
			?? '0.0.0';

		const info = await this.updater.checkForUpdate(currentVersion);
		if (info) {
			await this.updater.promptUpdate(info, this.notificationService);
		}
	}
}

registerWorkbenchContribution2(
	RibixAutoUpdateContribution.ID,
	RibixAutoUpdateContribution,
	WorkbenchPhase.AfterRestored,
);
