package com.fametc.portal

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class PortalBoardsTest {
    @Test fun textColourFollowsBestContrastOnMemberColours() {
        val ink = Color(0xFF14151C)
        assertEquals(Color.White, inkOn(Color(0xFF6C63FF)))
        assertEquals(ink, inkOn(Color(0xFFFF6B9D)))
        assertEquals(ink, inkOn(Color(0xFF65CBB5)))
        assertEquals(Color.White, inkOn(Color(0xFF7B4DFF)))
    }
}
