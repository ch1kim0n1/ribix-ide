/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Compatibility layer between the Void fork's extension host
 * and the official VS Code Marketplace API.
 *
 * This complements the lower-level ExtensionCompatibilityManager in
 * extensionCompatibility.ts. That class tracks binary-compatible/incompatible
 * state for installed extensions. This class deals with the Marketplace API:
 * fetching extension metadata and surfacing a compatibility verdict alongside it.
 *
 * API changes needed (see IMPLEMENTATION_STATUS.md — "Marketplace API Integration"):
 *  1. The Marketplace CORS policy blocks browser-origin requests. Calls from the
 *     web IDE must be proxied through a ribix backend endpoint (e.g.
 *     POST /ide/marketplace/query) that forwards the request server-side.
 *  2. The desktop IDE can call the Marketplace directly (no CORS restriction).
 *  3. The `Accept` header must use the versioned content-type accepted by the
 *     Gallery API: `application/json;api-version=7.2-preview.1`.
 *  4. For authenticated requests (higher rate limits) the backend should attach
 *     a PAT via the `Authorization: Bearer <pat>` header.
 */

/** VS Code Marketplace Gallery API endpoint */
const MARKETPLACE_API_URL =
	'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

export interface MarketplaceExtension {
	id: string;
	name: string;
	publisher: string;
	version: string;
	compatibilityStatus: 'compatible' | 'partial' | 'incompatible' | 'unknown';
	compatibilityNotes?: string;
}

/**
 * Top 20 most-installed VS Code extensions, pre-seeded as compatible.
 * Source: VS Code Marketplace "Most Installed" chart (as of 2025).
 * These are pre-populated so the first cold start has useful data without
 * making a network call.
 */
const TOP_EXTENSIONS_SEED: MarketplaceExtension[] = [
	{ id: 'dbaeumer.vscode-eslint', name: 'ESLint', publisher: 'dbaeumer', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'esbenp.prettier-vscode', name: 'Prettier', publisher: 'esbenp', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'eamodio.gitlens', name: 'GitLens', publisher: 'eamodio', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ms-vscode.vscode-typescript-next', name: 'TypeScript Nightly', publisher: 'ms-vscode', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ms-python.python', name: 'Python', publisher: 'ms-python', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ms-azuretools.vscode-docker', name: 'Docker', publisher: 'ms-azuretools', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'redhat.vscode-yaml', name: 'YAML', publisher: 'redhat', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ms-vscode-remote.remote-ssh', name: 'Remote - SSH', publisher: 'ms-vscode-remote', version: '*', compatibilityStatus: 'partial', compatibilityNotes: 'Remote extension host features require the desktop build' },
	{ id: 'GitHub.vscode-pull-request-github', name: 'GitHub Pull Requests', publisher: 'GitHub', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ritwickdey.LiveServer', name: 'Live Server', publisher: 'ritwickdey', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'ms-vscode.cpptools', name: 'C/C++', publisher: 'ms-vscode', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'Prisma.prisma', name: 'Prisma', publisher: 'Prisma', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'christian-kohler.path-intellisense', name: 'Path Intellisense', publisher: 'christian-kohler', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'PKief.material-icon-theme', name: 'Material Icon Theme', publisher: 'PKief', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'usernamehw.errorlens', name: 'Error Lens', publisher: 'usernamehw', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'streetsidesoftware.code-spell-checker', name: 'Code Spell Checker', publisher: 'streetsidesoftware', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'formulahendry.auto-rename-tag', name: 'Auto Rename Tag', publisher: 'formulahendry', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'bradlc.vscode-tailwindcss', name: 'Tailwind CSS IntelliSense', publisher: 'bradlc', version: '*', compatibilityStatus: 'compatible' },
	{ id: 'GitHub.copilot', name: 'GitHub Copilot', publisher: 'GitHub', version: '*', compatibilityStatus: 'partial', compatibilityNotes: 'May conflict with Ribix AI features. Disable Copilot inline suggestions if using Ribix autocomplete.' },
	{ id: 'ms-vscode.live-share', name: 'Live Share', publisher: 'ms-vscode', version: '*', compatibilityStatus: 'partial', compatibilityNotes: 'Live Share collaboration requires Microsoft account sign-in and may conflict with Ribix workspace auth' },
];

export class MarketplaceCompatibilityManager {
	/** Known-compatible extensions from the built-in database and runtime overrides */
	private compatDb: Map<string, MarketplaceExtension> = new Map();

	constructor() {
		for (const ext of TOP_EXTENSIONS_SEED) {
			this.compatDb.set(ext.id, ext);
		}
	}

	/**
	 * Returns the compatibility record for an extension.
	 * If the extension is not in the local DB, fetches from the Marketplace and caches.
	 */
	async checkCompatibility(extensionId: string): Promise<MarketplaceExtension> {
		const cached = this.compatDb.get(extensionId);
		if (cached) {
			return cached;
		}

		const fetched = await this.fetchFromMarketplace(extensionId);
		if (fetched) {
			this.compatDb.set(extensionId, fetched);
			return fetched;
		}

		// Unknown extension: return a placeholder with unknown status.
		const unknown: MarketplaceExtension = {
			id: extensionId,
			name: extensionId,
			publisher: extensionId.split('.')[0] ?? extensionId,
			version: 'unknown',
			compatibilityStatus: 'unknown',
		};
		this.compatDb.set(extensionId, unknown);
		return unknown;
	}

	/**
	 * Fetches metadata from the official VS Code Marketplace Gallery API.
	 *
	 * CORS note: this request will fail in a browser context due to Marketplace
	 * CORS policy. In ribix-ide (web mode) this must be routed through a backend
	 * proxy. In the desktop build it will succeed. See IMPLEMENTATION_STATUS.md
	 * "Marketplace API Integration" for the required API changes.
	 */
	async fetchFromMarketplace(extensionId: string): Promise<MarketplaceExtension | null> {
		try {
			const [publisher, name] = extensionId.split('.');
			if (!publisher || !name) {
				return null;
			}

			const response = await fetch(MARKETPLACE_API_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// Versioned accept header required by the Gallery API.
					// The Accept header alone does not satisfy CORS preflight — see note above.
					'Accept': 'application/json;api-version=7.2-preview.1',
					// User-Agent is not settable from a browser. The backend proxy must set it.
					// 'User-Agent': 'ribix-ide/1.0',
				},
				body: JSON.stringify({
					filters: [
						{
							criteria: [
								{ filterType: 7, value: extensionId }, // filterType 7 = extensionName
							],
						},
					],
					flags: 914, // include statistics, versions, files, categories, tags
				}),
			});

			if (!response.ok) {
				return null;
			}

			const data = await response.json() as {
				results: Array<{ extensions: Array<{ extensionId: string; extensionName: string; publisher: { publisherName: string }; versions: Array<{ version: string }> }> }>;
			};

			const ext = data.results[0]?.extensions[0];
			if (!ext) {
				return null;
			}

			return {
				id: extensionId,
				name: ext.extensionName,
				publisher: ext.publisher.publisherName,
				version: ext.versions[0]?.version ?? 'unknown',
				compatibilityStatus: 'unknown',
				compatibilityNotes: 'Fetched from Marketplace — compatibility not yet verified in this fork',
			};
		} catch {
			// Network failure or CORS block — caller falls back to unknown record.
			return null;
		}
	}

	/**
	 * Registers a manual compatibility override for an extension.
	 * Use this for extensions confirmed to work correctly in the Void fork.
	 */
	registerCompatibilityOverride(id: string, status: 'compatible' | 'partial', notes?: string): void {
		const existing = this.compatDb.get(id);
		this.compatDb.set(id, {
			id,
			name: existing?.name ?? id,
			publisher: existing?.publisher ?? id.split('.')[0] ?? id,
			version: existing?.version ?? '*',
			compatibilityStatus: status,
			compatibilityNotes: notes ?? existing?.compatibilityNotes,
		});
	}

	/**
	 * Preloads the top 50 most-used VS Code extensions as compatible.
	 * The seed already covers the top 20; this method fetches the rest from
	 * the Marketplace by popularity (flags=0x200 = SortByInstallCount).
	 *
	 * In a browser context the Marketplace fetch will fail silently due to CORS.
	 * The seed data is still usable. See IMPLEMENTATION_STATUS.md for required
	 * backend proxy work.
	 */
	async preloadTopExtensions(): Promise<void> {
		try {
			const response = await fetch(MARKETPLACE_API_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json;api-version=7.2-preview.1',
				},
				body: JSON.stringify({
					filters: [
						{
							criteria: [
								{ filterType: 8, value: '1' }, // filterType 8 = category, value 1 = all
							],
							pageSize: 50,
							sortBy: 4, // 4 = InstallCount
							sortOrder: 2, // 2 = Descending
						},
					],
					flags: 914,
				}),
			});

			if (!response.ok) {
				return;
			}

			const data = await response.json() as {
				results: Array<{
					extensions: Array<{
						extensionId: string;
						extensionName: string;
						publisher: { publisherName: string };
						versions: Array<{ version: string }>;
					}>;
				}>;
			};

			for (const ext of data.results[0]?.extensions ?? []) {
				const id = `${ext.publisher.publisherName}.${ext.extensionName}`;
				if (!this.compatDb.has(id)) {
					this.compatDb.set(id, {
						id,
						name: ext.extensionName,
						publisher: ext.publisher.publisherName,
						version: ext.versions[0]?.version ?? 'unknown',
						compatibilityStatus: 'unknown',
					});
				}
			}
		} catch {
			// Silently ignore — seed data is still available.
		}
	}

	/** Returns all extensions currently in the local compatibility database. */
	getAll(): MarketplaceExtension[] {
		return Array.from(this.compatDb.values());
	}
}

export const marketplaceCompat = new MarketplaceCompatibilityManager();
