package com.fametc.portal

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Ink = Color(0xFF14151C)
private val DayGround = Color(0xFF14151C)
private val FamilyGround = Color(0xFF2B2540)
private val FamilyCard = Color(0xFF3A3355)
private val FamilyDivider = Color(0xFF4A4366)
private val FamilyViolet = Color(0xFF7B4DFF)
private val Lilac = Color(0xFFCDB9FF)
private val DateGrey = Color(0xFFC9CBD6)

private val NightGround = Color(0xFF0B0D14)
private val NightText = Color(0xFFEDEFF7)
private val NightMuted = Color(0xFF9AA0B4)
private val NightSoft = Color(0xFFC9CDDB)
private val NightCard = Color(0xFF141826)
private val NightDivider = Color(0xFF222637)

private val Tabular = TextStyle(fontFeatureSettings = "tnum")

private fun contrast(a: Color, b: Color): Float {
    val hi = maxOf(a.luminance(), b.luminance())
    val lo = minOf(a.luminance(), b.luminance())
    return (hi + .05f) / (lo + .05f)
}

/** Text colour for a coloured surface: dark ink or white, whichever reads better (#6C63FF -> white, #FF6B9D -> ink). */
internal fun inkOn(background: Color): Color = if (contrast(background, Ink) > contrast(background, Color.White)) Ink else Color.White

private fun boardTime(event: DisplayEvent): String = when {
    event.allDay -> "All day"
    event.time.isBlank() -> "Any time"
    else -> DisplayTime.shortTime(event.time)
}

private fun clockTime(event: DisplayEvent): String = DisplayTime.shortTime(event.time) + DisplayTime.meridiem(event.time).let { if (it.isEmpty()) "" else " $it" }

private fun eventColor(context: DisplayContext, event: DisplayEvent): Color {
    if (event.memberId == null) return FamilyViolet
    val member = context.members.firstOrNull { it.id == event.memberId }
    return memberColor(member?.color ?: event.color)
}

private fun eventOwner(context: DisplayContext, event: DisplayEvent): String =
    if (event.memberId == null) "Family" else context.members.firstOrNull { it.id == event.memberId }?.name ?: "Family"

private fun dayName(date: String, pattern: String): String =
    runCatching { LocalDate.parse(date).format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault())) }.getOrDefault(date)

private fun Modifier.card(color: Color, radius: Dp) = background(color, RoundedCornerShape(radius))

@Composable
private fun Avatar(letter: String, background: Color, textColor: Color, size: Dp) {
    Box(Modifier.size(size).background(background, CircleShape), contentAlignment = Alignment.Center) {
        Text(letter, color = textColor, fontSize = (size.value * .5f).sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun Pill(text: String, background: Color, textColor: Color) {
    Box(Modifier.background(background, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 4.dp)) {
        Text(text, color = textColor, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = .8.sp, maxLines = 1)
    }
}

@Composable
private fun Label(text: String, color: Color) {
    Text(text, color = color, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.5.sp, modifier = Modifier.semantics { heading() })
}

// ───────────────────────────── Day board ─────────────────────────────

@Composable
internal fun DayBoard(
    state: PortalState,
    context: DisplayContext,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onLeaveDemo: () -> Unit,
    onWeek: () -> Unit,
) {
    val now = Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(context.timeZone))
    val today = now.toLocalDate().toString()
    val time = now.toLocalTime()
    val tomorrow = now.toLocalDate().plusDays(1).toString()
    val notices = buildList {
        if (!state.demo && (state.offline || context.today != today)) add(
            (if (context.today != today) "This is the saved calendar from ${DisplayTime.dateLabel(context.today)}. Waiting for today’s update."
            else "${state.error ?: "Connection paused. Retrying automatically."} Showing the last saved family view.") to Icons.Outlined.CloudOff
        )
        if (!state.demo) context.notices.filter { it.isNotBlank() }.forEach { add(it.take(260) to Icons.Outlined.Info) }
    }.take(2)
    BoxWithConstraints(Modifier.fillMaxSize().background(DayGround)) {
        val wide = maxWidth >= 900.dp
        Column(Modifier.fillMaxSize()) {
            DayHeader(state, context, wide, onRefresh, onSettings, onLeaveDemo, onWeek)
            if (notices.isNotEmpty()) Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                notices.forEach { (message, icon) -> Notice(message, icon, PortalColors.Homework) }
            }
            val columns: @Composable (Modifier) -> Unit = { slot ->
                context.members.forEach { member ->
                    MemberColumn(slot, wide, context, member, today, tomorrow, time)
                }
                FamilyColumn(slot, wide, context, today, state.nowMillis, time)
            }
            if (wide) {
                Row(Modifier.weight(1f).fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    columns(Modifier.weight(1f).fillMaxHeight())
                }
            } else {
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    columns(Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun DayHeader(
    state: PortalState,
    context: DisplayContext,
    wide: Boolean,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onLeaveDemo: () -> Unit,
    onWeek: () -> Unit,
) {
    val date = dayName(DisplayTime.today(state.nowMillis, context.timeZone).toString(), "EEEE d MMM")
    val title: @Composable () -> Unit = {
        Text("Who's on today?", color = Color.White, fontSize = if (wide) 44.sp else 32.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
    }
    val info: @Composable RowScope.() -> Unit = {
        Column(horizontalAlignment = Alignment.End) {
            Text(date, color = DateGrey, fontSize = 20.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(if (state.demo || state.offline) PortalColors.Homework else PortalColors.Mint, CircleShape))
                Text(
                    when { state.demo -> "Sample data"; state.refreshing -> "Updating…"; state.offline -> "Saved · ${updatedLabel(context)}"; else -> updatedLabel(context) },
                    color = DateGrey, fontSize = 14.sp,
                )
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(DisplayTime.clock12(state.nowMillis, context.timeZone), color = Color.White, style = Tabular, fontSize = if (wide) 44.sp else 32.sp, fontWeight = FontWeight.ExtraBold)
            Text(DisplayTime.clockMeridiem(state.nowMillis, context.timeZone), color = DateGrey, fontSize = 16.sp, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        }
        if (state.demo) {
            Pill("DEMO", PortalColors.Homework, Ink)
            TextButton(onClick = onLeaveDemo, modifier = Modifier.heightIn(min = 52.dp)) { Text("Leave demo", color = PortalColors.Homework) }
        }
        CompositionLocalProvider(LocalContentColor provides Color.White) {
            ActionIcon(Icons.Outlined.CalendarMonth, "Week view", onWeek)
            IconButton(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.size(56.dp)) {
                if (state.refreshing) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Refresh, "Refresh family view", Modifier.size(26.dp))
            }
            ActionIcon(Icons.Outlined.Settings, "Display settings", onSettings)
        }
    }
    if (wide) {
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.weight(1f)) { title() }
            info()
        }
    } else {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp)) {
            title()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), content = info)
        }
    }
}

/** Shared column chrome: header, items (scroll when long), then pinned bottom sections. */
@Composable
private fun BoardColumn(
    modifier: Modifier,
    wide: Boolean,
    background: Color,
    textColor: Color,
    avatarBackground: Color,
    avatarLetterColor: Color,
    initial: String,
    name: String,
    trailing: String?,
    items: @Composable ColumnScope.() -> Unit,
    bottom: @Composable ColumnScope.() -> Unit = {},
) {
    Column(modifier.card(background, 28.dp).padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(initial, avatarBackground, avatarLetterColor, 48.dp)
            Text(name, color = textColor, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).semantics { heading() })
            if (trailing != null) Text(trailing, color = textColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
        Column(
            (if (wide) Modifier.weight(1f).verticalScroll(rememberScrollState()) else Modifier).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp), content = items,
        )
        bottom()
    }
}

@Composable
private fun MemberColumn(
    modifier: Modifier,
    wide: Boolean,
    context: DisplayContext,
    member: DisplayMember,
    today: String,
    tomorrow: String,
    now: java.time.LocalTime,
) {
    val color = memberColor(member.color)
    val ink = inkOn(color)
    val items = PortalSchedule.memberEvents(context, today, member.id)
    val toGo = items.count { !PortalSchedule.isPast(it, now) }
    val homework = if (context.device.showHomework) PortalSchedule.homework(context, member.id, false).take(2) else emptyList()
    BoardColumn(
        modifier, wide, color, ink, ink, color, member.name.take(1).uppercase().ifEmpty { "?" }, member.name,
        if (toGo > 0) "$toGo to go" else null,
        items = {
            if (items.isEmpty()) {
                Text("Day off", color = ink, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold)
                Text("Nothing on the calendar today.", color = ink, fontSize = 18.sp)
                val next = PortalSchedule.memberEvents(context, tomorrow, member.id).take(3)
                if (next.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Label("TOMORROW", ink)
                    next.forEach { EventCard(it, past = false, marker = null, mark = ink, compact = true) }
                }
            } else {
                val first = items.indexOfFirst { !PortalSchedule.isPast(it, now) }
                items.forEachIndexed { index, event ->
                    EventCard(
                        event, PortalSchedule.isPast(event, now),
                        if (index == first) (if (PortalSchedule.isHappening(event, now)) "NOW" else "NEXT") else null, ink,
                    )
                }
            }
        },
        bottom = {
            if (homework.isNotEmpty()) {
                Label("HOMEWORK", ink)
                homework.forEach { work ->
                    Row(Modifier.fillMaxWidth().card(ink.copy(alpha = .12f), 14.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(work.title, color = ink, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(DisplayTime.dueLabel(work.dueDate, today), color = ink, fontSize = 14.sp)
                    }
                }
            }
        },
    )
}

@Composable
private fun FamilyColumn(modifier: Modifier, wide: Boolean, context: DisplayContext, today: String, nowMillis: Long, now: java.time.LocalTime) {
    val items = PortalSchedule.memberEvents(context, today, null)
    val coming = PortalSchedule.upcoming(context, nowMillis, context.timeZone).filter { it.memberId == null && it.date > today }.take(3)
    val meals = context.meals.filter { it.date == today }
    val dinner = meals.firstOrNull { it.slot.equals("dinner", true) }?.title
        ?: meals.takeIf { it.isNotEmpty() }?.joinToString(" / ") { "${it.slot.replaceFirstChar(Char::uppercase)} · ${it.title}" }
    BoardColumn(
        modifier, wide, FamilyGround, Color.White, FamilyViolet, Color.White,
        context.family.name.take(1).uppercase().ifEmpty { "F" }, "Family", null,
        items = {
            val first = items.indexOfFirst { !PortalSchedule.isPast(it, now) }
            items.forEachIndexed { index, event ->
                EventCard(
                    event, PortalSchedule.isPast(event, now),
                    if (index == first) (if (PortalSchedule.isHappening(event, now)) "NOW" else "NEXT") else null, Lilac,
                )
            }
            if (items.isEmpty()) Text("Nothing on the family calendar today.", color = Lilac, fontSize = 18.sp)
        },
        bottom = {
            if (context.device.showMeals) Column(Modifier.fillMaxWidth().card(FamilyCard, 18.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label("DINNER TONIGHT", Lilac)
                if (dinner != null) Text(dinner, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                else Text("Nothing planned yet", color = Lilac, fontSize = 18.sp)
            }
            if (coming.isNotEmpty()) {
                Label("COMING UP", Lilac)
                coming.forEachIndexed { index, event ->
                    if (index > 0) HorizontalDivider(color = FamilyDivider)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(event.title, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text("${dayName(event.date, "EEE")} ${DisplayTime.shortTime(event.time)}", color = Lilac, fontSize = 14.sp, style = Tabular)
                    }
                }
            }
        },
    )
}

/** White card on a coloured column. [mark] colours the check, the NEXT/NOW pill and the highlight border. */
@Composable
private fun EventCard(event: DisplayEvent, past: Boolean, marker: String?, mark: Color, compact: Boolean = false) {
    val ink = Ink
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth()
            .card(Color.White.copy(alpha = if (past) .55f else 1f), 18.dp)
            .then(if (marker != null) Modifier.border(3.dp, mark, shape) else Modifier)
            .padding(horizontal = 14.dp, vertical = if (compact) 8.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 12-hour times need their am/pm: a 7:00 pm job must not read as a morning one.
        Column(Modifier.width(68.dp)) {
            Text(
                boardTime(event), color = ink, style = Tabular, fontSize = if (event.allDay || event.time.isBlank()) 15.sp else 20.sp,
                fontWeight = FontWeight.ExtraBold, maxLines = 1,
            )
            DisplayTime.meridiem(event.time).takeIf { !event.allDay && it.isNotEmpty() }?.let {
                Text(it, color = ink, fontSize = 13.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (marker != null) Pill(marker, mark, inkOn(mark))
            Text(
                event.title, color = ink, fontSize = if (compact) 17.sp else 21.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textDecoration = if (past) TextDecoration.LineThrough else null,
            )
        }
        if (past) Box(Modifier.size(28.dp).background(ink, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Check, "Done", Modifier.size(18.dp), tint = Color.White)
        }
    }
}

// ───────────────────────────── Night board ─────────────────────────────

@Composable
internal fun NightBoard(state: PortalState, context: DisplayContext, photos: List<ImageBitmap>, onSettings: () -> Unit, onWeek: () -> Unit) {
    val now = Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(context.timeZone))
    val today = now.toLocalDate().toString()
    val upcoming = PortalSchedule.upcoming(context, state.nowMillis, context.timeZone)
    val next = upcoming.firstOrNull()
    val then = upcoming.getOrNull(1)
    val laterAll = upcoming.drop(2).filter { it.date == today }
    val later = laterAll.take(3)
    val days = context.days.filter { it.date > today }.take(6)
    BoxWithConstraints(Modifier.fillMaxSize().background(NightGround)) {
        val wide = maxWidth >= 900.dp
        val body: @Composable ColumnScope.() -> Unit = {
            Row(Modifier.fillMaxWidth().height(56.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                CompositionLocalProvider(LocalContentColor provides NightMuted) {
                    ActionIcon(Icons.Outlined.CalendarMonth, "Week view", onWeek)
                    ActionIcon(Icons.Outlined.Settings, "Display settings", onSettings)
                }
            }
            if (wide) {
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    // Drop LATER TODAY rather than squeeze the Up next card on a short screen.
                    val roomForLater = maxHeight >= 600.dp
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(48.dp)) {
                        if (photos.isEmpty()) NightClock(Modifier.weight(1f).fillMaxHeight(), state, context, later, true)
                        else NightPhoto(Modifier.weight(1f).fillMaxHeight(), state, context, photos, true)
                        NightNext(
                            Modifier.weight(1.05f).fillMaxHeight(), context, today, next, then, state.nowMillis, true, Modifier.weight(1f),
                            if (photos.isNotEmpty() && roomForLater) laterAll.take(2) else emptyList(),
                        )
                    }
                }
            } else {
                if (photos.isEmpty()) NightClock(Modifier.fillMaxWidth(), state, context, later, false)
                else NightPhoto(Modifier.fillMaxWidth().height(360.dp), state, context, photos, false)
                Spacer(Modifier.height(24.dp))
                NightNext(
                    Modifier.fillMaxWidth(), context, today, next, then, state.nowMillis, false, Modifier.height(320.dp),
                    if (photos.isNotEmpty()) laterAll.take(2) else emptyList(),
                )
            }
            if (days.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                DayTiles(days, context, wide)
            }
        }
        if (wide) Column(Modifier.fillMaxSize().padding(start = 40.dp, end = 28.dp, bottom = 24.dp), content = body)
        else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 12.dp, bottom = 24.dp), content = body)
    }
}

@Composable
private fun NightClock(modifier: Modifier, state: PortalState, context: DisplayContext, later: List<DisplayEvent>, wide: Boolean) {
    Column(modifier, verticalArrangement = Arrangement.SpaceBetween) {
        Column {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    DisplayTime.clock12(state.nowMillis, context.timeZone), color = NightText, style = Tabular,
                    fontSize = if (wide) 160.sp else 110.sp, lineHeight = if (wide) 150.sp else 110.sp, fontWeight = FontWeight.ExtraLight,
                )
                Text(DisplayTime.clockMeridiem(state.nowMillis, context.timeZone), color = NightMuted, fontSize = 32.sp, fontWeight = FontWeight.Light, modifier = Modifier.padding(start = 8.dp, bottom = 18.dp))
            }
            Text(
                runCatching { Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(context.timeZone)).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault())) }.getOrDefault(""),
                color = NightSoft, fontSize = 26.sp, fontWeight = FontWeight.Light,
            )
        }
        Column(Modifier.padding(top = 20.dp)) {
            Label("LATER TODAY", NightMuted)
            Spacer(Modifier.height(6.dp))
            if (later.isEmpty()) Text("Nothing else tonight.", color = NightSoft, fontSize = 22.sp, fontWeight = FontWeight.Light, modifier = Modifier.padding(vertical = 12.dp))
            later.forEachIndexed { index, event ->
                if (index > 0) HorizontalDivider(color = NightDivider)
                NightRow(context, event, today = true)
            }
        }
    }
}

@Composable
private fun NightPhoto(modifier: Modifier, state: PortalState, context: DisplayContext, photos: List<ImageBitmap>, wide: Boolean) {
    Box(modifier.clip(RoundedCornerShape(32.dp)).background(NightGround)) {
        Crossfade(PortalSchedule.photoIndex(state.nowMillis, photos.size), Modifier.fillMaxSize(), label = "photo") { index ->
            photos.getOrNull(index)?.let {
                // Dimmed a little: the screen lives in a dark room.
                Image(
                    it, "Family photo", Modifier.fillMaxSize().alpha(.85f),
                    contentScale = ContentScale.Crop, alignment = BiasAlignment(0f, -0.35f),
                )
            }
        }
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(.45f)
                .background(Brush.verticalGradient(listOf(Color.Transparent, NightGround.copy(alpha = .85f))))
        )
        Column(Modifier.align(Alignment.BottomStart).padding(start = 28.dp, end = 28.dp, bottom = 24.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    DisplayTime.clock12(state.nowMillis, context.timeZone), color = Color.White, style = Tabular,
                    fontSize = if (wide) 120.sp else 96.sp, lineHeight = if (wide) 120.sp else 96.sp, fontWeight = FontWeight.ExtraLight,
                )
                Text(DisplayTime.clockMeridiem(state.nowMillis, context.timeZone), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Light, modifier = Modifier.padding(start = 8.dp, bottom = 14.dp))
            }
            Text(
                runCatching { Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(context.timeZone)).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault())) }.getOrDefault(""),
                color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Light,
            )
        }
    }
}

@Composable
private fun NightRow(context: DisplayContext, event: DisplayEvent, today: Boolean) {
    val color = eventColor(context, event)
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            if (today) clockTime(event) else "${dayName(event.date, "EEE")} ${clockTime(event)}",
            color = NightSoft, style = Tabular, fontSize = 22.sp, fontWeight = FontWeight.Light, maxLines = 1, modifier = Modifier.widthIn(min = 96.dp),
        )
        Text(event.title, color = NightText, fontSize = 22.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Pill(eventOwner(context, event), color.copy(alpha = .25f), lerp(color, Color.White, .5f))
    }
}

@Composable
private fun NightNext(
    modifier: Modifier,
    context: DisplayContext,
    today: String,
    next: DisplayEvent?,
    then: DisplayEvent?,
    nowMillis: Long,
    wide: Boolean,
    cardModifier: Modifier,
    laterRows: List<DisplayEvent> = emptyList(),
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (next == null) {
            Column(cardModifier.fillMaxWidth().card(NightCard, 32.dp).padding(if (wide) 36.dp else 24.dp), verticalArrangement = Arrangement.Bottom) {
                Text("All clear", color = NightText, fontSize = if (wide) 64.sp else 44.sp, fontWeight = FontWeight.SemiBold)
                Text("Nothing else on the calendar this week.", color = NightSoft, fontSize = 24.sp, fontWeight = FontWeight.Light)
            }
            return@Column
        }
        val color = eventColor(context, next)
        val ink = inkOn(color)
        val zone = DisplayTime.zone(context.timeZone)
        val happening = next.date == today && PortalSchedule.isHappening(next, Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalTime())
        val minutes = PortalSchedule.minutesUntil(next, nowMillis, context.timeZone)
        val tomorrow = LocalDate.parse(today).plusDays(1).toString()
        val whenText = when {
            happening -> "now"
            minutes >= 1440 -> "in ${minutes / 1440} d"
            minutes >= 60 -> "in ${minutes / 60} h" + if (minutes % 60 > 0) " ${minutes % 60} min" else ""
            else -> "in $minutes min"
        }
        Column(cardModifier.fillMaxWidth().card(color, 32.dp).padding(if (wide) 36.dp else 24.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Label(
                    when {
                        next.date == today -> "UP NEXT"
                        next.date == tomorrow -> "TOMORROW"
                        else -> dayName(next.date, "EEEE").uppercase()
                    },
                    ink,
                )
                Spacer(Modifier.weight(1f))
                Pill(whenText, ink.copy(alpha = .18f), ink)
            }
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(next.title, color = ink, fontSize = if (wide) 64.sp else 44.sp, lineHeight = if (wide) 70.sp else 50.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val owner = eventOwner(context, next)
                    Avatar(if (next.memberId == null) context.family.name.take(1).uppercase().ifEmpty { "F" } else owner.take(1).uppercase(), ink, color, 40.dp)
                    Text("$owner · ${clockTime(next)}", color = ink, fontSize = 26.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
        if (then != null) Row(
            Modifier.fillMaxWidth().card(NightCard, 24.dp).padding(horizontal = 24.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Label("THEN", NightMuted)
            Spacer(Modifier.width(16.dp))
            Box(Modifier.weight(1f)) { NightRow(context, then, today = then.date == today) }
        }
        if (then != null && laterRows.isNotEmpty()) Column(Modifier.fillMaxWidth().card(NightCard, 24.dp).padding(horizontal = 24.dp, vertical = 12.dp)) {
            Label("LATER TODAY", NightMuted)
            laterRows.forEachIndexed { index, event ->
                if (index > 0) HorizontalDivider(color = NightDivider)
                NightRow(context, event, today = true)
            }
        }
    }
}

@Composable
private fun DayTiles(days: List<DisplayDay>, context: DisplayContext, wide: Boolean) {
    Row(
        (if (wide) Modifier else Modifier.horizontalScroll(rememberScrollState())).fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        days.forEach { day ->
            val events = PortalSchedule.events(context, day.date)
            val first = events.firstOrNull { !it.allDay && it.time.isNotBlank() } ?: events.firstOrNull()
            Column(
                (if (wide) Modifier.weight(1f) else Modifier.width(150.dp)).fillMaxHeight().card(NightCard, 18.dp).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(dayName(day.date, "EEE").uppercase(), color = NightMuted, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.5.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    events.take(8).forEach { Box(Modifier.size(10.dp).background(eventColor(context, it), CircleShape)) }
                }
                if (first == null) Text("Nothing planned", color = NightMuted, fontSize = 15.sp)
                else Text(
                    if (first.memberId == null) first.title else "${eventOwner(context, first)} · ${first.title}",
                    color = NightSoft, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
