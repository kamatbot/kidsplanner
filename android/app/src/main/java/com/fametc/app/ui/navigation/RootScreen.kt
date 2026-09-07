package com.fametc.app.ui.navigation

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.ui.components.*
import com.fametc.app.ui.features.calendar.CalendarScreen
import com.fametc.app.ui.features.chat.ChatScreen
import com.fametc.app.ui.features.homework.HomeworkScreen
import com.fametc.app.ui.features.notes.NotesScreen
import com.fametc.app.ui.features.planning.MealsScreen
import com.fametc.app.ui.features.planning.TripsScreen
import com.fametc.app.ui.features.today.TodayScreen
import com.fametc.app.ui.theme.FamTheme

@Composable
fun RootScreen(
    onSignOut: () -> Unit
) {
    val repository = FamEtcApp.instance.repository
    val kidRequests by repository.kidRequests.collectAsState()
    val needsAuth by repository.needsAuth.collectAsState()

    val configuration = LocalConfiguration.current
    val isTablet = configuration.screenWidthDp >= 600

    var selectedTab by remember { mutableStateOf(MainTab.TODAY) }
    var selectedPlanningSubTab by remember { mutableStateOf(PlanningSubTab.TRIPS) }
    var tabletDestination by remember { mutableStateOf(TabletNavDestination.TODAY) }

    // Secondary sub-screen navigation (e.g. Notes, Settings, Goals)
    var currentSubScreen by remember { mutableStateOf<String?>(null) }

    // Cold start data load
    LaunchedEffect(Unit) {
        repository.load()
    }

    Scaffold(
        containerColor = FamTheme.colors.bg
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Parent Kid Approval Banner (pinned to top)
            if (repository.isParent) {
                KidApprovalBanner(
                    requests = kidRequests,
                    onApprove = { repository.approveKidRequest(it) },
                    onDeny = { repository.denyKidRequest(it) }
                )
            }

            // Session Expired Overlay Banner
            if (needsAuth) {
                Surface(
                    color = FamTheme.colors.coral,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Your session expired. Please sign in again.",
                            style = FamTheme.typography.caption,
                            color = androidx.compose.ui.graphics.Color.White
                        )
                        TextButton(onClick = onSignOut) {
                            Text("Sign In", color = androidx.compose.ui.graphics.Color.White, style = FamTheme.typography.label)
                        }
                    }
                }
            }

            // Main Workspace (Tablet Rail vs Phone Floating Tabs)
            if (currentSubScreen != null) {
                // Secondary Full-Screen (Notes or Hybrid Web)
                if (currentSubScreen == "notes") {
                    NotesScreen(onBack = { currentSubScreen = null })
                } else {
                    // Secondary WebView for Settings, Goals, Activities
                    SecondaryWebScreen(
                        path = currentSubScreen!!,
                        onBack = { currentSubScreen = null }
                    )
                }
            } else if (isTablet) {
                // Tablet Layout: NavRail on Left, Content on Right
                Row(modifier = Modifier.fillMaxSize()) {
                    NavRail(
                        selectedDestination = tabletDestination,
                        onDestinationSelected = { dest ->
                            tabletDestination = dest
                        },
                        onSignOut = onSignOut
                    )
                    Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                        when (tabletDestination) {
                            TabletNavDestination.TODAY -> TodayScreen(
                                onOpenHomework = { tabletDestination = TabletNavDestination.HOMEWORK },
                                onOpenNotes = { currentSubScreen = "notes" },
                                onOpenSecondaryWeb = { path -> currentSubScreen = path },
                                onSignOut = onSignOut
                            )
                            TabletNavDestination.CALENDAR -> CalendarScreen()
                            TabletNavDestination.HOMEWORK -> HomeworkScreen()
                            TabletNavDestination.CHAT -> ChatScreen()
                            TabletNavDestination.TRIPS -> TripsScreen()
                            TabletNavDestination.MEALS -> MealsScreen()
                        }
                    }
                }
            } else {
                // Phone Layout: Content with Floating Bottom Tab Bar
                Box(modifier = Modifier.fillMaxSize()) {
                    when (selectedTab) {
                        MainTab.TODAY -> TodayScreen(
                            onOpenHomework = { selectedTab = MainTab.HOMEWORK },
                            onOpenNotes = { currentSubScreen = "notes" },
                            onOpenSecondaryWeb = { path -> currentSubScreen = path },
                            onSignOut = onSignOut
                        )
                        MainTab.CALENDAR -> CalendarScreen()
                        MainTab.HOMEWORK -> HomeworkScreen()
                        MainTab.CHAT -> ChatScreen()
                        MainTab.PLANNING -> {
                            when (selectedPlanningSubTab) {
                                PlanningSubTab.TRIPS -> TripsScreen()
                                PlanningSubTab.MEALS -> MealsScreen()
                            }
                        }
                    }

                    FloatingTabBar(
                        selectedTab = selectedTab,
                        selectedPlanningSubTab = selectedPlanningSubTab,
                        onTabSelected = { selectedTab = it },
                        onPlanningSubTabSelected = { selectedPlanningSubTab = it },
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }
            }
        }
    }
}

@Composable
private fun SecondaryWebScreen(
    path: String,
    onBack: () -> Unit
) {
    val title = when {
        path.contains("settings") -> "Settings"
        path.contains("goals") -> "Goals"
        path.contains("activities") -> "Activities"
        else -> "Fam ETC"
    }

    Scaffold(
        containerColor = FamTheme.colors.bg,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(FamTheme.colors.panel)
                    .border(1.dp, FamTheme.colors.border)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = FamTheme.colors.text)
                }
                Text(title, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            HybridWebView(path = path, isEmbedded = true)
        }
    }
}
