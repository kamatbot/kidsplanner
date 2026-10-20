package com.fametc.portal

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object DisplayTime {
    fun zone(value: String?): ZoneId = runCatching { ZoneId.of(value ?: "Asia/Bangkok") }
        .getOrDefault(ZoneId.of("Asia/Bangkok"))

    fun today(nowMillis: Long, timeZone: String?): LocalDate =
        Instant.ofEpochMilli(nowMillis).atZone(zone(timeZone)).toLocalDate()

    fun isNight(now: LocalTime, start: LocalTime, end: LocalTime): Boolean = when {
        start == end -> false
        start < end -> now >= start && now < end
        else -> now >= start || now < end
    }

    fun validCache(record: SavedDisplay, wallMillis: Long, elapsedMillis: Long, bootCount: Int, sessionId: String = ""): Boolean {
        val cached = record.cached ?: return false
        if (record.savedWallMillis <= 0 || wallMillis < record.savedWallMillis) return false
        val wallAge = wallMillis - record.savedWallMillis
        val sameBoot = bootCount >= 0 && bootCount == record.bootCount
        val sameSession = sessionId.isNotBlank() && sessionId == record.cacheSessionId
        // A changed or unverifiable boot cannot prove the age of an offline
        // snapshot. Keep the credential, but fetch a fresh view before showing it.
        if (!sameBoot && !sameSession) return false
        if (record.savedElapsedMillis < 0 || elapsedMillis < record.savedElapsedMillis) return false
        val elapsedAge = elapsedMillis - record.savedElapsedMillis
        val age = maxOf(wallAge, elapsedAge)
        val lease = cached.cacheMaxAgeSeconds.coerceIn(0, 43200).toLong() * 1000
        return lease > 0 && age < lease
    }

    fun clock(nowMillis: Long, timeZone: String?): String = Instant.ofEpochMilli(nowMillis)
        .atZone(zone(timeZone)).format(DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()))

    fun dateLabel(date: String): String = runCatching {
        LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()))
    }.getOrDefault(date)

    fun dueLabel(date: String, today: String): String {
        if (date.isBlank()) return "No due date"
        val parsed = runCatching { LocalDate.parse(date) }.getOrNull() ?: return "Due date unavailable"
        val current = runCatching { LocalDate.parse(today) }.getOrDefault(parsed)
        return when {
            parsed < current -> "Overdue · ${parsed.format(DateTimeFormatter.ofPattern("d MMM"))}"
            parsed == current -> "Due today"
            parsed == current.plusDays(1) -> "Due tomorrow"
            else -> "Due ${parsed.format(DateTimeFormatter.ofPattern("EEE d MMM"))}"
        }
    }
}
