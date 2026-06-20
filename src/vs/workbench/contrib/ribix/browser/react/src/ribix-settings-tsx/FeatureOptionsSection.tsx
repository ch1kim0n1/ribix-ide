/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { displayInfoOfFeatureName } from '../../../../common/ribixSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { RibixSwitch, RibixSimpleInputBox } from '../util/inputs.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import { ToolApprovalTypeSwitch, FastApplyMethodDropdown } from './Settings.js'

export const FeatureOptionsSection = () => {
	const settingsState = useSettingsState()
	const accessor = useAccessor()
	const ribixSettingsService = accessor.get('IRibixSettingsService')

	return (
		<div className='flex flex-col gap-y-8 my-4'>
			<ErrorBoundary>
				{/* FIM */}
				<div>
					<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
					<div className='text-sm text-ribix-fg-3 mt-1'>
						<span>
							Experimental.{' '}
						</span>
						<span
							className='hover:brightness-110'
							data-tooltip-id='ribix-tooltip'
							data-tooltip-content='We recommend using the largest qwen2.5-coder model you can with Ollama (try qwen2.5-coder:3b).'
							data-tooltip-class-name='ribix-max-w-[20px]'
						>
							Only works with FIM models.*
						</span>
					</div>

					<div className='my-2'>
						{/* Enable Switch */}
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<RibixSwitch
									size='xs'
									value={settingsState.globalSettings.enableAutocomplete}
									onChange={(newVal) => ribixSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
								/>
								<span className='text-ribix-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}</span>
							</div>
						</ErrorBoundary>

						{/* Model Dropdown */}
						<ErrorBoundary>
							<div className={`my-2 ${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
								<ModelDropdown featureName={'Autocomplete'} className='text-xs text-ribix-fg-3 bg-ribix-bg-1 border border-ribix-border-1 rounded p-0.5 px-1' />
							</div>
						</ErrorBoundary>

					</div>

				</div>
			</ErrorBoundary>

			{/* Apply */}
			<ErrorBoundary>

				<div className='w-full'>
					<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
					<div className='text-sm text-ribix-fg-3 mt-1'>Settings that control the behavior of the Apply button.</div>

					<div className='my-2'>
						{/* Sync to Chat Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<RibixSwitch
								size='xs'
								value={settingsState.globalSettings.syncApplyToChat}
								onChange={(newVal) => ribixSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
							/>
							<span className='text-ribix-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}</span>
						</div>

						{/* Model Dropdown */}
						<div className={`my-2 ${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
							<ModelDropdown featureName={'Apply'} className='text-xs text-ribix-fg-3 bg-ribix-bg-1 border border-ribix-border-1 rounded p-0.5 px-1' />
						</div>
					</div>


					<div className='my-2'>
						{/* Fast Apply Method Dropdown */}
						<div className='flex items-center gap-x-2 my-2'>
							<FastApplyMethodDropdown />
						</div>
					</div>

				</div>
			</ErrorBoundary>




			{/* Tools Section */}
			<div>
				<h4 className={`text-base`}>Tools</h4>
				<div className='text-sm text-ribix-fg-3 mt-1'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

				<div className='my-2'>
					{/* Auto Accept Switch */}
					<ErrorBoundary>
						{[...toolApprovalTypes].map((approvalType) => {
							return <div key={approvalType} className="flex items-center gap-x-2 my-2">
								<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
							</div>
						})}

					</ErrorBoundary>

					{/* Tool Lint Errors Switch */}
					<ErrorBoundary>

						<div className='flex items-center gap-x-2 my-2'>
							<RibixSwitch
								size='xs'
								value={settingsState.globalSettings.includeToolLintErrors}
								onChange={(newVal) => ribixSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
							/>
							<span className='text-ribix-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.includeToolLintErrors ? 'Fix lint errors' : `Fix lint errors`}</span>
						</div>
					</ErrorBoundary>

					{/* Auto Accept LLM Changes Switch */}
					<ErrorBoundary>
						<div className='flex items-center gap-x-2 my-2'>
							<RibixSwitch
								size='xs'
								value={settingsState.globalSettings.autoAcceptLLMChanges}
								onChange={(newVal) => ribixSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)}
							/>
							<span className='text-ribix-fg-3 text-xs pointer-events-none'>Auto-accept LLM changes</span>
						</div>
					</ErrorBoundary>
				</div>
			</div>



			<div className='w-full'>
				<h4 className={`text-base`}>Editor</h4>
				<div className='text-sm text-ribix-fg-3 mt-1'>{`Settings that control the visibility of Ribix IDE suggestions in the code editor.`}</div>

				<div className='my-2'>
					{/* Auto Accept Switch */}
					<ErrorBoundary>
						<div className='flex items-center gap-x-2 my-2'>
							<RibixSwitch
								size='xs'
								value={settingsState.globalSettings.showInlineSuggestions}
								onChange={(newVal) => ribixSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
							/>
							<span className='text-ribix-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}</span>
						</div>
					</ErrorBoundary>
				</div>
			</div>

			{/* SCM */}
			<ErrorBoundary>

				<div className='w-full'>
					<h4 className={`text-base`}>{displayInfoOfFeatureName('SCM')}</h4>
					<div className='text-sm text-ribix-fg-3 mt-1'>Settings that control the behavior of the commit message generator.</div>

					<div className='my-2'>
						{/* Sync to Chat Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<RibixSwitch
								size='xs'
								value={settingsState.globalSettings.syncSCMToChat}
								onChange={(newVal) => ribixSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
							/>
							<span className='text-ribix-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncSCMToChat ? 'Same as Chat model' : 'Different model'}</span>
						</div>

						{/* Model Dropdown */}
						<div className={`my-2 ${settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}`}>
							<ModelDropdown featureName={'SCM'} className='text-xs text-ribix-fg-3 bg-ribix-bg-1 border border-ribix-border-1 rounded p-0.5 px-1' />
						</div>
					</div>

				</div>
			</ErrorBoundary>
		</div>
	)
}
