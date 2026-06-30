/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ribixVmService.ts (#104, #105)
 *
 * Thin renderer-side client for the backend ephemeral-VM lifecycle and the
 * login-handoff flow. It owns no compute itself — it boots/stops an isolated VM
 * through the Ribix backend and exposes the VM's noVNC stream URL so the IDE can
 * embed it in a webview/iframe. It also surfaces login-handoff state so the UI can
 * pause the agent, show the user a login URL, and resume once login is done.
 *
 * Backend contract (assumed per #104 / #105 RFC 0001 §4.3, §8.3):
 *   POST /api/v1/vm/boot      -> { vmId, status, vncUrl? }
 *   POST /api/v1/vm/{id}/stop -> { vmId, status }
 *   GET  /api/v1/vm/{id}      -> { vmId, status, vncUrl? }
 *   GET  /api/v1/handoff?vmId={id} -> { pending, loginUrl? }   (login-handoff probe)
 *   POST /api/v1/handoff/{id}/resume -> { resumed }            (user finished login)
 *
 * Auth/base-URL come from IRibixAuthService.getRequiredConfig() — same contract the
 * rest of the IDE uses to reach the backend.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRibixAuthService } from './ribixAuthService.js';
import { RibixConfig } from '../common/ribixAuthTypes.js';

export type VmStatus = 'off' | 'booting' | 'running' | 'stopping' | 'error';

export interface VmState {
	status: VmStatus;
	vmId: string | null;
	/** noVNC viewer URL to embed once the VM is running. */
	vncUrl: string | null;
	error: string | null;
}

/** Login-handoff state (#105): set when a run hits an auth wall the agent can't pass. */
export interface HandoffState {
	pending: boolean;
	/** URL to open (isolated browser / noVNC) so the user can complete login. */
	loginUrl: string | null;
}

export interface IRibixVmService {
	readonly _serviceBrand: undefined;

	readonly state: VmState;
	readonly handoff: HandoffState;

	onDidChangeState: Event<VmState>;
	onDidChangeHandoff: Event<HandoffState>;

	/** #104: Boot an isolated VM. Resolves once the backend reports it booting/running. */
	bootVm(): Promise<VmState>;
	/** #104: Stop the current VM (no-op if none). */
	stopVm(): Promise<VmState>;
	/** #104: Re-poll the backend for the current VM status (and any pending handoff). */
	refresh(): Promise<VmState>;

	/** #105: Mark a pending login-handoff (called when the agent reports an auth wall). */
	requestLoginHandoff(loginUrl: string): void;
	/** #105: User finished login — tell the backend to resume the paused run. */
	resumeAfterLogin(): Promise<void>;
}

export const IRibixVmService = createDecorator<IRibixVmService>('ribixVmService');

export class RibixVmService extends Disposable implements IRibixVmService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<VmState>());
	readonly onDidChangeState = this._onDidChangeState.event;
	private readonly _onDidChangeHandoff = this._register(new Emitter<HandoffState>());
	readonly onDidChangeHandoff = this._onDidChangeHandoff.event;

	private _state: VmState = { status: 'off', vmId: null, vncUrl: null, error: null };
	private _handoff: HandoffState = { pending: false, loginUrl: null };

	get state(): VmState { return this._state; }
	get handoff(): HandoffState { return this._handoff; }

	constructor(
		@IRibixAuthService private readonly authService: IRibixAuthService,
	) {
		super();
	}

	private setState(next: Partial<VmState>): VmState {
		this._state = { ...this._state, ...next };
		this._onDidChangeState.fire(this._state);
		return this._state;
	}

	private setHandoff(next: Partial<HandoffState>): void {
		this._handoff = { ...this._handoff, ...next };
		this._onDidChangeHandoff.fire(this._handoff);
	}

	/** Backend call with auth + single-401-retry, reusing the IDE's auth contract. */
	private request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
		return this.authService.requestWithAuth(async (config: RibixConfig) => {
			const res = await fetch(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
				method,
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.accessToken}` },
			});
			if (!res.ok) {
				throw new Error(`VM request ${method} ${path} failed: ${res.status}`);
			}
			return (await res.json()) as T;
		});
	}

	async bootVm(): Promise<VmState> {
		this.setState({ status: 'booting', error: null });
		try {
			const r = await this.request<{ vmId: string; status: VmStatus; vncUrl?: string }>('POST', '/api/v1/vm/boot');
			return this.setState({ status: r.status ?? 'running', vmId: r.vmId, vncUrl: r.vncUrl ?? null });
		} catch (e) {
			return this.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
		}
	}

	async stopVm(): Promise<VmState> {
		if (!this._state.vmId) {
			return this.setState({ status: 'off', vncUrl: null });
		}
		this.setState({ status: 'stopping' });
		try {
			await this.request<{ status: VmStatus }>('POST', `/api/v1/vm/${encodeURIComponent(this._state.vmId)}/stop`);
		} catch (e) {
			return this.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
		}
		// VM gone — clear any pending handoff tied to it.
		this.setHandoff({ pending: false, loginUrl: null });
		return this.setState({ status: 'off', vmId: null, vncUrl: null, error: null });
	}

	async refresh(): Promise<VmState> {
		if (!this._state.vmId) { return this._state; }
		try {
			const r = await this.request<{ status: VmStatus; vncUrl?: string }>('GET', `/api/v1/vm/${encodeURIComponent(this._state.vmId)}`);
			return this.setState({ status: r.status, vncUrl: r.vncUrl ?? this._state.vncUrl });
		} catch (e) {
			return this.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
		}
	}

	requestLoginHandoff(loginUrl: string): void {
		this.setHandoff({ pending: true, loginUrl });
	}

	async resumeAfterLogin(): Promise<void> {
		if (!this._state.vmId) {
			this.setHandoff({ pending: false, loginUrl: null });
			return;
		}
		await this.request<{ resumed: boolean }>('POST', `/api/v1/handoff/${encodeURIComponent(this._state.vmId)}/resume`);
		this.setHandoff({ pending: false, loginUrl: null });
	}
}

registerSingleton(IRibixVmService, RibixVmService, InstantiationType.Delayed);
