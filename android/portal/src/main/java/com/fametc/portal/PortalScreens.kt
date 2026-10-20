@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.fametc.portal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.DinnerDining
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.NightsStay
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ViewColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun PortalRoot(
    state: PortalState,
    preferences: PortalPreferences,
    quiet: Boolean,
    onPair: (String) -> Unit,
    onDemo: () -> Unit,
    onLeaveDemo: () -> Unit,
    onRefresh: () -> Unit,
    onPreferences: (PortalPreferences) -> Unit,
    onUnpair: () -> Unit,
) {
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    Surface(Modifier.fillMaxSize(), color = PortalColors.Background) {
        Column(Modifier.fillMaxSize().navigationBarsPadding()) {
            // Portal's own status overlay occupies the top edge of a sideloaded app.
            Spacer(Modifier.fillMaxWidth().height(64.dp).background(PortalColors.Background))
            when {
                state.loading -> LoadingView()
                state.context != null -> FamilyDashboard(
                    state, state.context, quiet, onRefresh, { settingsOpen = true }, onLeaveDemo
                )
                state.paired -> WaitingForFamily(state, onRefresh, { settingsOpen = true })
                else -> PairingView(state, onPair, onDemo, { settingsOpen = true })
            }
        }
    }
    if (settingsOpen) {
        PortalSettings(
            preferences = preferences,
            device = state.device,
            paired = state.paired,
            onChange = onPreferences,
            onClose = { settingsOpen = false },
            onUnpair = { settingsOpen = false; onUnpair() },
        )
    }
}

@Composable
private fun LoadingView() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Brand()
            CircularProgressIndicator(color = PortalColors.Violet)
            Text("Opening your family display…", color = PortalColors.Secondary)
        }
    }
}

@Composable
private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Image(painterResource(R.mipmap.ic_portal), null, Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)))
        Text("Fam ETC", style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun PairingView(state: PortalState, onPair: (String) -> Unit, onDemo: () -> Unit, onSettings: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 900.dp
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(if (wide) 36.dp else 20.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Brand()
                Spacer(Modifier.weight(1f))
                ActionIcon(Icons.Outlined.Settings, "Display settings", onSettings)
            }
            if (wide) {
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(48.dp)) {
                    PairingIntroduction(Modifier.weight(1f))
                    PairingForm(state, onPair, onDemo, Modifier.weight(1f))
                }
            } else {
                PairingIntroduction(Modifier.fillMaxWidth())
                PairingForm(state, onPair, onDemo, Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun PairingIntroduction(modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(22.dp)) {
        Text("A home for\neveryone’s day.", style = MaterialTheme.typography.displaySmall, modifier = Modifier.semantics { heading() })
        Text("One family calendar, together on the big screen.", style = MaterialTheme.typography.bodyLarge, color = PortalColors.Secondary)
        FeatureLine(Icons.Outlined.CalendarMonth, "Everyone’s week", "Family plans, activities and the moments in between.", PortalColors.Violet)
        FeatureLine(Icons.Outlined.AutoStories, "A little help with homework", "See what’s due without opening another app.", PortalColors.Homework)
        FeatureLine(Icons.Outlined.DinnerDining, "Something to look forward to", "Keep the family’s meal plan close at hand.", PortalColors.Mint)
    }
}

@Composable
private fun FeatureLine(icon: ImageVector, title: String, body: String, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, Modifier.padding(top = 3.dp).size(26.dp), tint = color)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
        }
    }
}

@Composable
private fun PairingForm(state: PortalState, onPair: (String) -> Unit, onDemo: () -> Unit, modifier: Modifier) {
    var code by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = { if (code.length == 8 && !state.pairing) { keyboard?.hide(); onPair(code) } }
    BoardPanel(modifier) {
        Text("Connect your family", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        Text("On your phone, sign in to Fam ETC, open Displays and choose Create pairing code.", color = PortalColors.Secondary)
        Surface(shape = RoundedCornerShape(12.dp), color = PortalColors.Violet.copy(alpha = .12f)) {
            Text(PortalApi.SETUP_ADDRESS, Modifier.padding(14.dp), style = MaterialTheme.typography.titleMedium, color = PortalColors.Violet)
        }
        Text("Enter the eight-character code shown on your phone.", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = code,
            onValueChange = { value -> code = value.uppercase(Locale.ROOT).filter { it in 'A'..'Z' || it in '2'..'9' }.take(8) },
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.pairing,
            label = { Text("Pairing code") },
            placeholder = { Text("ABCD2345") },
            textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace, letterSpacing = 4.sp),
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrect = false, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            shape = RoundedCornerShape(14.dp),
        )
        state.error?.let { Notice(it, Icons.Outlined.Info, PortalColors.Error) }
        Button(onClick = submit, enabled = code.length == 8 && !state.pairing, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            if (state.pairing) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text("Connect display")
        }
        Text("Codes are single-use and expire after 10 minutes. Create another on your phone if you need one.", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
        HorizontalDivider(color = PortalColors.Stroke)
        OutlinedButton(onClick = onDemo, enabled = !state.pairing, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            Text("Explore the sample family · Demo")
        }
    }
}

@Composable
private fun WaitingForFamily(state: PortalState, onRefresh: () -> Unit, onSettings: () -> Unit) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), contentAlignment = Alignment.Center) {
        BoardPanel(Modifier.widthIn(max = 640.dp).fillMaxWidth()) {
            Brand()
            Text(if (state.offline) "Waiting to refresh" else "Your display is connected", style = MaterialTheme.typography.headlineMedium)
            Text(
                state.error ?: "Getting your family’s calendar, homework and meals…",
                color = PortalColors.Secondary,
            )
            if (state.refreshing) CircularProgressIndicator(Modifier.size(28.dp))
            Button(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Refresh family view") }
            TextButton(onClick = onSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Display settings") }
        }
    }
}

@Composable
private fun FamilyDashboard(
    state: PortalState,
    context: DisplayContext,
    quiet: Boolean,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onLeaveDemo: () -> Unit,
) {
    var showWeek by rememberSaveable(context.device.id) { mutableStateOf(false) }
    val localTime = Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(context.timeZone)).toLocalTime()
    if (!showWeek) {
        val onWeek = { showWeek = true }
        if (PortalSchedule.isNightBoard(localTime)) NightBoard(state, context, onSettings, onWeek)
        else DayBoard(state, context, onRefresh, onSettings, onLeaveDemo, onWeek)
        return
    }
    val today = DisplayTime.today(state.nowMillis, context.timeZone).toString()
    var selectedDate by rememberSaveable(context.device.id) { mutableStateOf(context.today) }
    var previousToday by rememberSaveable(context.device.id) { mutableStateOf(today) }
    var selectedMember by rememberSaveable(context.device.id) { mutableStateOf<String?>(null) }
    var familyOnly by rememberSaveable(context.device.id) { mutableStateOf(false) }
    LaunchedEffect(today, context.today) {
        if (selectedDate == previousToday && context.days.any { it.date == today }) selectedDate = today
        if (context.days.none { it.date == selectedDate }) selectedDate = context.today
        previousToday = today
    }
    LaunchedEffect(context.members) {
        if (selectedMember != null && context.members.none { it.id == selectedMember }) selectedMember = null
    }
    val events = remember(context, selectedDate, selectedMember, familyOnly) { PortalSchedule.events(context, selectedDate, selectedMember, familyOnly) }
    val homework = remember(context, selectedMember, familyOnly) { PortalSchedule.homework(context, selectedMember, familyOnly) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 960.dp
        val veryWide = maxWidth >= 1350.dp
        val compactHeight = maxHeight < 800.dp
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = if (wide) 28.dp else 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item(key = "header") { DashboardHeader(state, context, wide, onRefresh, onSettings) { showWeek = false } }
            if (state.demo) item(key = "demo") {
                Surface(color = PortalColors.Homework.copy(alpha = .16f), shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, PortalColors.Homework.copy(alpha = .4f))) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("DEMO · Invented sample family", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = PortalColors.Homework)
                        TextButton(onClick = onLeaveDemo, modifier = Modifier.heightIn(min = 52.dp)) { Text("Leave demo", color = PortalColors.Homework) }
                    }
                }
            }
            if (!state.demo && (state.offline || context.today != today)) item(key = "connection") {
                Notice(
                    if (context.today != today) "This is the saved calendar from ${DisplayTime.dateLabel(context.today)}. Waiting for today’s update."
                    else "${state.error ?: "Connection paused. Retrying automatically."} Showing the last saved family view.",
                    Icons.Outlined.CloudOff, PortalColors.Homework,
                )
            }
            if (!state.demo) context.notices.filter { it.isNotBlank() }.take(3).forEachIndexed { index, notice ->
                item(key = "provider-$index") { Notice(notice.take(260), Icons.Outlined.Info, PortalColors.Homework) }
            }
            if (quiet) item(key = "night") {
                Notice("Night schedule is active. Touch the screen to brighten it for two minutes.", Icons.Outlined.NightsStay, PortalColors.Secondary)
            }
            item(key = "filters") {
                MemberFilters(context.members, selectedMember, familyOnly) { member, family -> selectedMember = member; familyOnly = family }
            }
            item(key = "week") {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Family calendar", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
                        Text("Next seven days", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
                    }
                    WeekCalendar(context, today, selectedDate, selectedMember, familyOnly, compactHeight) { selectedDate = it }
                }
            }
            item(key = "details") {
                if (wide) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Top) {
                        DayAgenda(context, selectedDate, events, state.nowMillis, Modifier.weight(if (veryWide) 1.5f else 1.6f))
                        if (veryWide) {
                            if (context.device.showHomework) HomeworkPanel(context, homework, today, familyOnly, Modifier.weight(1f))
                            if (context.device.showMeals) MealsPanel(context, selectedDate, Modifier.weight(.9f))
                        } else if (context.device.showHomework || context.device.showMeals) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                                if (context.device.showHomework) HomeworkPanel(context, homework, today, familyOnly, Modifier.fillMaxWidth())
                                if (context.device.showMeals) MealsPanel(context, selectedDate, Modifier.fillMaxWidth())
                            }
                        }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                        DayAgenda(context, selectedDate, events, state.nowMillis, Modifier.fillMaxWidth())
                        if (context.device.showHomework) HomeworkPanel(context, homework, today, familyOnly, Modifier.fillMaxWidth())
                        if (context.device.showMeals) MealsPanel(context, selectedDate, Modifier.fillMaxWidth())
                    }
                }
            }
            item(key = "footer") {
                Text("Read-only family view · Manage this display on your phone", style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary, modifier = Modifier.padding(bottom = 10.dp))
            }
        }
    }
}

@Composable
private fun DashboardHeader(state: PortalState, context: DisplayContext, wide: Boolean, onRefresh: () -> Unit, onSettings: () -> Unit, onToday: () -> Unit) {
    val date = DisplayTime.dateLabel(DisplayTime.today(state.nowMillis, context.timeZone).toString())
    val title: @Composable () -> Unit = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Image(painterResource(R.mipmap.ic_portal), null, Modifier.size(50.dp).clip(RoundedCornerShape(14.dp)))
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("FAM ETC · AT HOME", style = MaterialTheme.typography.labelMedium, color = PortalColors.Violet)
                Text(context.family.name.ifBlank { "Your family" }, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(date, style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
            }
        }
    }
    val controls: @Composable RowScope.() -> Unit = {
        Column(horizontalAlignment = if (wide) Alignment.End else Alignment.Start) {
            Text(DisplayTime.clock(state.nowMillis, context.timeZone), fontSize = 40.sp, lineHeight = 44.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(if (state.demo) PortalColors.Homework else if (state.offline) PortalColors.Homework else PortalColors.Mint, CircleShape))
                Text(
                    when { state.demo -> "Sample data"; state.refreshing -> "Updating…"; state.offline -> "Saved · ${updatedLabel(context)}"; else -> "${updatedLabel(context)}" },
                    style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary,
                )
            }
        }
        if (!wide) Spacer(Modifier.weight(1f))
        ActionIcon(Icons.Outlined.ViewColumn, "Today board", onToday)
        IconButton(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.size(56.dp)) {
            if (state.refreshing) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            else Icon(Icons.Outlined.Refresh, "Refresh family view", Modifier.size(26.dp))
        }
        ActionIcon(Icons.Outlined.Settings, "Display settings", onSettings)
    }
    if (wide) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { title() }
            controls()
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            title()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), content = controls)
        }
    }
}

@Composable
private fun MemberFilters(members: List<DisplayMember>, selectedMember: String?, familyOnly: Boolean, onSelect: (String?, Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        FilterChip(
            selected = selectedMember == null && !familyOnly,
            onClick = { onSelect(null, false) },
            label = { Text("Everyone") },
            leadingIcon = { Icon(Icons.Outlined.Groups, null, Modifier.size(22.dp)) },
            modifier = Modifier.heightIn(min = 52.dp),
        )
        FilterChip(selected = familyOnly, onClick = { onSelect(null, true) }, label = { Text("Family plans") }, modifier = Modifier.heightIn(min = 52.dp))
        members.forEach { member ->
            FilterChip(
                selected = selectedMember == member.id && !familyOnly,
                onClick = { onSelect(member.id, false) },
                label = { Text(member.name, maxLines = 1) },
                leadingIcon = { Box(Modifier.size(12.dp).background(memberColor(member.color), CircleShape)) },
                modifier = Modifier.heightIn(min = 52.dp),
            )
        }
    }
}

@Composable
private fun WeekCalendar(context: DisplayContext, today: String, selectedDate: String, memberId: String?, familyOnly: Boolean, compact: Boolean, onSelect: (String) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val dayWidth = if (maxWidth >= 920.dp) (maxWidth - 60.dp) / 7f else 166.dp
        val previewCount = if (compact) 2 else 3
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            context.days.forEach { day ->
                val date = LocalDate.parse(day.date)
                val selected = day.date == selectedDate
                val events = remember(context, day.date, memberId, familyOnly) { PortalSchedule.events(context, day.date, memberId, familyOnly) }
                Surface(
                    onClick = { onSelect(day.date) },
                    modifier = Modifier.width(dayWidth).heightIn(min = if (compact) 260.dp else 324.dp).fillMaxHeight().semantics { this.selected = selected },
                    shape = RoundedCornerShape(18.dp),
                    color = if (selected) Color(0xFF302741) else PortalColors.Panel,
                    border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) PortalColors.Violet else PortalColors.Stroke),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 12.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(if (day.date == today) "TODAY" else date.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault())).uppercase(Locale.getDefault()), style = MaterialTheme.typography.labelMedium, color = if (day.date == today) PortalColors.Violet else PortalColors.Secondary)
                                Text(date.format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())), style = MaterialTheme.typography.titleLarge)
                            }
                        }
                        HorizontalDivider(color = if (selected) PortalColors.Violet.copy(alpha = .35f) else PortalColors.Stroke)
                        if (events.isEmpty()) {
                            Text("No plans yet", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary, modifier = Modifier.padding(top = 8.dp))
                        } else events.take(previewCount).forEach { event -> CalendarPreviewEvent(event, context) }
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (events.size > previewCount) "+ ${events.size - previewCount} more · View day" else if (selected) "Day selected" else "View day",
                            color = if (selected) PortalColors.Violet else PortalColors.Secondary,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarPreviewEvent(event: DisplayEvent, context: DisplayContext) {
    val member = context.members.firstOrNull { it.id == event.memberId }
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.width(3.dp).fillMaxHeight().clip(CircleShape).background(memberColor(event.color)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${eventTime(event)} · ${member?.name ?: "Family"}", fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.SemiBold, color = memberColor(member?.color ?: event.color), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(event.title, fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DayAgenda(context: DisplayContext, date: String, events: List<DisplayEvent>, nowMillis: Long, modifier: Modifier) {
    var visibleCount by rememberSaveable(context.device.id, date, events.map { it.id }) { mutableStateOf(6) }
    val next = PortalSchedule.nextEvent(events, date, nowMillis, context.timeZone)
    BoardPanel(modifier) {
        PanelHeading(Icons.Outlined.CalendarMonth, DisplayTime.dateLabel(date), PortalColors.Violet)
        Text("${events.size} ${if (events.size == 1) "event" else "events"}", style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
        if (next != null) {
            val time = Instant.ofEpochMilli(nowMillis).atZone(DisplayTime.zone(context.timeZone)).toLocalTime()
            val currentDay = DisplayTime.today(nowMillis, context.timeZone).toString()
            Surface(shape = RoundedCornerShape(12.dp), color = PortalColors.Violet.copy(alpha = .12f)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(if (date == currentDay && PortalSchedule.isHappening(next, time)) "HAPPENING NOW" else "UP NEXT", color = PortalColors.Violet, style = MaterialTheme.typography.labelMedium)
                    Text("${eventTime(next)} · ${next.title}", style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (events.isEmpty()) {
            EmptyMessage("A little breathing room", "No events in this view for the selected day.")
        } else {
            events.take(visibleCount).forEachIndexed { index, event ->
                if (index > 0) HorizontalDivider(color = PortalColors.Stroke)
                AgendaEvent(event, context)
            }
            if (events.size > visibleCount) TextButton(onClick = { visibleCount += 10 }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Text("Show ${minOf(10, events.size - visibleCount)} more events")
            }
        }
    }
}

@Composable
private fun AgendaEvent(event: DisplayEvent, context: DisplayContext) {
    val member = context.members.firstOrNull { it.id == event.memberId }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.width(78.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (event.allDay) "All day" else event.time.ifBlank { "Any time" }, style = MaterialTheme.typography.labelLarge, color = memberColor(event.color))
            if (!event.allDay && event.endTime.isNotBlank()) Text(event.endTime, style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(event.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(member?.name ?: "Family", style = MaterialTheme.typography.labelMedium, color = memberColor(member?.color ?: event.color))
            if (event.location.isNotBlank()) Text(event.location, style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
        }
    }
}

@Composable
private fun HomeworkPanel(context: DisplayContext, homework: List<DisplayHomework>, today: String, familyOnly: Boolean, modifier: Modifier) {
    var visibleCount by rememberSaveable(context.device.id, homework.map { it.id }) { mutableStateOf(3) }
    BoardPanel(modifier) {
        PanelHeading(Icons.Outlined.AutoStories, "Homework", PortalColors.Homework)
        Text("Upcoming and overdue", style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
        if (homework.isEmpty()) {
            EmptyMessage(if (familyOnly) "Individual homework" else "Nothing waiting here", if (familyOnly) "Choose Everyone or a family member to see homework." else "No unfinished homework in this view.")
        } else homework.take(visibleCount).forEachIndexed { index, task ->
            if (index > 0) HorizontalDivider(color = PortalColors.Stroke)
            val member = context.members.firstOrNull { it.id == task.memberId }
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(task.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text(listOfNotNull(member?.name, task.subject.takeIf { it.isNotBlank() }).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
                Text(DisplayTime.dueLabel(task.dueDate, today), style = MaterialTheme.typography.labelMedium, color = PortalColors.Homework)
            }
        }
        if (homework.size > visibleCount) TextButton(onClick = { visibleCount += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Text("Show ${minOf(5, homework.size - visibleCount)} more", color = PortalColors.Homework)
        }
    }
}

@Composable
private fun MealsPanel(context: DisplayContext, date: String, modifier: Modifier) {
    val meals = context.meals.filter { it.date == date }
    BoardPanel(modifier) {
        PanelHeading(Icons.Outlined.DinnerDining, "At the table", PortalColors.Mint)
        Text("For the family · ${shortDate(date)}", style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
        if (meals.isEmpty()) EmptyMessage("Nothing planned yet", "No meals planned for this day.")
        else meals.forEachIndexed { index, meal ->
            if (index > 0) HorizontalDivider(color = PortalColors.Stroke)
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(meal.slot.replaceFirstChar { it.titlecase(Locale.getDefault()) }, style = MaterialTheme.typography.labelMedium, color = PortalColors.Mint)
                Text(meal.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
internal fun BoardPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier, shape = RoundedCornerShape(22.dp), color = PortalColors.Panel, border = BorderStroke(1.dp, PortalColors.Stroke)) {
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

@Composable
private fun PanelHeading(icon: ImageVector, title: String, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(24.dp), tint = color)
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun EmptyMessage(title: String, detail: String) {
    Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
    }
}

@Composable
internal fun Notice(message: String, icon: ImageVector, color: Color) {
    Surface(color = color.copy(alpha = .08f), shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, null, Modifier.size(22.dp), tint = color)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = color, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
internal fun ActionIcon(icon: ImageVector, description: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(56.dp)) { Icon(icon, description, Modifier.size(26.dp)) }
}

internal fun memberColor(value: String): Color = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(PortalColors.Violet)

private fun eventTime(event: DisplayEvent): String = when {
    event.allDay -> "All day"
    event.time.isBlank() -> "Any time"
    else -> event.time
}

private fun shortDate(value: String): String = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())) }.getOrDefault(value)

internal fun updatedLabel(context: DisplayContext): String = runCatching {
    val updated = Instant.parse(context.generatedAt).atZone(DisplayTime.zone(context.timeZone))
    "Updated ${updated.format(DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()))}"
}.getOrDefault("Saved view")
