package com.fametc.app

import com.fametc.app.data.model.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ModelsTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun testUserSerialization() {
        val user = User(
            id = "u_123",
            email = "parent@fametc.com",
            name = "Jane Doe",
            role = "parent"
        )
        val str = json.encodeToString(user)
        val decoded = json.decodeFromString<User>(str)
        assertEquals("u_123", decoded.id)
        assertEquals("Jane Doe", decoded.name)
        assertEquals("parent", decoded.role)
    }

    @Test
    fun testChatMessageSerialization() {
        val msg = ChatMessage(
            id = "m_1",
            familyId = "f_1",
            senderType = "parent",
            senderId = "u_123",
            text = "Welcome to Fam ETC!",
            createdAt = "2026-09-06T12:00:00Z"
        )
        val str = json.encodeToString(msg)
        val decoded = json.decodeFromString<ChatMessage>(str)
        assertEquals("m_1", decoded.id)
        assertEquals("Welcome to Fam ETC!", decoded.text)
        assertEquals(FAMILY_ROOM_ID, decoded.effectiveRoomId)
    }

    @Test
    fun testHomeworkItemChecklistCount() {
        val hw = HomeworkItem(
            id = "hw_1",
            title = "Math Algebra",
            dueDate = "2026-09-10",
            status = "in_progress",
            checklist = listOf(
                HomeworkChecklistItem("Problems 1-5", done = true),
                HomeworkChecklistItem("Problems 6-10", done = false)
            )
        )
        assertEquals(1, hw.completedChecklistCount)
        assertEquals(1, hw.remainingChecklistCount)
        assertFalse(hw.isDone)
    }
}
