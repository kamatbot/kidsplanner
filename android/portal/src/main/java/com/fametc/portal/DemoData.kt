package com.fametc.portal

import java.time.Instant
import java.time.LocalDate

/** Invented sample household, only reachable through the labelled demo button. */
object DemoData {
    fun create(nowMillis: Long): DisplayContext {
        val zone = "Asia/Bangkok"
        val today = DisplayTime.today(nowMillis, zone)
        fun event(id: String, title: String, date: LocalDate, time: String, end: String, member: String?, color: String, place: String = "") =
            DisplayEvent(id, title, date.toString(), time, end, false, member, color, place)
        val days = (0L..6L).map { offset ->
            val date = today.plusDays(offset)
            DisplayDay(date.toString(), when (offset) {
                0L -> listOf(
                    event("demo-1", "School pickup", date, "15:00", "15:30", null, "#B39AFF", "Main gate"),
                    event("demo-2", "Swimming practice", date, "16:15", "17:00", "sam", "#65CBB5", "Community pool"),
                    event("demo-3", "Family dinner", date, "18:30", "19:15", null, "#B39AFF", "At home"),
                )
                1L -> listOf(event("demo-4", "Music lesson", date, "16:00", "16:45", "alex", "#FFC170"))
                3L -> listOf(event("demo-5", "Library afternoon", date, "15:30", "16:30", null, "#B39AFF"))
                5L -> listOf(event("demo-6", "Park and picnic", date, "10:00", "12:00", null, "#B39AFF"))
                else -> emptyList()
            })
        }
        return DisplayContext(
            schemaVersion = 1,
            generatedAt = Instant.ofEpochMilli(nowMillis).toString(),
            today = today.toString(),
            timeZone = zone,
            family = DisplayFamily("Rivera family"),
            device = DisplayIdentity("demo", "Sample kitchen display"),
            members = listOf(DisplayMember("sam", "Sam", "#65CBB5"), DisplayMember("alex", "Alex", "#FFC170")),
            days = days,
            homework = listOf(
                DisplayHomework("demo-h1", "sam", "Read the next chapter", "English", today.toString()),
                DisplayHomework("demo-h2", "alex", "Fractions practice", "Maths", today.plusDays(1).toString()),
                DisplayHomework("demo-h3", "sam", "Finish the plant journal", "Science", today.plusDays(2).toString()),
            ),
            meals = listOf(
                DisplayMeal(today.toString(), "dinner", "Lemon chicken & roasted vegetables"),
                DisplayMeal(today.plusDays(1).toString(), "dinner", "Build-your-own taco night"),
            ),
        )
    }
}
