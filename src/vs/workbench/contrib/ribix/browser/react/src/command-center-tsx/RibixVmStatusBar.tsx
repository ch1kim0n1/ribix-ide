/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * RibixVmStatusBar.tsx
 *
 * #104: Status indicator + Boot / Stop / Watch Live controls for the ephemeral
 *       isolated VM. "Watch Live" embeds the VM's noVNC stream in an iframe so the
 *       user can watch the "little computer."
 * #105: Login-handoff prompt — when a run hits an auth wall the agent can't pass,
 *       the service flags it; this surfaces "Log In" (opens the isolated browser /
 *       noVNC) and "Resume" (tells the backend the user finished login).
 *
 * Minimal surface: a compact bar, not a full panel. Reads/writes IRibixVmService.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccessor } from '../util/services.js';
import { IRibixVmService, VmState, HandoffState } from '../../../ribixVmService.js';

const STATUS_COLOR: Record<VmState['status'], string> = {
	off: '#8A9E8A',
	booting: '#C6AA58',
	running: '#3FB950',
	stopping: '#C6AA58',
	error: '#F85149',
};

export const RibixVmStatusBar = () => {
	const accessor = useAccessor();
	const vmService = accessor.get(IRibixVmService) as IRibixVmService;

	const [state, setState] = useState<VmState>(vmService.state);
	const [handoff, setHandoff] = useState<HandoffState>(vmService.handoff);
	const [watching, setWatching] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setState(vmService.state);
		setHandoff(vmService.handoff);
		const d1 = vmService.onDidChangeState(setState);
		const d2 = vmService.onDidChangeHandoff(setHandoff);
		return () => { d1.dispose(); d2.dispose(); };
	}, [vmService]);

	const run = useCallback(async (fn: () => Promise<unknown>) => {
		setBusy(true);
		try { await fn(); } finally { setBusy(false); }
	}, []);

	const isOff = state.status === 'off' || state.status === 'error';

	return (
		<div className="flex flex-col gap-2 px-4 py-2 border-b border-[var(--ribix-border, #1E4A32)]">
			{/* #104: status + lifecycle controls */}
			<div className="flex items-center gap-3">
				<span
					title={state.error ?? state.status}
					style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_COLOR[state.status], flexShrink: 0 }}
				/>
				<span className="text-xs text-[var(--ribix-text-secondary, #8A9E8A)] capitalize">
					Isolated VM: {state.status}
				</span>

				<div className="ml-auto flex items-center gap-2">
					{isOff ? (
						<button
							disabled={busy}
							onClick={() => run(() => vmService.bootVm())}
							className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
							style={{ backgroundColor: 'var(--ribix-gold, #C6AA58)', color: 'var(--ribix-bg-primary, #01311F)' }}
						>
							Boot Isolated Environment
						</button>
					) : (
						<>
							{state.vncUrl && (
								<button
									disabled={busy}
									onClick={() => setWatching(w => !w)}
									className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
									style={{ border: '1px solid var(--ribix-border, #1E4A32)', color: 'var(--ribix-text-primary, #F5F0E8)' }}
								>
									{watching ? 'Hide Live' : 'Watch Live'}
								</button>
							)}
							<button
								disabled={busy}
								onClick={() => run(async () => { setWatching(false); await vmService.stopVm(); })}
								className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
								style={{ border: '1px solid var(--ribix-border, #1E4A32)', color: 'var(--ribix-text-primary, #F5F0E8)' }}
							>
								Stop
							</button>
						</>
					)}
				</div>
			</div>

			{state.error && (
				<p className="text-xs text-red-400">{state.error}</p>
			)}

			{/* #105: login-handoff prompt */}
			{handoff.pending && (
				<div
					className="flex items-center gap-3 px-3 py-2 rounded text-xs"
					style={{ backgroundColor: 'rgba(198,170,88,0.12)', border: '1px solid var(--ribix-gold, #C6AA58)', color: 'var(--ribix-text-primary, #F5F0E8)' }}
				>
					<span className="flex-1">
						Authentication required. Log in to the isolated browser, then resume the run.
					</span>
					{handoff.loginUrl && (
						<a
							href={handoff.loginUrl}
							target="_blank"
							rel="noreferrer"
							className="px-3 py-1 rounded font-medium"
							style={{ backgroundColor: 'var(--ribix-gold, #C6AA58)', color: 'var(--ribix-bg-primary, #01311F)' }}
						>
							Log In
						</a>
					)}
					<button
						disabled={busy}
						onClick={() => run(() => vmService.resumeAfterLogin())}
						className="px-3 py-1 rounded font-medium disabled:opacity-50"
						style={{ border: '1px solid var(--ribix-text-primary, #F5F0E8)', color: 'var(--ribix-text-primary, #F5F0E8)' }}
					>
						Resume
					</button>
				</div>
			)}

			{/* #104: noVNC live view */}
			{watching && state.vncUrl && (
				<iframe
					title="Isolated VM (noVNC)"
					src={state.vncUrl}
					style={{ width: '100%', height: 360, border: '1px solid var(--ribix-border, #1E4A32)', borderRadius: 4, backgroundColor: '#000' }}
				/>
			)}
		</div>
	);
};
