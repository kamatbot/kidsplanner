package com.fametc.app

import com.fametc.app.data.model.HomeworkItem
import org.junit.Assert.assertEquals
import org.junit.Test

class StudyStartPriorityTest {

    @Test
    fun testHomeworkUrgencySort() {
        val hw1 = HomeworkItem(id = "1", title = "Science Lab", dueDate = "2026-09-08", dueTime = "14:00", status = "todo")
        val hw2 = HomeworkItem(id = "2", title = "History Essay", dueDate = "2026-09-07", dueTime = "09:00", status = "todo")
        val hwDone = HomeworkItem(id = "3", title = "Math Homework", dueDate = "2026-09-05", status = "done")

        val list = listOf(hw1, hwDone, hw2)

        val sorted = list.filter { !it.isDone }.sortedWith(
            compareBy<HomeworkItem> { it.dueDate }
                .thenBy { it.dueTime ?: "23:59" }
        )

        assertEquals("2", sorted.first().id)
        assertEquals("History Essay", sorted.first().title)
    }
}
