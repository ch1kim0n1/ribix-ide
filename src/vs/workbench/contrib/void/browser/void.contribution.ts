/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// register Ribix theme colors
import '../common/helpers/ribixTheme.js'

// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './voidSettingsPane.js'

// register css
import './media/void.css'

// update (frontend part, also see platform/)
import './voidUpdateActions.js'

import './convertToLLMMessageWorkbenchContrib.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

// register Thread History
import './chatThreadService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './voidSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './voidOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './voidSCMService.js'

// register Ribix memory service
import './ribixMemoryService.js'

// register Ribix mission service
import './ribixMissionService.js'

// register Ribix agent service
import './ribixAgentService.js'

// register Ribix orchestration service
import './ribixOrchestrationService.js'

// register Ribix checkpoint service
import './ribixCheckpointService.js'

// register Ribix planning service
import './ribixPlanningService.js'

// register Ribix auth service
import './ribixAuthService.js'

// register Ribix backend SSE service (cloud finding sync)
import './ribixBackendSseService.js'

// register Ribix auth actions (Sign In / Sign Out commands + OAuth callback handler)
import './ribixAuthActions.js'

// register Ribix diff annotation widget
import './ribixDiffAnnotationWidget.js'

// register Ribix release actions
import './ribixReleaseActions.js'

// register Ribix Command Center panel
import './ribixCommandCenterPane.js'

// register Ribix auto-on-change watcher (Eager — must listen at startup)
import './ribixChangeWatcherService.js'

// register Ribix auto-trigger toggle command (Command Center)
import './ribixAutoTriggerActions.js'

// register Ribix single-file action (right-click "Run Ribix on this file")
import './ribixFileActionContribution.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// voidSettings
import '../common/voidSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/voidUpdateService.js'

// model service
import '../common/voidModelService.js'

// Ribix services
import '../common/ribixTaskQueueService.js'
import '../common/ribixFileLockService.js'
