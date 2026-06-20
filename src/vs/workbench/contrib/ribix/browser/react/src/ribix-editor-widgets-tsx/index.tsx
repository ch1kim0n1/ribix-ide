/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { RibixCommandBarMain } from './RibixCommandBar.js'
import { RibixSelectionHelperMain } from './RibixSelectionHelper.js'

export const mountRibixCommandBar = mountFnGenerator(RibixCommandBarMain)

export const mountRibixSelectionHelper = mountFnGenerator(RibixSelectionHelperMain)

