/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';

import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { mountCommandCenter } from './react/out/command-center-tsx/index.js';

import { Codicon } from '../../../../base/common/codicons.js';
import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// ---------- Define viewpane ----------

class CommandCenterViewPane extends ViewPane {

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService)
	}



	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.userSelect = 'text'

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn: (() => void) | undefined = mountCommandCenter(parent, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()))
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width)
		this.element.style.height = `${height}px`
		this.element.style.width = `${width}px`
	}

}



// ---------- Register viewpane inside the ribix container ----------

export const RIBIX_COMMAND_CENTER_VIEW_CONTAINER_ID = 'workbench.view.ribixCommandCenter'
export const RIBIX_COMMAND_CENTER_VIEW_ID = RIBIX_COMMAND_CENTER_VIEW_CONTAINER_ID

// Register view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const container = viewContainerRegistry.registerViewContainer({
	id: RIBIX_COMMAND_CENTER_VIEW_CONTAINER_ID,
	title: nls.localize2('ribixCommandCenter', 'Command Center'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [RIBIX_COMMAND_CENTER_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.HORIZONTAL,
	}]),
	hideIfEmpty: false,
	order: 0, // Order 0 to show first in activity bar

	rejectAddedViews: true,
	icon: Codicon.symbolRuler,


}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true, isDefault: true });



// Register view inside the container
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{
	id: RIBIX_COMMAND_CENTER_VIEW_ID,
	hideByDefault: false,
	name: nls.localize2('ribixCommandCenterView', ''),
	ctorDescriptor: new SyncDescriptor(CommandCenterViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	weight: 100,
	order: 1,
}], container);


// open sidebar
export const RIBIX_COMMAND_CENTER_OPEN_ACTION_ID = 'ribixCommandCenter.open'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RIBIX_COMMAND_CENTER_OPEN_ACTION_ID,
			title: 'Open Ribix Command Center',
		})
	}
	run(accessor: ServicesAccessor): void {
		const viewsService = accessor.get(IViewsService)
		viewsService.openViewContainer(RIBIX_COMMAND_CENTER_VIEW_CONTAINER_ID);
	}
});

export class CommandCenterStartContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.startupRibixCommandCenter';
	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		this.commandService.executeCommand(RIBIX_COMMAND_CENTER_OPEN_ACTION_ID)
	}
}
registerWorkbenchContribution2(CommandCenterStartContribution.ID, CommandCenterStartContribution, WorkbenchPhase.AfterRestored);