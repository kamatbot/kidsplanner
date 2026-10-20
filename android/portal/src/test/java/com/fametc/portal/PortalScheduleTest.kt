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

    @Test fun photoSlidesPairPortraitsAndKeepLandscapesAlone() {
        assertEquals(emptyList<List<Int>>(), PortalSchedule.photoSlides(emptyList()))
        assertEquals(listOf(listOf(0), listOf(1)), PortalSchedule.photoSlides(listOf(false, false)))
        assertEquals(listOf(listOf(0, 1)), PortalSchedule.photoSlides(listOf(true, true)))
        // Landscape, portrait, landscape, portrait, landscape: the portraits pair on the first portrait's slot.
        assertEquals(listOf(listOf(0), listOf(1, 3), listOf(2), listOf(4)), PortalSchedule.photoSlides(listOf(false, true, false, true, false)))
        // An odd portrait out stays alone.
        assertEquals(listOf(listOf(0, 1), listOf(2)), PortalSchedule.photoSlides(listOf(true, true, true)))
        assertEquals(listOf(listOf(0)), PortalSchedule.photoSlides(listOf(true)))
    }

    @Test fun photoIndexRotatesEveryTenSecondsAndSurvivesEmptyLists() {
        assertEquals(0, PortalSchedule.photoIndex(now, 0))
        assertEquals(0, PortalSchedule.photoIndex(now, -1))
        assertEquals(0, PortalSchedule.photoIndex(0L, 3))
        assertEquals(0, PortalSchedule.photoIndex(9_999L, 3))
        assertEquals(1, PortalSchedule.photoIndex(10_000L, 3))
        assertEquals(2, PortalSchedule.photoIndex(20_000L, 3))
        assertEquals(0, PortalSchedule.photoIndex(30_000L, 3))
        assertEquals(1, PortalSchedule.photoIndex(40_000L, 3))
        assertEquals(0, PortalSchedule.photoIndex(now, 1))
    }

    @Test fun manualBoardChoiceHoldsWithinOneScheduledPeriodThenExpires() {
        // No override: the schedule decides.
        assertFalse(PortalSchedule.boardIsNight(false, null, null))
        assertTrue(PortalSchedule.boardIsNight(true, null, null))
        // Chose Night during the scheduled day: holds while the schedule stays Day.
        assertTrue(PortalSchedule.boardIsNight(false, true, false))
        // Chose Day during the scheduled night: holds while the schedule stays Night.
        assertFalse(PortalSchedule.boardIsNight(true, false, true))
        // The schedule flipped (20:30 / 06:00): the old choice lapses.
        assertTrue(PortalSchedule.boardIsNight(true, true, false))
        assertFalse(PortalSchedule.boardIsNight(false, false, true))
    }

    @Test fun contextWithoutPhotosDecodesEmptyAndWithPhotosKeepsIds() {
        val base = """{"schemaVersion":1,"generatedAt":"2026-10-20T09:20:00Z","today":"$day","timeZone":"Asia/Bangkok",
            "family":{"name":"Test"},"device":{"id":"d1","label":"Kitchen"}"""
        assertTrue(PortalApi.json.decodeFromString<DisplayContext>("$base}").photos.isEmpty())
        val id = "a_" + "0123456789abcdef".repeat(3).take(36)
        val withPhotos = PortalApi.json.decodeFromString<DisplayContext>(
            "$base,\"photos\":[{\"id\":\"$id\",\"createdAt\":\"2026-10-19T08:00:00Z\"}]}"
        )
        assertEquals(listOf(id), withPhotos.photos.map { it.id })
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
