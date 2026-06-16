/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt in the project root.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { localize2 } from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissionTemplate {
	id: string;
	name: string;
	description: string;
	outcomeTemplate: string; // e.g. "Fix the bug in {file} where {description}"
	defaultAgentCount: number;
	tags: string[];
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

export const BUILT_IN_TEMPLATES: MissionTemplate[] = [
	{
		id: 'fix-bug',
		name: 'Fix a bug',
		description: 'Find root cause, write failing test, generate fix',
		outcomeTemplate: 'Fix the bug: {description}',
		defaultAgentCount: 3,
		tags: ['bug'],
	},
	{
		id: 'add-endpoint',
		name: 'Add API endpoint',
		description: 'Scaffold, implement, test, document new endpoint',
		outcomeTemplate: 'Add a {method} endpoint at {path} that {description}',
		defaultAgentCount: 4,
		tags: ['feature'],
	},
	{
		id: 'refactor',
		name: 'Refactor module',
		description: 'Analyze, refactor, verify tests still pass',
		outcomeTemplate: 'Refactor {module} to {goal}',
		defaultAgentCount: 3,
		tags: ['refactor'],
	},
	{
		id: 'write-tests',
		name: 'Write tests',
		description: 'Generate test suite with edge cases',
		outcomeTemplate: 'Write comprehensive tests for {module}',
		defaultAgentCount: 2,
		tags: ['testing'],
	},
];

// ---------------------------------------------------------------------------
// MissionTemplateService
// ---------------------------------------------------------------------------

const CUSTOM_TEMPLATES_STORAGE_KEY = 'ribix.missionTemplates.custom.v1';

export class MissionTemplateService {
	constructor(private readonly storageService: IStorageService) {}

	getAll(): MissionTemplate[] {
		return [...BUILT_IN_TEMPLATES];
	}

	getById(id: string): MissionTemplate | undefined {
		return BUILT_IN_TEMPLATES.find(t => t.id === id);
	}

	/**
	 * Replace template variables like {description} with values from vars.
	 * Unresolved placeholders are left as-is.
	 */
	applyTemplate(template: MissionTemplate, vars: Record<string, string>): string {
		return template.outcomeTemplate.replace(/\{(\w+)\}/g, (match, key) => {
			return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
		});
	}

	/**
	 * Saves a custom team template to VS Code globalStorage.
	 * The id is auto-generated.
	 */
	async saveCustomTemplate(template: Omit<MissionTemplate, 'id'>): Promise<MissionTemplate> {
		const withId: MissionTemplate = { ...template, id: `custom-${generateUuid()}` };
		const existing = await this.getCustomTemplates();
		existing.push(withId);
		this.storageService.store(
			CUSTOM_TEMPLATES_STORAGE_KEY,
			JSON.stringify(existing),
			StorageScope.APPLICATION,
			StorageTarget.USER,
		);
		return withId;
	}

	async getCustomTemplates(): Promise<MissionTemplate[]> {
		try {
			const raw = this.storageService.get(CUSTOM_TEMPLATES_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) { return []; }
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
}

// ---------------------------------------------------------------------------
// Command — ribix.createFromTemplate
// ---------------------------------------------------------------------------

export const RIBIX_CREATE_FROM_TEMPLATE_ACTION_ID = 'ribix.createFromTemplate';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_CREATE_FROM_TEMPLATE_ACTION_ID,
			title: localize2('ribixCreateFromTemplate', 'Ribix: Create Mission from Template'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const storageService = accessor.get(IStorageService);

		const templateService = new MissionTemplateService(storageService);
		const builtIn = templateService.getAll();
		const custom = await templateService.getCustomTemplates();

		const allTemplates = [
			...builtIn.map(t => ({ ...t, _source: 'built-in' as const })),
			...custom.map(t => ({ ...t, _source: 'custom' as const })),
		];

		const items = allTemplates.map(t => ({
			label: t.name,
			description: t._source === 'custom' ? '(custom)' : `${t.defaultAgentCount} agents`,
			detail: `${t.description}  |  Template: ${t.outcomeTemplate}`,
			template: t,
		}));

		const picked = await quickInputService.pick(items, {
			title: 'Create Mission from Template',
			placeHolder: 'Select a template to pre-fill the mission outcome',
		}) as (typeof items[number]) | undefined;

		if (!picked) {
			return;
		}

		// TODO(#46): Open the mission creation panel pre-filled with the selected template's
		// outcomeTemplate. Wire this to the ribixMissionService.createMission() call in the
		// mission panel UI (ribixMissionsPanel.tsx). Pass the template id and outcomeTemplate
		// as initial state so the user can fill in {placeholders} before submitting.
		// For now, show the template's outcome string in the quick input so the user can
		// copy it manually.
		await quickInputService.input({
			title: `New mission from template: ${picked.template.name}`,
			prompt: `Edit the outcome, then copy it to the mission creation panel. (${picked.template.defaultAgentCount} agents recommended)`,
			value: picked.template.outcomeTemplate,
		});
	}
});
