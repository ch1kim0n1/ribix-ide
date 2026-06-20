/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt in the project root.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { localize2 } from '../../../../nls.js';
import { aiProviderManager, AIProvider } from './aiProviderManager.js';

export const RIBIX_SWITCH_PROVIDER_ACTION_ID = 'ribix.switchProvider';

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: RIBIX_SWITCH_PROVIDER_ACTION_ID,
            title: localize2('ribixSwitchProvider', 'Ribix: Switch AI Provider'),
            f1: true,
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);

        const providers: Array<{ label: string; description: string; provider: AIProvider }> = [
            { label: 'Anthropic', description: 'Claude models (claude-3-opus, claude-3-sonnet, claude-3-haiku)', provider: 'anthropic' },
            { label: 'OpenAI', description: 'GPT models (gpt-4-turbo, gpt-4, gpt-3.5-turbo)', provider: 'openai' },
            { label: 'Ollama', description: 'Local models (llama3, mistral, codellama) via Ollama', provider: 'ollama' },
            { label: 'Ribix Backend', description: 'Ribix cloud inference (requires sign-in)', provider: 'ribix' },
        ];

        const current = aiProviderManager.getProvider();
        const items = providers.map(p => ({
            label: p.label,
            description: p.description,
            detail: p.provider === current ? '$(check) Currently active' : undefined,
            provider: p.provider,
        }));

        const picked = await quickInputService.pick(items, {
            placeHolder: `Current provider: ${current}. Select a new AI provider.`,
            title: 'Switch AI Provider',
        });

        if (picked) {
            aiProviderManager.setProvider((picked as any).provider);
        }
    }
});
