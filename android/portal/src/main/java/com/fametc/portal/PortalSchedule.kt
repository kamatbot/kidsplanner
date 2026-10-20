package com.fametc.portal

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/** Shared calendar selection rules, independent of Android or the current clock. */
object PortalSchedule {
    val NIGHT_BOARD_START: LocalTime = LocalTime.of(20, 30)
    val NIGHT_BOARD_END: LocalTime = LocalTime.of(6, 0)

    fun isNightBoard(now: LocalTime): Boolean = DisplayTime.isNight(now, NIGHT_BOARD_START, NIGHT_BOARD_END)

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

    /** One column of the day board: events for exactly this member (null = family-only). */
    fun memberEvents(context: DisplayContext, date: String, memberId: String?): List<DisplayEvent> =
        events(context, date).filter { it.memberId == memberId }

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

    /** Timed event that has finished (or, without an end time, already started) and is not running now. */
    fun isPast(event: DisplayEvent, now: LocalTime): Boolean {
        if (event.allDay) return false
        val start = parseTime(event.time) ?: return false
        if (isHappening(event, now)) return false
        val minute = now.truncatedTo(ChronoUnit.MINUTES)
        val end = parseTime(event.endTime)
        return if (end != null && end >= start) end <= minute else start < minute
    }

    /** Timed events still to come, starting with any that are running now; sorted by date then time. */
    fun upcoming(context: DisplayContext, nowMillis: Long, timeZone: String): List<DisplayEvent> {
        val now = Instant.ofEpochMilli(nowMillis).atZone(DisplayTime.zone(timeZone))
        val today = now.toLocalDate().toString()
        val minute = now.toLocalTime().truncatedTo(ChronoUnit.MINUTES)
        return context.days.filter { it.date >= today }
            .flatMap { day -> day.events.filter { !it.allDay && parseTime(it.time) != null }.map { day.date to it } }
            .filter { (date, event) ->
                date > today || isHappening(event, now.toLocalTime()) || parseTime(event.time)!! >= minute
            }
            .sortedWith(compareBy({ it.first }, { it.second.time }, { it.second.title }))
            .map { it.second }
    }

    fun minutesUntil(event: DisplayEvent, nowMillis: Long, timeZone: String): Long {
        val zone = DisplayTime.zone(timeZone)
        val now = Instant.ofEpochMilli(nowMillis).atZone(zone)
        if (event.date == now.toLocalDate().toString() && isHappening(event, now.toLocalTime())) return 0
        val date = runCatching { LocalDate.parse(event.date) }.getOrNull() ?: return 0
        val start = date.atTime(parseTime(event.time) ?: return 0).atZone(zone)
        return maxOf(0, ChronoUnit.MINUTES.between(now.truncatedTo(ChronoUnit.MINUTES), start))
    }

    fun homework(context: DisplayContext, memberId: String?, familyOnly: Boolean): List<DisplayHomework> =
        if (familyOnly) emptyList() else context.homework
            .filter { !it.completed && (memberId == null || it.memberId == memberId) }
            .sortedWith(compareBy<DisplayHomework> { it.dueDate.isBlank() }.thenBy { it.dueDate }.thenBy { it.title })

    /** Which photo the Night board shows: rotates every 10 seconds. */
    fun photoIndex(nowMillis: Long, count: Int): Int =
        if (count <= 0) 0 else Math.floorMod(nowMillis / 10_000L, count.toLong()).toInt()

    /** A manual Day/Night choice holds only while the scheduled mode is the one it was made in. */
    fun boardIsNight(scheduledNight: Boolean, manualNight: Boolean?, manualSetDuringNight: Boolean?): Boolean =
        if (manualNight != null && manualSetDuringNight == scheduledNight) manualNight else scheduledNight

    private fun parseTime(value: String): LocalTime? = runCatching { LocalTime.parse(value) }.getOrNull()
}
