package com.fametc.app.ui.features.today

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.FamilyAction
import com.fametc.app.data.model.FamilyEvent
import com.fametc.app.data.model.HomeworkItem
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.components.SectionHeader
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun TodayScreen(
    onOpenHomework: () -> Unit,
    onOpenNotes: () -> Unit,
    onOpenSecondaryWeb: (String) -> Unit,
    onSignOut: () -> Unit
) {
    val repository = FamEtcApp.instance.repository
    val me by repository.me.collectAsState()
    val family by repository.family.collectAsState()
    val isParent = repository.isParent
    val actions by repository.actions.collectAsState()
    val homework by repository.homework.collectAsState()
    val familyEvents = repository.visibleFamilyEvents
    val schoolEvents = repository.visibleEvents
    val completingActionIDs by repository.completingActionIDs.collectAsState()
    val scope = rememberCoroutineScope()

    var showMoreMenu by remember { mutableStateOf(false) }
    var showAddEventDialog by remember { mutableStateOf(false) }

    val todayStr = remember {
        val sdf = SimpleDateFormat("EEEE, MMMM d", Locale.getDefault())
        sdf.format(Date())
    }

    val greeting = remember(me?.name) {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val prefix = when {
            hour < 12 -> "Good morning"
            hour < 18 -> "Good afternoon"
            else -> "Good evening"
        }
        val firstName = me?.name?.split(" ")?.firstOrNull() ?: ""
        if (firstName.isNotEmpty()) "$prefix, $firstName" else prefix
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(FamTheme.colors.bg)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom
                ) {
                    Column {
                        MicroLabel(todayStr)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = greeting,
                            style = FamTheme.typography.title,
                            color = FamTheme.colors.text
                        )
                    }

                    Box {
                        IconButton(onClick = { showMoreMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More", tint = FamTheme.colors.textSecond)
                        }

                        DropdownMenu(
                            expanded = showMoreMenu,
                            onDismissRequest = { showMoreMenu = false },
                            modifier = Modifier.background(FamTheme.colors.panel)
                        ) {
                            DropdownMenuItem(
                                text = { Text("Notes", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.Notes, contentDescription = null) },
                                onClick = { showMoreMenu = false; onOpenNotes() }
                            )
                            DropdownMenuItem(
                                text = { Text("Settings", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                onClick = { showMoreMenu = false; onOpenSecondaryWeb("/settings") }
                            )
                            DropdownMenuItem(
                                text = { Text("Goals", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.Flag, contentDescription = null) },
                                onClick = { showMoreMenu = false; onOpenSecondaryWeb("/goals") }
                            )
                            DropdownMenuItem(
                                text = { Text("Activities", style = FamTheme.typography.body) },
                                leadingIcon = { Icon(Icons.Default.SportsBasketball, contentDescription = null) },
                                onClick = { showMoreMenu = false; onOpenSecondaryWeb("/activities") }
                            )
                            HorizontalDivider(color = FamTheme.colors.border)
                            DropdownMenuItem(
                                text = { Text("Sign Out", style = FamTheme.typography.body, color = FamTheme.colors.coral) },
                                leadingIcon = { Icon(Icons.Default.Logout, contentDescription = null, tint = FamTheme.colors.coral) },
                                onClick = { showMoreMenu = false; onSignOut() }
                            )
                        }
                    }
                }
            }

            // Action Card (Parents & Kids)
            val openActions = actions.filter { !it.isDone }
            if (openActions.isNotEmpty()) {
                item {
                    ActionQueueCard(
                        actions = openActions,
                        completingIDs = completingActionIDs,
                        onComplete = { id -> scope.launch { repository.completeAction(id) } }
                    )
                }
            }

            // Study Start Card (Priority assignment for Kids)
            if (!isParent) {
                val priorityHw = homework.firstOrNull { !it.isDone }
                if (priorityHw != null) {
                    item {
                        StudyStartCard(item = priorityHw, onOpenHomework = onOpenHomework)
                    }
                }
            }

            // Schedule Card
            item {
                TodayScheduleCard(
                    familyEvents = familyEvents,
                    schoolEvents = schoolEvents,
                    onAddEvent = { showAddEventDialog = true },
                    isParent = isParent
                )
            }

            // Homework Due Card
            item {
                HomeworkDueSummaryCard(
                    homework = homework.filter { !it.isDone },
                    onOpenHomework = onOpenHomework
                )
            }

            // Daily 5 Learning Card
            item {
                DailyFiveCard(
                    onPinQuoteToNotes = { quote ->
                        scope.launch { repository.createNote("Daily quote: $quote", source = "quote") }
                    }
                )
            }
        }

        // Floating Action Button for Parents
        if (isParent) {
            FloatingActionButton(
                onClick = { showAddEventDialog = true },
                containerColor = FamTheme.colors.accent,
                contentColor = FamTheme.colors.onAccent,
                shape = CircleShape,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 24.dp, bottom = 84.dp)
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add Event")
            }
        }
    }

    if (showAddEventDialog) {
        AddQuickEventDialog(
            onDismiss = { showAddEventDialog = false },
            onConfirm = { title, time ->
                scope.launch {
                    val todayIso = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                    repository.addFamilyEvent(title = title, date = todayIso, time = time)
                    showAddEventDialog = false
                }
            }
        )
    }
}

@Composable
private fun ActionQueueCard(
    actions: List<FamilyAction>,
    completingIDs: Set<String>,
    onComplete: (String) -> Unit
) {
    FamCard {
        MicroLabel("Next Action")
        Spacer(modifier = Modifier.height(8.dp))
        val firstAction = actions.first()
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = firstAction.title,
                    style = FamTheme.typography.cardTitle,
                    color = FamTheme.colors.text
                )
                firstAction.dueTime?.let {
                    Text("Due at $it", style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                }
            }

            val isMutating = completingIDs.contains(firstAction.id)
            IconButton(
                onClick = { onComplete(firstAction.id) },
                enabled = !isMutating,
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(FamTheme.colors.accentSoft)
            ) {
                if (isMutating) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = FamTheme.colors.accent)
                } else {
                    Icon(Icons.Default.Check, contentDescription = "Complete", tint = FamTheme.colors.accent, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun StudyStartCard(
    item: HomeworkItem,
    onOpenHomework: () -> Unit
) {
    FamCard(
        backgroundColor = FamTheme.colors.panel2
    ) {
        MicroLabel("Recommended Focus")
        Spacer(modifier = Modifier.height(6.dp))
        Text(item.title, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
        Text("Due ${item.dueDate} ${item.dueTime ?: ""}", style = FamTheme.typography.caption, color = FamTheme.colors.coral)
        Spacer(modifier = Modifier.height(10.dp))
        Button(
            onClick = onOpenHomework,
            colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent),
            shape = RoundedCornerShape(8.dp),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
        ) {
            Text("Start Homework", style = FamTheme.typography.label, color = FamTheme.colors.onAccent)
        }
    }
}

@Composable
private fun TodayScheduleCard(
    familyEvents: List<FamilyEvent>,
    schoolEvents: List<com.fametc.app.data.model.CalendarEvent>,
    onAddEvent: () -> Unit,
    isParent: Boolean
) {
    val todayIso = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) }
    val todayFamily = familyEvents.filter { it.date == todayIso }

    FamCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                MicroLabel("Schedule")
                Text("Today's Events", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
            }
            if (isParent) {
                IconButton(onClick = onAddEvent, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Default.AddCircleOutline, contentDescription = "Add", tint = FamTheme.colors.accent)
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (todayFamily.isEmpty() && schoolEvents.isEmpty()) {
            Text(
                text = "Nothing scheduled for today.",
                style = FamTheme.typography.body,
                color = FamTheme.colors.textSecond
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                todayFamily.forEach { ev ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(FamTheme.colors.accent))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(ev.title, style = FamTheme.typography.body, color = FamTheme.colors.text)
                        ev.time?.let {
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("($it)", style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeworkDueSummaryCard(
    homework: List<HomeworkItem>,
    onOpenHomework: () -> Unit
) {
    FamCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                MicroLabel("Assignments")
                Text("Homework Queue", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
            }
            TextButton(onClick = onOpenHomework) {
                Text("View All", style = FamTheme.typography.label, color = FamTheme.colors.accent)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (homework.isEmpty()) {
            Text(
                text = "All caught up! No pending homework.",
                style = FamTheme.typography.body,
                color = FamTheme.colors.textSecond
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                homework.take(3).forEach { item ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(item.title, style = FamTheme.typography.body, color = FamTheme.colors.text)
                        Text("Due ${item.dueDate}", style = FamTheme.typography.caption, color = FamTheme.colors.coral)
                    }
                }
            }
        }
    }
}

@Composable
fun AddQuickEventDialog(
    onDismiss: () -> Unit,
    onConfirm: (String, String?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var time by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Family Event", style = FamTheme.typography.cardTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Event Title") },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = time,
                    onValueChange = { time = it },
                    label = { Text("Time (e.g. 15:30)") },
                    placeholder = { Text("Optional") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { if (title.isNotBlank()) onConfirm(title.trim(), time.takeIf { it.isNotBlank() }?.trim()) },
                colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
            ) {
                Text("Add", color = FamTheme.colors.onAccent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
