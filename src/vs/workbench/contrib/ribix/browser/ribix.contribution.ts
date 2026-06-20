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
import './ribixSettingsPane.js'

// register css
import './media/ribix.css'

// update (frontend part, also see platform/)
import './ribixUpdateActions.js'

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

// file watcher for auto-trigger (G-AUTOTRIGGER)
import './ribixFileWatcherService.js'

// register selection helper
import './ribixSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './ribixOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './ribixSCMService.js'

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

// register Ribix file lock manager UI (status bar + showFileLocks command)
import './fileLockManager.js'

// register Ribix provider switch command
import './ribixProviderActions.js'

// register Ribix single-file action (right-click "Run Ribix on this file")
import './ribixFileActionContribution.js'

// register extension compatibility commands
import './extensionCompatibilityCommands.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// ribixSettings
import '../common/ribixSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/ribixUpdateService.js'

// model service
import '../common/ribixModelService.js'

// Ribix services
import '../common/ribixTaskQueueService.js'
import '../common/ribixFileLockService.js'

// register Ribix mission collaboration (#45)
import './missionCollaboration.js'

// register Ribix mission templates (#46)
import './missionTemplates.js'

// register Ribix mission replay command (ribix.replayMission)
import './ribixReplayActions.js'

// register Ribix CI/CD trigger integration (GitHub Actions failure → repair mission)
import './ciIntegration.js'

// register Ribix unified findings provider (backend + mission merge, SSE, filter toggle)
import './unifiedFindingsProvider.js'

// register Ribix fix memory service (cross-mission learning, fix reuse suggestions)
import './fixMemory.js'
