/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixConfigValidation.ts
 *
 * Startup validation for required Ribix IDE configuration. Fails fast with
 * actionable error messages when required secrets or settings are missing or
 * malformed. See docs/production-secrets.md for the full inventory.
 *
 * Issue #84 — Production readiness: secrets and environment configuration.
 * Issue #92 — Runtime minimum version check for Node.js.
 */

import { localize } from '../../../../nls.js';

/** A single validation result. */
export interface ConfigValidationResult {
	readonly valid: boolean;
	readonly errors: ConfigValidationError[];
	readonly warnings: ConfigValidationWarning[];
}

export interface ConfigValidationError {
	readonly provider: string;
	readonly setting: string;
	readonly message: string;
}

export interface ConfigValidationWarning {
	readonly provider: string;
	readonly message: string;
}

// #92: Minimum Node.js version required for Ribix IDE features.
const MIN_NODE_VERSION_MAJOR = 18;
const MIN_NODE_VERSION_MINOR = 0;

/**
 * #92: Validate that the runtime Node.js version meets the minimum requirement.
 * Returns an error if the version is too old.
 */
export function validateRuntimeVersion(): ConfigValidationResult {
	const errors: ConfigValidationError[] = [];
	const warnings: ConfigValidationWarning[] = [];

	const nodeVersion = process.versions.node;
	const parts = nodeVersion.split('.').map(Number);
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;

	if (major < MIN_NODE_VERSION_MAJOR ||
		(major === MIN_NODE_VERSION_MAJOR && minor < MIN_NODE_VERSION_MINOR)) {
		errors.push({
			provider: 'runtime',
			setting: 'node',
			message: localize('ribix.config.nodeVersionTooOld',
				'Node.js {0} is too old. Ribix IDE requires Node.js {1}.{2} or later.',
				nodeVersion, MIN_NODE_VERSION_MAJOR, MIN_NODE_VERSION_MINOR),
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/** Provider names that require an API key. */
const API_KEY_PROVIDERS = [
	'anthropic',
	'openAI',
	'deepseek',
	'openRouter',
	'gemini',
	'groq',
	'xAI',
	'mistral',
	'openAICompatible',
	'awsBedrock',
	'microsoftAzure',
] as const;

/** Provider names that require an endpoint URL. */
const ENDPOINT_PROVIDERS = [
	'ollama',
	'vLLM',
	'lmStudio',
	'openAICompatible',
	'liteLLM',
] as const;

/** Default endpoints for local providers (used to warn if unchanged from default). */
const DEFAULT_ENDPOINTS: Record<string, string> = {
	ollama: 'http://127.0.0.1:11434',
	vLLM: 'http://localhost:8000',
	lmStudio: 'http://localhost:1234',
};

/**
 * Validates that a string is a well-formed URL.
 */
function isValidUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Validates provider settings at startup.
 *
 * @param settingsOfProvider  The current provider settings object, keyed by provider name.
 *   Each value is an object with `apiKey`, `endpoint`, etc. depending on the provider.
 * @returns A validation result with errors (must fix) and warnings (should review).
 */
export function validateProviderSettings(
	settingsOfProvider: Record<string, Record<string, string | undefined>>,
): ConfigValidationResult {
	const errors: ConfigValidationError[] = [];
	const warnings: ConfigValidationWarning[] = [];

	// Check API key providers
	for (const provider of API_KEY_PROVIDERS) {
		const config = settingsOfProvider[provider];
		if (!config) { continue; }

		const apiKey = config.apiKey;
		if (apiKey !== undefined && apiKey !== '') {
			// Key is present — check for obvious placeholder values
			if (apiKey === 'your-api-key' || apiKey === 'xxx' || apiKey === 'test') {
				warnings.push({
					provider,
					message: localize('ribix.config.placeholderKey',
						'API key for {0} looks like a placeholder. Replace it with a real key.',
						provider),
				});
			}
		}
	}

	// Check endpoint providers
	for (const provider of ENDPOINT_PROVIDERS) {
		const config = settingsOfProvider[provider];
		if (!config) { continue; }

		const endpoint = config.endpoint;
		if (endpoint !== undefined && endpoint !== '') {
			if (!isValidUrl(endpoint)) {
				errors.push({
					provider,
					setting: 'endpoint',
					message: localize('ribix.config.invalidEndpoint',
						'Endpoint for {0} is not a valid URL: "{1}"',
						provider, endpoint),
				});
			}
		} else if (provider in DEFAULT_ENDPOINTS) {
			// Local provider with empty endpoint — warn (not error, since user may not use it)
			warnings.push({
				provider,
				message: localize('ribix.config.emptyEndpoint',
					'{0} endpoint is empty. Set it to {1} if you want the default.',
					provider, DEFAULT_ENDPOINTS[provider]),
			});
		}
	}

	// Check that at least one provider is configured
	const API_KEY_PROVIDER_NAMES: ReadonlyArray<string> = API_KEY_PROVIDERS;
	const ENDPOINT_PROVIDER_NAMES: ReadonlyArray<string> = ENDPOINT_PROVIDERS;
	const hasAnyProvider = Object.entries(settingsOfProvider).some(([name, config]) => {
		if (API_KEY_PROVIDER_NAMES.includes(name)) {
			return config?.apiKey && config.apiKey !== '';
		}
		if (ENDPOINT_PROVIDER_NAMES.includes(name)) {
			return config?.endpoint && config.endpoint !== '';
		}
		return false;
	});

	if (!hasAnyProvider) {
		errors.push({
			provider: '*',
			setting: 'any',
			message: localize('ribix.config.noProvider',
				'No AI provider is configured. Open Settings and add an API key for at least one provider (Anthropic, OpenAI, Gemini, etc.) or set up a local provider (Ollama, vLLM, LM Studio).'),
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Formats validation results into a human-readable string for display in
 * error dialogs or the output panel.
 */
export function formatValidationResults(result: ConfigValidationResult): string {
	const lines: string[] = [];

	if (result.errors.length > 0) {
		lines.push(localize('ribix.config.errorsHeader', 'Configuration errors (must fix):'));
		for (const err of result.errors) {
			lines.push(`  • [${err.provider}] ${err.message}`);
		}
	}

	if (result.warnings.length > 0) {
		if (lines.length > 0) { lines.push(''); }
		lines.push(localize('ribix.config.warningsHeader', 'Configuration warnings (review recommended):'));
		for (const warn of result.warnings) {
			lines.push(`  • [${warn.provider}] ${warn.message}`);
		}
	}

	if (result.valid && result.warnings.length === 0) {
		lines.push(localize('ribix.config.allValid', 'All configuration checks passed.'));
	}

	return lines.join('\n');
}
