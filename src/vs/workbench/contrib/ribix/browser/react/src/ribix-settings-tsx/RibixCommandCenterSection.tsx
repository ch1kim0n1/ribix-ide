/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { RibixSwitch, RibixSimpleInputBox } from '../util/inputs.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { AuthStatusSection } from './Settings.js'

export const RibixCommandCenterSection = () => {
	const settingsState = useSettingsState()
	const accessor = useAccessor()
	const ribixSettingsService = accessor.get('IRibixSettingsService')

	return (
		<div className='flex flex-col gap-y-8 my-4'>
			{/* Auth Status */}
			<ErrorBoundary>
				<AuthStatusSection />
			</ErrorBoundary>

			<div className='flex flex-col gap-y-8 my-4'>
				{/* Mission Configuration */}
				<div>
					<h4 className={`text-base`}>Mission Configuration</h4>
					<div className='text-sm text-ribix-fg-3 mt-1'>Settings for mission execution and agent management.</div>

					<div className='my-2'>
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<span className='text-ribix-fg-3 text-xs w-48'>Max Concurrent Missions</span>
								<RibixSimpleInputBox
									className='w-24'
									type='number'
									value={settingsState.globalSettings.ribix.maxConcurrentMissions.toString()}
									onChange={(newVal) => {
										const numVal = parseInt(newVal);
										if (!isNaN(numVal) && numVal > 0) {
											ribixSettingsService.setGlobalSetting('ribix', {
												...settingsState.globalSettings.ribix,
												maxConcurrentMissions: numVal
											});
										}
									}}
								/>
							</div>
						</ErrorBoundary>
					</div>

					<div className='my-2'>
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<span className='text-ribix-fg-3 text-xs w-48'>Max Agents Per Mission</span>
								<RibixSimpleInputBox
									className='w-24'
									type='number'
									value={settingsState.globalSettings.ribix.maxAgentsPerMission.toString()}
									onChange={(newVal) => {
										const numVal = parseInt(newVal);
										if (!isNaN(numVal) && numVal > 0) {
											ribixSettingsService.setGlobalSetting('ribix', {
												...settingsState.globalSettings.ribix,
												maxAgentsPerMission: numVal
											});
										}
									}}
								/>
							</div>
						</ErrorBoundary>
					</div>
				</div>

				{/* Behavior Settings */}
				<div>
					<h4 className={`text-base`}>Behavior</h4>
					<div className='text-sm text-ribix-fg-3 mt-1'>Control Ribix Command Center behavior and synchronization.</div>

					<div className='my-2'>
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<RibixSwitch
									size='xs'
									value={settingsState.globalSettings.ribix.autoOpenCommandCenter}
									onChange={(newVal) => {
										ribixSettingsService.setGlobalSetting('ribix', {
											...settingsState.globalSettings.ribix,
											autoOpenCommandCenter: newVal
										});
									}}
								/>
								<span className='text-ribix-fg-3 text-xs pointer-events-none'>Auto-open Command Center on startup</span>
							</div>
						</ErrorBoundary>
					</div>

					<div className='my-2'>
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<RibixSwitch
									size='xs'
									value={settingsState.globalSettings.ribix.orgSyncEnabled}
									onChange={(newVal) => {
										ribixSettingsService.setGlobalSetting('ribix', {
											...settingsState.globalSettings.ribix,
											orgSyncEnabled: newVal
										});
									}}
								/>
								<span className='text-ribix-fg-3 text-xs pointer-events-none'>Sync memory to org on mission complete</span>
							</div>
						</ErrorBoundary>
					</div>

					<div className='my-2'>
						<ErrorBoundary>
							<div className='flex items-center gap-x-2 my-2'>
								<RibixSwitch
									size='xs'
									value={settingsState.globalSettings.ribix.checkpointOnEveryWrite}
									onChange={(newVal) => {
										ribixSettingsService.setGlobalSetting('ribix', {
											...settingsState.globalSettings.ribix,
											checkpointOnEveryWrite: newVal
										});
									}}
								/>
								<span className='text-ribix-fg-3 text-xs pointer-events-none'>Checkpoint before every agent file write</span>
							</div>
						</ErrorBoundary>
					</div>
				</div>
			</div>
		</div>
	)
}
