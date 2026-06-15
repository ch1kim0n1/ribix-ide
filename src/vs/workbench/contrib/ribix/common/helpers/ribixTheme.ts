/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Ribix Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';

// Ribix color definitions
const ribixBgPrimary = new Color(new RGBA(1, 49, 31)); // #01311F
const ribixGold = new Color(new RGBA(198, 170, 88)); // #C6AA58
const ribixGoldDark = new Color(new RGBA(168, 137, 58)); // #A8893A
const ribixTextPrimary = new Color(new RGBA(245, 240, 232)); // #F5F0E8
const ribixTextSecondary = new Color(new RGBA(138, 158, 138)); // #8A9E8A
const ribixSuccess = new Color(new RGBA(45, 122, 79)); // #2D7A4F
const ribixWarning = new Color(new RGBA(212, 130, 10)); // #D4820A
const ribixError = new Color(new RGBA(194, 59, 34)); // #C23B22
const ribixBorder = new Color(new RGBA(30, 74, 50)); // #1E4A32

const configOfColor = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color }
}

// Register Activity Bar color overrides
registerColor('activityBar.background', configOfColor(ribixBgPrimary), 'Activity Bar background color', true);
registerColor('activityBar.foreground', configOfColor(ribixTextPrimary), 'Activity Bar foreground color', true);
registerColor('activityBar.inactiveForeground', configOfColor(ribixTextSecondary), 'Activity Bar inactive foreground color', true);
registerColor('activityBar.activeBorder', configOfColor(ribixGold), 'Activity Bar active item border', true);
registerColor('activityBar.activeBackground', configOfColor(ribixGoldDark), 'Activity Bar active item background', true);

// Register sidebar colors to match
registerColor('sideBar.background', configOfColor(ribixBgPrimary), 'Sidebar background color', true);
registerColor('sideBar.foreground', configOfColor(ribixTextPrimary), 'Sidebar foreground color', true);
registerColor('sideBar.border', configOfColor(ribixBorder), 'Sidebar border color', true);

// Register status indicator colors
registerColor('statusBarItem.errorBackground', configOfColor(ribixError), 'Status bar error item background', true);
registerColor('statusBarItem.warningBackground', configOfColor(ribixWarning), 'Status bar warning item background', true);
registerColor('terminal.ansiGreen', configOfColor(ribixSuccess), 'Terminal ANSI green color', true);