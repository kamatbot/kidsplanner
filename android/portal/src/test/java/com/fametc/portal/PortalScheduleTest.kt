package com.fametc.portal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalTime

class PortalScheduleTest {
    private val day = "2026-10-20"
    private val now = Instant.parse("2026-10-20T09:20:00Z").toEpochMilli() // 16:20 in Bangkok.
    private val family = event("family", null, "15:00", "15:30")
    private val sam = event("sam-swim", "sam", "16:15", "17:00")
    private val alex = event("alex-music", "alex", "17:00", "17:45")

    @Test fun everyoneIsDefaultAndMemberFilterRetainsSharedFamilyPlans() {
        val context = context(listOf(alex, family, sam))
        assertEquals(listOf("family", "sam-swim", "alex-music"), PortalSchedule.events(context, day).map { it.id })
        assertEquals(listOf("family", "sam-swim"), PortalSchedule.events(context, day, memberId = "sam").map { it.id })
        assertEquals(listOf("family"), PortalSchedule.events(context, day, familyOnly = true).map { it.id })
    }

    @Test fun allDayIsFirstAndUntimedIsLastWithoutInventingTimes() {
        val allDay = event("all-day", null, "", "").copy(allDay = true)
        val untimed = event("untimed", null, "", "")
        val context = context(listOf(untimed, sam, allDay, family))
        assertEquals(listOf("all-day", "family", "sam-swim", "untimed"), PortalSchedule.events(context, day).map { it.id })
    }

    @Test fun currentlyRunningEventTakesPriorityOverLaterStart() {
        assertEquals("sam-swim", PortalSchedule.nextEvent(listOf(family, sam, alex), day, now, "Asia/Bangkok")?.id)
    }

    @Test fun finishedAndPastDaysDoNotBecomeUpcoming() {
        assertNull(PortalSchedule.nextEvent(listOf(family), day, now, "Asia/Bangkok"))
        assertNull(PortalSchedule.nextEvent(listOf(sam), "2026-10-19", now, "Asia/Bangkok"))
    }

    @Test fun futureDayUsesItsFirstTimedEvent() {
        val future = "2026-10-21"
        assertEquals("sam-swim", PortalSchedule.nextEvent(listOf(sam.copy(date = future), alex.copy(date = future)), future, now, "Asia/Bangkok")?.id)
    }

    @Test fun eventWithoutEndDoesNotInventDuration() {
        val endedUnknown = event("no-end", null, "16:00", "")
        assertEquals("alex-music", PortalSchedule.nextEvent(listOf(endedUnknown, alex), day, now, "Asia/Bangkok")?.id)
    }

    @Test fun homeworkIsReadOnlyProjectionOfIncompleteTasksAcrossMembers() {
        val data = context(emptyList()).copy(homework = listOf(
            DisplayHomework("undated", "sam", "Undated", dueDate = ""),
            DisplayHomework("done", "sam", "Done", dueDate = day, completed = true),
            DisplayHomework("tomorrow", "alex", "Tomorrow", dueDate = "2026-10-21"),
            DisplayHomework("overdue", "sam", "Overdue", dueDate = "2026-10-19"),
        ))
        assertEquals(listOf("overdue", "tomorrow", "undated"), PortalSchedule.homework(data, null, false).map { it.id })
        assertEquals(listOf("overdue", "undated"), PortalSchedule.homework(data, "sam", false).map { it.id })
        assertTrue(PortalSchedule.homework(data, null, true).isEmpty())
    }

    @Test fun nightBoardWindowEdges() {
        assertFalse(PortalSchedule.isNightBoard(LocalTime.of(20, 29)))
        assertTrue(PortalSchedule.isNightBoard(LocalTime.of(20, 30)))
        assertTrue(PortalSchedule.isNightBoard(LocalTime.of(0, 0)))
        assertTrue(PortalSchedule.isNightBoard(LocalTime.of(5, 59)))
        assertFalse(PortalSchedule.isNightBoard(LocalTime.of(6, 0)))
    }

    @Test fun memberEventsAreExactAndFamilyOnlyForNull() {
        val context = context(listOf(alex, family, sam))
        assertEquals(listOf("sam-swim"), PortalSchedule.memberEvents(context, day, "sam").map { it.id })
        assertEquals(listOf("family"), PortalSchedule.memberEvents(context, day, null).map { it.id })
        assertTrue(PortalSchedule.memberEvents(context, "2026-10-21", "sam").isEmpty())
    }

    @Test fun isPastUsesEndTimeThenStartAndNeverFlagsRunningOrUntimed() {
        val t = LocalTime.of(16, 20)
        assertTrue(PortalSchedule.isPast(family, t))                       // 15:00-15:30 ended
        assertFalse(PortalSchedule.isPast(sam, t))                         // 16:15-17:00 happening
        assertFalse(PortalSchedule.isPast(alex, t))                        // future
        assertTrue(PortalSchedule.isPast(event("no-end", null, "16:00", ""), t))
        assertFalse(PortalSchedule.isPast(event("no-end-future", null, "16:30", ""), t))
        assertFalse(PortalSchedule.isPast(event("same-minute", null, "16:20", ""), LocalTime.of(16, 20, 45)))
        assertFalse(PortalSchedule.isPast(event("all", null, "", "").copy(allDay = true), t))
        assertFalse(PortalSchedule.isPast(event("untimed", null, "", ""), t))
        assertFalse(PortalSchedule.isPast(event("bad", null, "soon", ""), t))
    }

    @Test fun upcomingSpansTodayAndLaterDaysWithoutPastOrAllDay() {
        val tomorrow = "2026-10-21"
        val data = context(listOf(family, sam, alex, event("all", null, "", "").copy(allDay = true), event("untimed", null, "", ""))).copy(
            days = listOf(
                DisplayDay(day, listOf(family, sam, alex, event("all", null, "", "").copy(allDay = true), event("untimed", null, "", ""))),
                DisplayDay(tomorrow, listOf(sam.copy(id = "t-late", date = tomorrow, time = "18:00"), sam.copy(id = "t-early", date = tomorrow, time = "08:00"))),
            ),
        )
        assertEquals(listOf("sam-swim", "alex-music", "t-early", "t-late"), PortalSchedule.upcoming(data, now, "Asia/Bangkok").map { it.id })
    }

    @Test fun minutesUntilCountsToStartAndIsZeroWhileHappening() {
        assertEquals(40, PortalSchedule.minutesUntil(alex, now, "Asia/Bangkok"))
        assertEquals(0, PortalSchedule.minutesUntil(sam, now, "Asia/Bangkok"))
        assertEquals(24 * 60 + 40, PortalSchedule.minutesUntil(alex.copy(date = "2026-10-21"), now, "Asia/Bangkok"))
    }

    private fun event(id: String, member: String?, start: String, end: String) = DisplayEvent(
        id = id, title = id, date = day, time = start, endTime = end, memberId = member,
    )

    private fun context(events: List<DisplayEvent>) = DisplayContext(
        schemaVersion = 1,
        generatedAt = "2026-10-20T09:20:00Z",
        today = day,
        timeZone = "Asia/Bangkok",
        family = DisplayFamily("Test family"),
        device = DisplayIdentity("display-1", "Kitchen"),
        days = listOf(DisplayDay(day, events)),
    )
}
