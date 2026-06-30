/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { RibixDiffAnnotationWidget, UxVisionNote } from '../../browser/ribixDiffAnnotationWidget.js';

// --- Minimal stubs the widget constructor depends on (DI decorators are just metadata;
//     constructing directly with positional args bypasses the injector). --------------

function makeWidget(store: DisposableStore): RibixDiffAnnotationWidget {
	const modelService: any = {
		onModelAdded: store.add(new Emitter<any>()).event,
		onModelRemoved: store.add(new Emitter<any>()).event,
		getModel: () => null,
	};
	const languageFeaturesService: any = {
		codeLensProvider: { register: () => ({ dispose() { } }) },
	};
	const webviewWorkbenchService: any = { openWebview: () => ({ webview: { setHtml() { } } }) };
	const agentService: any = {
		onDidChangeAgents: store.add(new Emitter<any>()).event,
		getAgent: () => null,
		getAllKnownAgents: () => [],
	};
	const checkpointService: any = { getCheckpoints: () => [], rollbackFile: async () => { } };

	return store.add(new RibixDiffAnnotationWidget(
		modelService,
		languageFeaturesService,
		webviewWorkbenchService,
		agentService,
		checkpointService,
	));
}

function note(over: Partial<UxVisionNote> = {}): UxVisionNote {
	return {
		missionId: 'm1',
		filePath: '/repo/src/App.tsx',
		line: 10,
		severity: 'medium',
		message: 'Primary button has insufficient contrast against the card background.',
		...over,
	};
}

suite('RibixDiffAnnotationWidget — UX-vision notes (#116)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('addUxVisionNotes stores notes retrievable by mission', () => {
		const store = new DisposableStore();
		const widget = makeWidget(store);

		widget.addUxVisionNotes([note(), note({ missionId: 'm2', filePath: '/repo/src/Other.tsx' })]);

		assert.strictEqual(widget.getUxVisionNotes('m1').length, 1);
		assert.strictEqual(widget.getUxVisionNotes('m2').length, 1);
		assert.strictEqual(widget.getUxVisionNotes().length, 2);

		store.dispose();
	});

	test('a UI-touching change yields a textual critique even without a screenshot (graceful degrade)', () => {
		const store = new DisposableStore();
		const widget = makeWidget(store);

		widget.addUxVisionNotes([note({ screenshotPath: undefined })]);
		const notes = widget.getUxVisionNotes('m1');

		assert.strictEqual(notes.length, 1);
		assert.strictEqual(notes[0].screenshotPath, undefined);
		assert.ok(notes[0].message.length > 0, 'note still carries a textual critique');

		store.dispose();
	});

	test('screenshotPath is preserved when the browser tool captured a region', () => {
		const store = new DisposableStore();
		const widget = makeWidget(store);

		widget.addUxVisionNotes([note({ screenshotPath: '/tmp/ribix-browser/region-1.png', suggestion: 'Darken the card or lighten the label.' })]);
		const notes = widget.getUxVisionNotes('m1');

		assert.strictEqual(notes[0].screenshotPath, '/tmp/ribix-browser/region-1.png');
		assert.strictEqual(notes[0].suggestion, 'Darken the card or lighten the label.');

		store.dispose();
	});

	test('onDidChangeAnnotations fires when UX-vision notes are added', () => {
		const store = new DisposableStore();
		const widget = makeWidget(store);

		let fired = 0;
		store.add(widget.onDidChangeAnnotations(() => fired++));
		widget.addUxVisionNotes([note()]);

		assert.strictEqual(fired, 1);

		store.dispose();
	});

	test('clearUxVisionNotes removes only the targeted mission', () => {
		const store = new DisposableStore();
		const widget = makeWidget(store);

		widget.addUxVisionNotes([note(), note({ missionId: 'm2' })]);
		widget.clearUxVisionNotes('m1');

		assert.strictEqual(widget.getUxVisionNotes('m1').length, 0);
		assert.strictEqual(widget.getUxVisionNotes('m2').length, 1);

		store.dispose();
	});
});
