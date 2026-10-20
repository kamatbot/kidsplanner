package com.fametc.portal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** Source-only regression coverage. Execution is a separate, explicitly gated step. */
class DisplayTimeTest {
    private val wall = Instant.parse("2026-10-20T12:00:00Z").toEpochMilli()
    private val elapsed = 120_000L
    private val boot = 8
    private val session = "test-process-session"

    @Test fun overnightScheduleIncludesStartAndExcludesEnd() {
        val start = LocalTime.of(21, 0)
        val end = LocalTime.of(7, 0)
        assertFalse(DisplayTime.isNight(LocalTime.of(20, 59), start, end))
        assertTrue(DisplayTime.isNight(start, start, end))
        assertTrue(DisplayTime.isNight(LocalTime.MIDNIGHT, start, end))
        assertTrue(DisplayTime.isNight(LocalTime.of(6, 59), start, end))
        assertFalse(DisplayTime.isNight(end, start, end))
        assertFalse(DisplayTime.isNight(LocalTime.NOON, start, end))
    }

    @Test fun daytimeAndEqualHourSchedulesHaveExplicitBoundaries() {
        assertTrue(DisplayTime.isNight(LocalTime.NOON, LocalTime.of(9, 0), LocalTime.of(17, 0)))
        assertFalse(DisplayTime.isNight(LocalTime.of(17, 0), LocalTime.of(9, 0), LocalTime.of(17, 0)))
        assertFalse(DisplayTime.isNight(LocalTime.NOON, LocalTime.of(7, 0), LocalTime.of(7, 0)))
    }

    @Test fun displayDateUsesHouseholdZoneAcrossUtcMidnight() {
        val instant = Instant.parse("2026-10-20T17:15:00Z").toEpochMilli()
        assertEquals(LocalDate.of(2026, 10, 21), DisplayTime.today(instant, "Asia/Bangkok"))
        assertEquals(LocalDate.of(2026, 10, 20), DisplayTime.today(instant, "America/Los_Angeles"))
    }

    @Test fun cacheExpiresAtExactLeaseBoundary() {
        val record = record()
        val lease = 12 * 60 * 60 * 1000L
        assertTrue(DisplayTime.validCache(record, wall + lease - 1, elapsed + lease - 1, boot))
        assertFalse(DisplayTime.validCache(record, wall + lease, elapsed + lease, boot))
    }

    @Test fun monotonicClockPreventsPartialWallRollbackExtendingLease() {
        val lease = 12 * 60 * 60 * 1000L
        assertFalse(DisplayTime.validCache(record(), wall + 60_000, elapsed + lease, boot))
    }

    @Test fun wallAndElapsedRollbackBothRejectCache() {
        assertFalse(DisplayTime.validCache(record(), wall - 1, elapsed + 1, boot))
        assertFalse(DisplayTime.validCache(record(), wall + 1, elapsed - 1, boot))
    }

    @Test fun changedBootDiscardsSnapshotEvenWhenWallAgeLooksFresh() {
        assertFalse(DisplayTime.validCache(record(), wall + 60_000, 60_000, boot + 1, "another-process"))
        // A longer new uptime still does not prove this is the same boot.
        assertFalse(DisplayTime.validCache(record(), wall + 60_000, elapsed + 60_000, boot + 1))
    }

    @Test fun inaccessibleBootCountAllowsOnlyFreshCacheFromSameProcess() {
        val unknownBoot = record().copy(bootCount = -1)
        assertTrue(DisplayTime.validCache(unknownBoot, wall + 1_000, elapsed + 1_000, -1, session))
        assertFalse(DisplayTime.validCache(unknownBoot, wall + 1_000, elapsed + 1_000, -1, "another-process"))
        assertFalse(DisplayTime.validCache(unknownBoot, wall + 1_000, elapsed + 1_000, -1))
    }

    @Test fun knownSameBootSurvivesProcessRestartWithinLease() {
        assertTrue(DisplayTime.validCache(record(), wall + 1_000, elapsed + 1_000, boot, "another-process"))
    }

    @Test fun shorterServerLeaseAndTwelveHourMaximumAreEnforced() {
        val shorter = record(60)
        assertTrue(DisplayTime.validCache(shorter, wall + 59_999, elapsed + 59_999, boot))
        assertFalse(DisplayTime.validCache(shorter, wall + 60_000, elapsed + 60_000, boot))
        val oversized = record(86_400)
        val twelveHours = 43_200_000L
        assertFalse(DisplayTime.validCache(oversized, wall + twelveHours, elapsed + twelveHours, boot))
        assertFalse(DisplayTime.validCache(record(0), wall, elapsed, boot))
        assertFalse(DisplayTime.validCache(record().copy(cached = null), wall, elapsed, boot))
    }

    @Test fun dateOnlyDueLabelsNeverShiftThroughUtc() {
        assertEquals("Due today", DisplayTime.dueLabel("2026-10-20", "2026-10-20"))
        assertEquals("Due tomorrow", DisplayTime.dueLabel("2026-10-21", "2026-10-20"))
        assertEquals("No due date", DisplayTime.dueLabel("", "2026-10-20"))
    }

    private fun record(lease: Int = 43_200): SavedDisplay {
        val context = DisplayContext(
            schemaVersion = 1,
            generatedAt = "2026-10-20T12:00:00Z",
            cacheMaxAgeSeconds = lease,
            today = "2026-10-20",
            timeZone = "Asia/Bangkok",
            family = DisplayFamily("Test family"),
            device = DisplayIdentity("display-1", "Kitchen"),
        )
        return SavedDisplay(
            token = "fdp_" + "a".repeat(43),
            device = DisplayDevice("display-1", "Kitchen", "Asia/Bangkok", createdAt = "2026-10-20T12:00:00Z"),
            cached = context,
            savedWallMillis = wall,
            savedElapsedMillis = elapsed,
            bootCount = boot,
            cacheSessionId = session,
        )
    }
}
