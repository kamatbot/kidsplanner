package com.fametc.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.fametc.app.ui.theme.FamTheme

enum class MainTab(val label: String, val icon: ImageVector) {
    TODAY("Today", Icons.Default.WbSunny),
    CALENDAR("Calendar", Icons.Default.CalendarMonth),
    HOMEWORK("Homework", Icons.Default.MenuBook),
    CHAT("Chat", Icons.Default.ChatBubble),
    PLANNING("Planning", Icons.Default.Flight)
}

enum class PlanningSubTab(val label: String, val icon: ImageVector) {
    TRIPS("Trips", Icons.Default.Flight),
    MEALS("Meals", Icons.Default.Restaurant)
}

@Composable
fun FloatingTabBar(
    selectedTab: MainTab,
    selectedPlanningSubTab: PlanningSubTab,
    onTabSelected: (MainTab) -> Unit,
    onPlanningSubTabSelected: (PlanningSubTab) -> Unit,
    modifier: Modifier = Modifier
) {
    var showPlanningMenu by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            modifier = Modifier
                .shadow(12.dp, RoundedCornerShape(32.dp), spotColor = Color(0x33000000))
                .clip(RoundedCornerShape(32.dp))
                .background(FamTheme.colors.panel.copy(alpha = 0.95f))
                .border(1.dp, FamTheme.colors.border, RoundedCornerShape(32.dp))
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            MainTab.values().forEach { tab ->
                val isSelected = selectedTab == tab
                val icon = if (tab == MainTab.PLANNING) {
                    if (selectedPlanningSubTab == PlanningSubTab.MEALS) Icons.Default.Restaurant else Icons.Default.Flight
                } else {
                    tab.icon
                }
                val label = if (tab == MainTab.PLANNING) selectedPlanningSubTab.label else tab.label

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(24.dp))
                        .background(if (isSelected) FamTheme.colors.accentSoft else Color.Transparent)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null
                        ) {
                            if (tab == MainTab.PLANNING) {
                                if (selectedTab == MainTab.PLANNING) {
                                    showPlanningMenu = true
                                } else {
                                    onTabSelected(MainTab.PLANNING)
                                }
                            } else {
                                onTabSelected(tab)
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = icon,
                            contentDescription = label,
                            tint = if (isSelected) FamTheme.colors.accent else FamTheme.colors.muted,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = label,
                            style = FamTheme.typography.caption,
                            color = if (isSelected) FamTheme.colors.accent else FamTheme.colors.muted
                        )
                    }

                    // Dropdown for Planning destination
                    if (tab == MainTab.PLANNING) {
                        DropdownMenu(
                            expanded = showPlanningMenu,
                            onDismissRequest = { showPlanningMenu = false },
                            modifier = Modifier.background(FamTheme.colors.panel)
                        ) {
                            DropdownMenuItem(
                                text = { Text("Trips", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.Flight, contentDescription = null) },
                                onClick = {
                                    onPlanningSubTabSelected(PlanningSubTab.TRIPS)
                                    onTabSelected(MainTab.PLANNING)
                                    showPlanningMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Meals", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.Restaurant, contentDescription = null) },
                                onClick = {
                                    onPlanningSubTabSelected(PlanningSubTab.MEALS)
                                    onTabSelected(MainTab.PLANNING)
                                    showPlanningMenu = false
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
