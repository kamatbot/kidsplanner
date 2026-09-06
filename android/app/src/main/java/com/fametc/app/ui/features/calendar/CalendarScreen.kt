package com.fametc.app.ui.features.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.FamilyEvent
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

private enum class CalendarViewMode(val label: String) {
    AGENDA("Agenda"), MONTH("Month")
}

@Composable
fun CalendarScreen() {
    val repository = FamEtcApp.instance.repository
    val isParent = repository.isParent
    val kids = repository.kids
    val familyEvents = repository.visibleFamilyEvents
    val schoolEvents = repository.visibleEvents
    val scope = rememberCoroutineScope()

    var viewMode by remember { mutableStateOf(CalendarViewMode.AGENDA) }
    var selectedKidId by remember { mutableStateOf<String?>(null) }
    var showAddEventSheet by remember { mutableStateOf(false) }
    var selectedEventForDetail by remember { mutableStateOf<FamilyEvent?>(null) }

    // Filter events by selected audience
    val filteredFamilyEvents = remember(familyEvents, selectedKidId) {
        if (selectedKidId == null) familyEvents
        else familyEvents.filter { it.kidId == null || it.kidId == selectedKidId }
    }

    Scaffold(
        containerColor = FamTheme.colors.bg,
        floatingActionButton = {
            if (isParent) {
                FloatingActionButton(
                    onClick = { showAddEventSheet = true },
                    containerColor = FamTheme.colors.accent,
                    contentColor = FamTheme.colors.onAccent,
                    shape = CircleShape
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add Event")
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Header: Title & View Mode Toggle
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Calendar", style = FamTheme.typography.title, color = FamTheme.colors.text)

                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(FamTheme.colors.panel)
                        .border(1.dp, FamTheme.colors.border, RoundedCornerShape(8.dp))
                ) {
                    CalendarViewMode.values().forEach { mode ->
                        val isSel = viewMode == mode
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isSel) FamTheme.colors.accentSoft else Color.Transparent)
                                .clickable { viewMode = mode }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = mode.label,
                                style = FamTheme.typography.label,
                                color = if (isSel) FamTheme.colors.accent else FamTheme.colors.textSecond
                            )
                        }
                    }
                }
            }

            // Audience Filter Bar (Parents only)
            if (isParent && kids.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AudienceChip(
                        label = "All Family",
                        isSelected = selectedKidId == null,
                        onClick = { selectedKidId = null }
                    )
                    kids.forEachIndexed { idx, kid ->
                        AudienceChip(
                            label = kid.name,
                            isSelected = selectedKidId == kid.id,
                            color = HorizonColors.kidColor(idx, FamTheme.colors.isDark),
                            onClick = { selectedKidId = kid.id }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Main Content: Agenda List or Month Grid
            when (viewMode) {
                CalendarViewMode.AGENDA -> {
                    CalendarAgendaView(
                        events = filteredFamilyEvents,
                        onEventClick = { selectedEventForDetail = it }
                    )
                }
                CalendarViewMode.MONTH -> {
                    CalendarMonthGridView(
                        events = filteredFamilyEvents,
                        onEventClick = { selectedEventForDetail = it }
                    )
                }
            }
        }
    }

    if (showAddEventSheet) {
        AddCalendarEventDialog(
            kids = kids,
            onDismiss = { showAddEventSheet = false },
            onConfirm = { title, date, time, kidId, repeat ->
                scope.launch {
                    repository.addFamilyEvent(
                        title = title,
                        date = date,
                        time = time,
                        kidId = kidId,
                        repeatRule = repeat
                    )
                    showAddEventSheet = false
                }
            }
        )
    }

    selectedEventForDetail?.let { ev ->
        EventDetailDialog(
            event = ev,
            canDelete = isParent || ev.canEdit == true,
            onDismiss = { selectedEventForDetail = null },
            onDelete = {
                scope.launch {
                    repository.deleteFamilyEvent(ev.id)
                    selectedEventForDetail = null
                }
            }
        )
    }
}

@Composable
private fun AudienceChip(
    label: String,
    isSelected: Boolean,
    color: Color = FamTheme.colors.accent,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (isSelected) color.copy(alpha = 0.18f) else FamTheme.colors.panel)
            .border(1.dp, if (isSelected) color else FamTheme.colors.border, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 6.dp)
    ) {
        Text(
            text = label,
            style = FamTheme.typography.caption,
            color = if (isSelected) color else FamTheme.colors.textSecond
        )
    }
}

@Composable
private fun CalendarAgendaView(
    events: List<FamilyEvent>,
    onEventClick: (FamilyEvent) -> Unit
) {
    val groupedByDate = remember(events) {
        events.groupBy { it.date }.toSortedMap()
    }

    if (groupedByDate.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No upcoming events scheduled.",
                style = FamTheme.typography.body,
                color = FamTheme.colors.textSecond
            )
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            groupedByDate.forEach { (dateStr, dateEvents) ->
                item {
                    MicroLabel(dateStr)
                    Spacer(modifier = Modifier.height(6.dp))
                    FamCard {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            dateEvents.forEach { ev ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { onEventClick(ev) }
                                        .padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .clip(CircleShape)
                                                .background(FamTheme.colors.accent)
                                        )
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Column {
                                            Text(ev.title, style = FamTheme.typography.body, color = FamTheme.colors.text)
                                            ev.notes?.let {
                                                Text(it, style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                                            }
                                        }
                                    }
                                    ev.time?.let {
                                        Text(it, style = FamTheme.typography.mono, color = FamTheme.colors.textSecond)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarMonthGridView(
    events: List<FamilyEvent>,
    onEventClick: (FamilyEvent) -> Unit
) {
    val cal = Calendar.getInstance()
    val daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
    val curMonthYear = remember {
        SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(Date())
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
    ) {
        Text(curMonthYear, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
        Spacer(modifier = Modifier.height(12.dp))

        // Weekday header
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            listOf("S", "M", "T", "W", "T", "F", "S").forEach {
                Text(it, style = FamTheme.typography.caption, color = FamTheme.colors.muted)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        FamCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val weeks = (1..daysInMonth).chunked(7)
                weeks.forEach { weekDays ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                        weekDays.forEach { dayNum ->
                            val dayDate = SimpleDateFormat("yyyy-MM-", Locale.US).format(Date()) + String.format("%02d", dayNum)
                            val dayEvents = events.filter { it.date == dayDate }
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(if (dayEvents.isNotEmpty()) FamTheme.colors.accentSoft else Color.Transparent)
                                    .clickable(enabled = dayEvents.isNotEmpty()) {
                                        onEventClick(dayEvents.first())
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "$dayNum",
                                    style = FamTheme.typography.caption,
                                    color = if (dayEvents.isNotEmpty()) FamTheme.colors.accent else FamTheme.colors.text
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddCalendarEventDialog(
    kids: List<com.fametc.app.data.model.Kid>,
    onDismiss: () -> Unit,
    onConfirm: (title: String, date: String, time: String?, kidId: String?, repeat: String?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())) }
    var time by remember { mutableStateOf("") }
    var selectedKidId by remember { mutableStateOf<String?>(null) }
    var repeatRule by remember { mutableStateOf("none") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Family Event", style = FamTheme.typography.cardTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Event Title") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = date, onValueChange = { date = it }, label = { Text("Date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = time, onValueChange = { time = it }, label = { Text("Time (e.g. 14:00)") }, placeholder = { Text("Optional") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (title.isNotBlank() && date.isNotBlank()) {
                        onConfirm(title.trim(), date.trim(), time.takeIf { it.isNotBlank() }?.trim(), selectedKidId, repeatRule)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
            ) { Text("Create Event", color = FamTheme.colors.onAccent) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
private fun EventDetailDialog(
    event: FamilyEvent,
    canDelete: Boolean,
    onDismiss: () -> Unit,
    onDelete: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(event.title, style = FamTheme.typography.cardTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Date: ${event.date}", style = FamTheme.typography.body)
                event.time?.let { Text("Time: $it", style = FamTheme.typography.body) }
                event.notes?.let { Text("Notes: $it", style = FamTheme.typography.body, color = FamTheme.colors.textSecond) }
            }
        },
        confirmButton = {
            if (canDelete) {
                Button(
                    onClick = onDelete,
                    colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.coral)
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Delete", color = Color.White)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    )
}
