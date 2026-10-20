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

    @Test fun nextCardPositionRoundTripsAndStaysOnScreen() {
        assertEquals(800f, cardOffset(1f, 800f), 0f)
        assertEquals(0f, cardOffset(0f, 800f), 0f)
        assertEquals(400f, cardOffset(.5f, 800f), 0f)
        assertEquals(0f, cardOffset(1f, -20f), 0f)
        assertEquals(0.25f, cardFraction(200f, 800f), 0f)
        assertEquals(1f, cardFraction(900f, 800f), 0f)
        assertEquals(0f, cardFraction(-5f, 800f), 0f)
        assertEquals(1f, cardFraction(10f, 0f), 0f)
        assertEquals(0.3f, cardFraction(cardOffset(.3f, 1234f), 1234f), 1e-6f)
    }
}
