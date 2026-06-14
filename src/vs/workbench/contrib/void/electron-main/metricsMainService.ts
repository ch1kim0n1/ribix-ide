/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageTarget, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';

import { IMetricsService } from '../common/metricsService.js';
import { OPT_OUT_KEY } from '../common/storageKeys.js';


const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null
const _getOSInfo = () => {
	try {
		const { platform, arch } = process // see platform.ts
		return { platform, arch }
	}
	catch (e) {
		return { osInfo: { platform: '??', arch: '??' } }
	}
}
const osInfo = _getOSInfo()

/** Module-level session ID — generated once per IDE process lifetime. */
const sessionId = generateUuid()

/** Storage key where ribixAuthService persists the API and app URLs. */
const RIBIX_AUTH_URLS_KEY = 'ribix.auth.urls'


export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	private _initProperties: object = {}
	private _optOut: boolean = false
	private _apiUrl: string | null = null

	// helper - looks like this is stored in a .vscdb file in ~/Library/Application Support
	private _memoStorage(key: string, target: StorageTarget, setValIfNotExist?: string) {
		const currVal = this._appStorage.get(key, StorageScope.APPLICATION)
		if (currVal !== undefined) return currVal
		const newVal = setValIfNotExist ?? generateUuid()
		this._appStorage.store(key, newVal, StorageScope.APPLICATION, target)
		return newVal
	}

	/**
	 * Read a value from the canonical `ribix.*` key. If it is missing but a
	 * legacy `void.*` value exists (a Void user upgrading to Ribix), migrate
	 * that value into the `ribix.*` key once and then treat `ribix.*` as
	 * canonical from then on. Returns the migrated value, or undefined if no
	 * value exists under either key.
	 */
	private _migrateKey(ribixKey: string, legacyVoidKey: string, target: StorageTarget): string | undefined {
		const ribixVal = this._appStorage.get(ribixKey, StorageScope.APPLICATION)
		if (ribixVal !== undefined) return ribixVal

		const legacyVal = this._appStorage.get(legacyVoidKey, StorageScope.APPLICATION)
		if (legacyVal !== undefined) {
			this._appStorage.store(ribixKey, legacyVal, StorageScope.APPLICATION, target)
			return legacyVal
		}
		return undefined
	}


	// this is old, eventually we can just delete this since all the keys will have been transferred over
	// returns 'NULL' or the old key
	private get oldId() {
		// canonical ribix key first, falling back to the legacy void key (one-time migration)
		const migrated = this._migrateKey('ribix.app.oldMachineId', 'void.app.oldMachineId', StorageTarget.MACHINE)
		if (migrated) return migrated

		// otherwise seed from the original Void machineId (the oldest legacy key, READ-only) and persist under ribix.*
		const oldValue = this._appStorage.get('void.machineId', StorageScope.APPLICATION) ?? 'NULL'
		this._appStorage.store('ribix.app.oldMachineId', oldValue, StorageScope.APPLICATION, StorageTarget.MACHINE)
		return oldValue
	}


	// the main id
	private get distinctId() {
		// migrate any legacy void.app.machineId into the canonical ribix key
		const migrated = this._migrateKey('ribix.app.machineId', 'void.app.machineId', StorageTarget.MACHINE)
		if (migrated) return migrated

		// no existing id under either namespace — seed from oldId if present, else fresh uuid
		const oldId = this.oldId
		const setValIfNotExist = oldId === 'NULL' ? undefined : oldId
		return this._memoStorage('ribix.app.machineId', StorageTarget.MACHINE, setValIfNotExist)
	}

	// just to see if there are ever multiple machineIDs per userID (instead of this, we should just track by the user's email)
	private get userId() {
		const migrated = this._migrateKey('ribix.app.userMachineId', 'void.app.userMachineId', StorageTarget.USER)
		if (migrated) return migrated
		return this._memoStorage('ribix.app.userMachineId', StorageTarget.USER)
	}

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
	) {
		super()
		this.initialize() // async
	}

	async initialize() {
		// very important to await whenReady!
		await this._appStorage.whenReady

		const { commit, version, ribixVersion, release, quality } = this._productService as any

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

		// custom properties we identify
		this._initProperties = {
			commit,
			vscodeVersion: version,
			ribixVersion: ribixVersion ?? '1.0.0',
			release,
			os,
			quality,
			distinctId: this.distinctId,
			distinctIdUser: this.userId,
			oldId: this.oldId,
			isDevMode,
			...osInfo,
		}

		this._optOut = this._appStorage.getBoolean(OPT_OUT_KEY, StorageScope.APPLICATION, false)

		// Read the API URL from auth storage (set when user signs in).
		try {
			const urlsRaw = this._appStorage.get(RIBIX_AUTH_URLS_KEY, StorageScope.APPLICATION)
			if (urlsRaw) {
				const urls = JSON.parse(urlsRaw) as { apiUrl?: string }
				this._apiUrl = urls.apiUrl ?? null
			}
		} catch {
			// malformed stored value — leave _apiUrl null
		}

		if (process.env['RIBIX_DEBUG_TELEMETRY']) {
			console.log('Ribix telemetry: optOut =', this._optOut, ', apiUrl =', this._apiUrl)
		}
	}

	/**
	 * Send a telemetry event to the Ribix backend.
	 * Fire-and-forget — never blocks the IDE.
	 */
	private async _sendEvent(eventName: string, properties: Record<string, unknown> = {}): Promise<void> {
		if (this._optOut) return
		if (!this._apiUrl) return

		try {
			await fetch(`${this._apiUrl.replace(/\/$/, '')}/api/telemetry/event`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					surface: 'ide',
					event_name: eventName,
					properties: { ...this._initProperties, ...properties },
					session_id: sessionId,
				}),
				signal: AbortSignal.timeout(3000),
			})
		} catch {
			// silent — telemetry must never crash the IDE
		}
	}

	capture: IMetricsService['capture'] = (event, params) => {
		void this._sendEvent(event, params as Record<string, unknown>)
	}

	setOptOut: IMetricsService['setOptOut'] = (newVal: boolean) => {
		this._optOut = newVal
		if (newVal) {
			this._appStorage.store(OPT_OUT_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE)
		}
		else {
			this._appStorage.remove(OPT_OUT_KEY, StorageScope.APPLICATION)
		}
	}

	async getDebuggingProperties() {
		return this._initProperties
	}
}
