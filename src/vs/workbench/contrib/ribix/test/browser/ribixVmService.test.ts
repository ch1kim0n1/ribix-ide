/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { RibixVmService } from '../../browser/ribixVmService.js';
import { IRibixAuthService } from '../../browser/ribixAuthService.js';

// Stub auth service: requestWithAuth just hands a fake config to the request fn.
function makeService(handler: (method: string, path: string) => unknown): RibixVmService {
	const auth = {
		requestWithAuth: async (request: (config: any) => Promise<any>) => {
			(globalThis as any).fetch = async (url: string, init: any) => ({
				ok: true,
				json: async () => handler(init.method, new URL(url).pathname),
			});
			return request({ apiUrl: 'https://api.test', accessToken: 'tok' });
		},
	} as unknown as IRibixAuthService;
	return new RibixVmService(auth);
}

suite('ribixVmService — lifecycle + handoff', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('bootVm transitions off -> running and stores vncUrl', async () => {
		const svc = makeService(() => ({ vmId: 'vm1', status: 'running', vncUrl: 'https://vnc.test/vm1' }));
		const s = await svc.bootVm();
		assert.strictEqual(s.status, 'running');
		assert.strictEqual(s.vmId, 'vm1');
		assert.strictEqual(s.vncUrl, 'https://vnc.test/vm1');
		svc.dispose();
	});

	test('stopVm clears vm + pending handoff', async () => {
		const svc = makeService(() => ({ vmId: 'vm1', status: 'running' }));
		await svc.bootVm();
		svc.requestLoginHandoff('https://login.test');
		assert.strictEqual(svc.handoff.pending, true);
		const s = await svc.stopVm();
		assert.strictEqual(s.status, 'off');
		assert.strictEqual(s.vmId, null);
		assert.strictEqual(svc.handoff.pending, false);
		svc.dispose();
	});

	test('resumeAfterLogin clears handoff', async () => {
		const svc = makeService(() => ({ vmId: 'vm1', status: 'running', resumed: true }));
		await svc.bootVm();
		svc.requestLoginHandoff('https://login.test');
		await svc.resumeAfterLogin();
		assert.strictEqual(svc.handoff.pending, false);
		assert.strictEqual(svc.handoff.loginUrl, null);
		svc.dispose();
	});
});
