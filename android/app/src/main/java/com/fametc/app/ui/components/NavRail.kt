package com.fametc.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors

enum class TabletNavDestination(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    TODAY("Today", Icons.Default.WbSunny),
    CALENDAR("Calendar", Icons.Default.CalendarMonth),
    HOMEWORK("Homework", Icons.Default.MenuBook),
    CHAT("Chat", Icons.Default.ChatBubble),
    TRIPS("Trips", Icons.Default.Flight),
    MEALS("Meals", Icons.Default.Restaurant)
}

@Composable
fun NavRail(
    selectedDestination: TabletNavDestination,
    onDestinationSelected: (TabletNavDestination) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .width(90.dp)
            .fillMaxHeight()
            .background(FamTheme.colors.sidebar)
            .border(width = 1.dp, color = FamTheme.colors.border)
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Brand Mark
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(HorizonColors.signalGradient(FamTheme.colors.isDark)),
                contentAlignment = Alignment.Center
            ) {
                Text("ETC", style = FamTheme.typography.cardTitle, color = Color.White)
            }

            Spacer(modifier = Modifier.height(8.dp))

            TabletNavDestination.values().forEach { destination ->
                val isSelected = selectedDestination == destination
                Column(
                    modifier = Modifier
                        .width(74.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (isSelected) FamTheme.colors.accentSoft else Color.Transparent)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null
                        ) {
                            onDestinationSelected(destination)
                        }
                        .padding(vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = destination.label,
                        tint = if (isSelected) FamTheme.colors.accent else FamTheme.colors.muted,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = destination.label,
                        style = FamTheme.typography.caption,
                        color = if (isSelected) FamTheme.colors.accent else FamTheme.colors.muted
                    )
                }
            }
        }

        // Bottom: Sign Out
        IconButton(
            onClick = onSignOut,
            modifier = Modifier.padding(bottom = 8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Logout,
                contentDescription = "Sign Out",
                tint = FamTheme.colors.muted
            )
        }
    }
}
