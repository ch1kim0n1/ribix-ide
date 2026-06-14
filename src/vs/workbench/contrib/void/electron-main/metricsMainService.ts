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

	// helper - looks like this is stored in a .vscdb file in ~/Library/Application Support/Void
	private _memoStorage(key: string, target: StorageTarget, setValIfNotExist?: string) {
		const currVal = this._appStorage.get(key, StorageScope.APPLICATION)
		if (currVal !== undefined) return currVal
		const newVal = setValIfNotExist ?? generateUuid()
		this._appStorage.store(key, newVal, StorageScope.APPLICATION, target)
		return newVal
	}


	// this is old, eventually we can just delete this since all the keys will have been transferred over
	// returns 'NULL' or the old key
	private get oldId() {
		// check new storage key first
		const newKey = 'void.app.oldMachineId'
		const newOldId = this._appStorage.get(newKey, StorageScope.APPLICATION)
		if (newOldId) return newOldId

		// put old key into new key if didn't already
		const oldValue = this._appStorage.get('void.machineId', StorageScope.APPLICATION) ?? 'NULL' // the old way of getting the key
		this._appStorage.store(newKey, oldValue, StorageScope.APPLICATION, StorageTarget.MACHINE)
		return oldValue

		// in a few weeks we can replace above with this
		// private get oldId() {
		// 	return this._memoStorage('void.app.oldMachineId', StorageTarget.MACHINE, 'NULL')
		// }
	}


	// the main id
	private get distinctId() {
		const oldId = this.oldId
		const setValIfNotExist = oldId === 'NULL' ? undefined : oldId
		return this._memoStorage('void.app.machineId', StorageTarget.MACHINE, setValIfNotExist)
	}

	// just to see if there are ever multiple machineIDs per userID (instead of this, we should just track by the user's email)
	private get userId() {
		return this._memoStorage('void.app.userMachineId', StorageTarget.USER)
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
