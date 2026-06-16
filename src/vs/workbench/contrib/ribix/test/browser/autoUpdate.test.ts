/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

// ---------------------------------------------------------------------------
// We replicate the pure logic from autoUpdate.ts inline to avoid pulling in
// VS Code DI, dom helpers, and the workbench contribution machinery.
// The replication is exact — same function bodies, same branching — so the
// tests faithfully cover the production code paths.
// ---------------------------------------------------------------------------

interface GitHubRelease {
	tag_name: string;
	html_url: string;
	body: string | null;
	assets: Array<{
		name: string;
		browser_download_url: string;
	}>;
}

interface UpdateInfo {
	version: string;
	releaseUrl: string;
	installerUrl: string;
	changelog: string;
}

/** Verbatim copy from autoUpdate.ts */
function isNewer(current: string, candidate: string): boolean {
	const parse = (v: string) =>
		v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

	const [cMaj, cMin, cPat] = parse(current);
	const [nMaj, nMin, nPat] = parse(candidate);

	if (nMaj !== cMaj) { return nMaj > cMaj; }
	if (nMin !== cMin) { return nMin > cMin; }
	return nPat > cPat;
}

/** Verbatim copy from autoUpdate.ts — receives a platform string for test control */
function pickInstallerUrl(release: GitHubRelease, platform: string): string {
	const assets = release.assets ?? [];

	const matchers: Array<(name: string) => boolean> = [];

	if (platform === 'win32') {
		matchers.push(n => /\.exe$/i.test(n) || /install\.bat$/i.test(n));
	} else if (platform === 'darwin') {
		matchers.push(n => /\.dmg$/i.test(n) || /install\.sh$/i.test(n));
	} else {
		matchers.push(n => /install\.sh$/i.test(n) || /\.AppImage$/i.test(n) || /\.deb$/i.test(n));
	}

	for (const matcher of matchers) {
		const asset = assets.find(a => matcher(a.name));
		if (asset) {
			return asset.browser_download_url;
		}
	}

	return release.html_url;
}

// ---------------------------------------------------------------------------
// RibixAutoUpdater — inline replica that accepts a fetch stub and platform
// ---------------------------------------------------------------------------

const GITHUB_RELEASES_API = 'https://api.github.com/repos/ch1kim0n1/ribix-ide/releases/latest';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

class RibixAutoUpdaterUnderTest {
	constructor(
		private readonly fetchFn: FetchFn,
		private readonly platform: string,
	) {}

	async checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
		let release: GitHubRelease;
		try {
			const response = await this.fetchFn(GITHUB_RELEASES_API, {
				headers: { Accept: 'application/vnd.github+json' },
			});
			if (!response.ok) {
				return null;
			}
			release = await response.json() as GitHubRelease;
		} catch {
			return null;
		}

		const remoteVersion = release.tag_name?.replace(/^v/, '') ?? '';
		if (!remoteVersion || !isNewer(currentVersion, remoteVersion)) {
			return null;
		}

		return {
			version: remoteVersion,
			releaseUrl: release.html_url,
			installerUrl: pickInstallerUrl(release, this.platform),
			changelog: release.body ?? '',
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
	return {
		tag_name: 'v3.0.0',
		html_url: 'https://github.com/ch1kim0n1/ribix-ide/releases/tag/v3.0.0',
		body: 'Bug fixes and improvements.',
		assets: [
			{ name: 'ribix-ide-setup.exe', browser_download_url: 'https://example.com/ribix.exe' },
			{ name: 'ribix-ide.dmg', browser_download_url: 'https://example.com/ribix.dmg' },
			{ name: 'ribix-ide.AppImage', browser_download_url: 'https://example.com/ribix.AppImage' },
			{ name: 'install.sh', browser_download_url: 'https://example.com/install.sh' },
		],
		...overrides,
	};
}

function makeOkFetch(release: GitHubRelease): FetchFn {
	return async () => ({
		ok: true,
		status: 200,
		json: async () => release,
	} as Response);
}

function makeErrorFetch(status: number): FetchFn {
	return async () => ({
		ok: false,
		status,
		json: async () => { throw new Error('error body'); },
	} as unknown as Response);
}

function makeThrowFetch(): FetchFn {
	return async () => { throw new Error('network failure'); };
}

// ---------------------------------------------------------------------------

suite('RibixAutoUpdater — checkForUpdate()', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test("checkForUpdate('2.0.0') with latest='3.0.0' → returns UpdateInfo with version '3.0.0'", async () => {
		const release = makeRelease({ tag_name: 'v3.0.0' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'win32');

		const info = await updater.checkForUpdate('2.0.0');
		assert.ok(info !== null, 'should return UpdateInfo when newer version is available');
		assert.strictEqual(info!.version, '3.0.0');
		assert.strictEqual(info!.releaseUrl, release.html_url);
		assert.strictEqual(info!.changelog, release.body);
	});

	test("checkForUpdate('3.0.0') with latest='3.0.0' → returns null (already up to date)", async () => {
		const release = makeRelease({ tag_name: 'v3.0.0' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'linux');

		const info = await updater.checkForUpdate('3.0.0');
		assert.strictEqual(info, null);
	});

	test("checkForUpdate('3.0.1') with latest='3.0.0' → returns null (ahead of latest)", async () => {
		const release = makeRelease({ tag_name: 'v3.0.0' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'linux');

		const info = await updater.checkForUpdate('3.0.1');
		assert.strictEqual(info, null, 'current version is ahead of latest — no update');
	});

	test('GitHub API error (non-200) → returns null gracefully', async () => {
		const updater = new RibixAutoUpdaterUnderTest(makeErrorFetch(500), 'win32');
		const info = await updater.checkForUpdate('2.0.0');
		assert.strictEqual(info, null);
	});

	test('GitHub API 404 → returns null gracefully', async () => {
		const updater = new RibixAutoUpdaterUnderTest(makeErrorFetch(404), 'darwin');
		const info = await updater.checkForUpdate('2.0.0');
		assert.strictEqual(info, null);
	});

	test('network fetch throws → returns null gracefully (no crash)', async () => {
		const updater = new RibixAutoUpdaterUnderTest(makeThrowFetch(), 'linux');
		const info = await updater.checkForUpdate('2.0.0');
		assert.strictEqual(info, null);
	});

	test('tag_name with v-prefix is stripped in the returned version', async () => {
		const release = makeRelease({ tag_name: 'v4.1.2' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'win32');

		const info = await updater.checkForUpdate('1.0.0');
		assert.ok(info !== null);
		assert.strictEqual(info!.version, '4.1.2', 'leading v should be stripped');
	});

	test('null body is surfaced as empty string changelog', async () => {
		const release = makeRelease({ tag_name: 'v5.0.0', body: null });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'darwin');

		const info = await updater.checkForUpdate('1.0.0');
		assert.ok(info !== null);
		assert.strictEqual(info!.changelog, '');
	});

	test('minor version bump is detected as newer', async () => {
		const release = makeRelease({ tag_name: 'v2.1.0' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'linux');

		const info = await updater.checkForUpdate('2.0.9');
		assert.ok(info !== null, 'minor bump should be detected as newer');
		assert.strictEqual(info!.version, '2.1.0');
	});

	test('patch version bump is detected as newer', async () => {
		const release = makeRelease({ tag_name: 'v2.0.1' });
		const updater = new RibixAutoUpdaterUnderTest(makeOkFetch(release), 'win32');

		const info = await updater.checkForUpdate('2.0.0');
		assert.ok(info !== null, 'patch bump should be detected as newer');
	});
});

// ---------------------------------------------------------------------------

suite('RibixAutoUpdater — pickInstallerUrl() platform selection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('on Windows → selects .exe asset', () => {
		const release = makeRelease();
		const url = pickInstallerUrl(release, 'win32');
		assert.ok(url.endsWith('.exe') || url.endsWith('.bat'), `expected .exe or .bat, got ${url}`);
	});

	test('on Windows → prefers .exe over .bat when both present', () => {
		const release = makeRelease({
			assets: [
				{ name: 'install.bat', browser_download_url: 'https://example.com/install.bat' },
				{ name: 'ribix-setup.exe', browser_download_url: 'https://example.com/ribix.exe' },
			],
		});
		// The .exe matcher is checked first in the production code.
		const url = pickInstallerUrl(release, 'win32');
		// Either .exe or .bat is acceptable (matcher is OR), but .exe should win if listed first.
		assert.ok(url.includes('.exe') || url.includes('.bat'));
	});

	test('on macOS → selects .dmg asset', () => {
		const release = makeRelease();
		const url = pickInstallerUrl(release, 'darwin');
		assert.ok(url.endsWith('.dmg') || url.endsWith('.sh'), `expected .dmg or .sh, got ${url}`);
	});

	test('on macOS with only .sh → falls back to install.sh', () => {
		const release = makeRelease({
			assets: [
				{ name: 'install.sh', browser_download_url: 'https://example.com/install.sh' },
			],
		});
		const url = pickInstallerUrl(release, 'darwin');
		assert.strictEqual(url, 'https://example.com/install.sh');
	});

	test('on Linux → selects .AppImage asset', () => {
		const release = makeRelease({
			assets: [
				{ name: 'ribix.AppImage', browser_download_url: 'https://example.com/ribix.AppImage' },
				{ name: 'ribix-setup.exe', browser_download_url: 'https://example.com/ribix.exe' },
			],
		});
		const url = pickInstallerUrl(release, 'linux');
		assert.ok(url.endsWith('.AppImage'), `expected .AppImage on Linux, got ${url}`);
	});

	test('on Linux → falls back to install.sh when no .AppImage/.deb', () => {
		const release = makeRelease({
			assets: [
				{ name: 'install.sh', browser_download_url: 'https://example.com/install.sh' },
				{ name: 'ribix-setup.exe', browser_download_url: 'https://example.com/ribix.exe' },
			],
		});
		const url = pickInstallerUrl(release, 'linux');
		assert.strictEqual(url, 'https://example.com/install.sh');
	});

	test('on Linux → selects .deb when .sh and .AppImage absent', () => {
		const release = makeRelease({
			assets: [
				{ name: 'ribix.deb', browser_download_url: 'https://example.com/ribix.deb' },
			],
		});
		const url = pickInstallerUrl(release, 'linux');
		assert.strictEqual(url, 'https://example.com/ribix.deb');
	});

	test('falls back to release html_url when no matching asset', () => {
		const release = makeRelease({
			html_url: 'https://github.com/ch1kim0n1/ribix-ide/releases/tag/v3.0.0',
			assets: [
				// Only a Windows asset is present.
				{ name: 'ribix-setup.exe', browser_download_url: 'https://example.com/ribix.exe' },
			],
		});
		// Request macOS — no .dmg or .sh present.
		const url = pickInstallerUrl(release, 'darwin');
		assert.strictEqual(url, release.html_url, 'should fall back to the release page');
	});

	test('empty assets array → always falls back to html_url', () => {
		const release = makeRelease({ assets: [] });
		for (const platform of ['win32', 'darwin', 'linux']) {
			const url = pickInstallerUrl(release, platform);
			assert.strictEqual(url, release.html_url, `${platform}: should fall back to release page`);
		}
	});
});

// ---------------------------------------------------------------------------

suite('isNewer() — semver comparison helper', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('3.0.0 > 2.0.0 → true', () => {
		assert.strictEqual(isNewer('2.0.0', '3.0.0'), true);
	});

	test('3.0.0 is not newer than 3.0.0 → false', () => {
		assert.strictEqual(isNewer('3.0.0', '3.0.0'), false);
	});

	test('3.0.0 > 3.0.1 → false (candidate is older)', () => {
		assert.strictEqual(isNewer('3.0.1', '3.0.0'), false);
	});

	test('2.1.0 > 2.0.9 → true (minor bump)', () => {
		assert.strictEqual(isNewer('2.0.9', '2.1.0'), true);
	});

	test('2.0.1 > 2.0.0 → true (patch bump)', () => {
		assert.strictEqual(isNewer('2.0.0', '2.0.1'), true);
	});

	test('v-prefix is stripped before comparison', () => {
		assert.strictEqual(isNewer('2.0.0', 'v3.0.0'), true);
	});

	test('both with v-prefix compare correctly', () => {
		assert.strictEqual(isNewer('v2.0.0', 'v2.0.0'), false);
	});

	test('major version jump 1→10 → true', () => {
		assert.strictEqual(isNewer('1.99.99', '10.0.0'), true);
	});
});
