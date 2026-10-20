package com.fametc.portal

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/** Shared calendar selection rules, independent of Android or the current clock. */
object PortalSchedule {
    fun events(
        context: DisplayContext,
        date: String,
        memberId: String? = null,
        familyOnly: Boolean = false,
    ): List<DisplayEvent> = context.days.firstOrNull { it.date == date }?.events.orEmpty()
        .filter {
            when {
                familyOnly -> it.memberId == null
                memberId != null -> it.memberId == null || it.memberId == memberId
                else -> true
            }
        }
        .sortedWith(compareBy<DisplayEvent> {
            when { it.allDay -> 0; it.time.isBlank() -> 2; else -> 1 }
        }.thenBy { it.time }.thenBy { it.title })

    fun nextEvent(events: List<DisplayEvent>, date: String, nowMillis: Long, timeZone: String): DisplayEvent? {
        val now = Instant.ofEpochMilli(nowMillis).atZone(DisplayTime.zone(timeZone))
        val day = runCatching { LocalDate.parse(date) }.getOrNull() ?: return null
        if (day < now.toLocalDate()) return null
        val timed = events.filter { !it.allDay && parseTime(it.time) != null }
        if (day > now.toLocalDate()) return timed.firstOrNull() ?: events.firstOrNull()
        return timed.firstOrNull { isHappening(it, now.toLocalTime()) }
            ?: timed.firstOrNull { parseTime(it.time)!! >= now.toLocalTime().truncatedTo(ChronoUnit.MINUTES) }
    }

    fun isHappening(event: DisplayEvent, now: LocalTime): Boolean {
        if (event.allDay) return false
        val start = parseTime(event.time) ?: return false
        val end = parseTime(event.endTime) ?: return false
        return if (end < start) now >= start else now >= start && now < end
    }

    fun homework(context: DisplayContext, memberId: String?, familyOnly: Boolean): List<DisplayHomework> =
        if (familyOnly) emptyList() else context.homework
            .filter { !it.completed && (memberId == null || it.memberId == memberId) }
            .sortedWith(compareBy<DisplayHomework> { it.dueDate.isBlank() }.thenBy { it.dueDate }.thenBy { it.title })

    private fun parseTime(value: String): LocalTime? = runCatching { LocalTime.parse(value) }.getOrNull()
}
