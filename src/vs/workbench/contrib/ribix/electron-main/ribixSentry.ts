/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * #148: Sentry initialization for the Electron main process.
 *
 * Initializes @sentry/electron so unhandled exceptions and crashes in the main
 * process are captured and reported. The DSN is read from the SENTRY_DSN
 * environment variable — if it is not set, Sentry is not initialized (no-op),
 * which is the correct behavior for local development.
 *
 * This module is imported from metricsMainService.ts (a ribix-owned file) so
 * that no VS Code core files need to be modified.
 */

let initialized = false;

/**
 * Initializes Sentry in the Electron main process. Safe to call multiple times
 * — subsequent calls are no-ops. Returns true if Sentry was initialized.
 */
export async function initSentryMain(): Promise<boolean> {
	if (initialized) {
		return false;
	}

	const dsn = process.env['SENTRY_DSN'];
	if (!dsn) {
		// No DSN configured — skip Sentry initialization (local dev / no secrets).
		return false;
	}

	try {
		// Dynamic import so the dependency is only loaded when Sentry is actually
		// configured. This avoids pulling @sentry/electron into the bundle when
		// it's not needed.
		const Sentry = await import('@sentry/electron');
		Sentry.init({
			dsn,
			// Only send events in production builds; dev crashes are noisy.
			beforeSend(event: any) {
				if (process.env['NODE_ENV'] === 'development') {
					return null;
				}
				return event;
			},
		});
		initialized = true;
		return true;
	} catch {
		// @sentry/electron not installed or failed to init — silently skip.
		// Telemetry/error reporting must never crash the IDE.
		return false;
	}
}
