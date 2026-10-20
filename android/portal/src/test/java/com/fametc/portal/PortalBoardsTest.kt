package com.fametc.portal

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PortalBoardsTest {
    @Test fun photoSampleSizeKeepsLongestSideWithinLimitWithPowersOfTwo() {
        assertEquals(1, photoSampleSize(1600, 900))
        assertEquals(2, photoSampleSize(3200, 1800))
        assertEquals(4, photoSampleSize(4000, 3000))
        assertEquals(4, photoSampleSize(2000, 6400))
        assertEquals(1, photoSampleSize(0, 0))
        assertEquals(2, photoSampleSize(1601, 10))
    }

    @Test fun photosAreEqualByIdOnly() {
        assertEquals(PortalPhoto("a", byteArrayOf(1)), PortalPhoto("a", byteArrayOf(2, 3)))
        assertEquals(PortalPhoto("a", byteArrayOf(1)).hashCode(), PortalPhoto("a", byteArrayOf()).hashCode())
        assertNotEquals(PortalPhoto("a", byteArrayOf(1)), PortalPhoto("b", byteArrayOf(1)))
    }

    @Test fun textColourFollowsBestContrastOnMemberColours() {
        val ink = Color(0xFF14151C)
        assertEquals(Color.White, inkOn(Color(0xFF6C63FF)))
        assertEquals(ink, inkOn(Color(0xFFFF6B9D)))
        assertEquals(ink, inkOn(Color(0xFF65CBB5)))
        assertEquals(Color.White, inkOn(Color(0xFF7B4DFF)))
    }
}
