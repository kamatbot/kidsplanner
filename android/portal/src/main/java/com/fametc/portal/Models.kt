package com.fametc.portal

import kotlinx.serialization.Serializable

@Serializable
data class DisplayDevice(
    val id: String,
    val label: String,
    val timeZone: String,
    val showHomework: Boolean = true,
    val showMeals: Boolean = true,
    val model: String = "",
    val createdAt: String,
    val lastSeenAt: String? = null,
    val revokedAt: String? = null,
)

@Serializable
data class PairResponse(val token: String, val device: DisplayDevice)

@Serializable
data class PairRequest(val code: String, val model: String)

@Serializable
data class DisplayContext(
    val schemaVersion: Int,
    val generatedAt: String,
    val pollAfterSeconds: Int = 60,
    val cacheMaxAgeSeconds: Int = 43200,
    val today: String,
    val timeZone: String,
    val family: DisplayFamily,
    val device: DisplayIdentity,
    val members: List<DisplayMember> = emptyList(),
    val days: List<DisplayDay> = emptyList(),
    val homework: List<DisplayHomework> = emptyList(),
    val meals: List<DisplayMeal> = emptyList(),
    val notices: List<String> = emptyList(),
)

@Serializable data class DisplayFamily(val name: String)
@Serializable data class DisplayIdentity(
    val id: String,
    val label: String,
    val showHomework: Boolean = true,
    val showMeals: Boolean = true,
)
@Serializable data class DisplayMember(val id: String, val name: String, val color: String)
@Serializable data class DisplayDay(val date: String, val events: List<DisplayEvent> = emptyList())

@Serializable
data class DisplayEvent(
    val id: String,
    val title: String,
    val date: String,
    val time: String = "",
    val endTime: String = "",
    val allDay: Boolean = false,
    val memberId: String? = null,
    val color: String = "#7B4DFF",
    val location: String = "",
)

@Serializable
data class DisplayHomework(
    val id: String,
    val memberId: String,
    val title: String,
    val subject: String = "",
    val dueDate: String = "",
    val completed: Boolean = false,
)

@Serializable data class DisplayMeal(val date: String, val slot: String, val title: String)

@Serializable
data class SavedDisplay(
    val token: String,
    val device: DisplayDevice,
    val cached: DisplayContext? = null,
    val savedWallMillis: Long = 0,
    val savedElapsedMillis: Long = 0,
    val bootCount: Int = -1,
    val cacheSessionId: String = "",
)

data class PortalState(
    val loading: Boolean = true,
    val paired: Boolean = false,
    val pairing: Boolean = false,
    val refreshing: Boolean = false,
    val demo: Boolean = false,
    val context: DisplayContext? = null,
    val device: DisplayDevice? = null,
    val error: String? = null,
    val offline: Boolean = false,
    val nowMillis: Long = System.currentTimeMillis(),
)
