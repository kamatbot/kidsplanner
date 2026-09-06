package com.fametc.app.data.local

import android.content.Context
import com.fametc.app.data.model.*
import com.fametc.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File

@Serializable
data class CachedAppState(
    val me: User? = null,
    val family: Family? = null,
    val messagesByRoom: Map<String, List<ChatMessage>> = emptyMap(),
    val events: List<CalendarEvent> = emptyList(),
    val familyEvents: List<FamilyEvent> = emptyList(),
    val homework: List<HomeworkItem> = emptyList(),
    val actions: List<FamilyAction> = emptyList(),
    val notes: List<Note> = emptyList(),
    val meals: MealsState? = null
)

class DiskCache(context: Context) {

    private val cacheFile = File(context.filesDir, "fametc_state_cache.json")

    suspend fun load(): CachedAppState? = withContext(Dispatchers.IO) {
        try {
            if (!cacheFile.exists()) return@withContext null
            val content = cacheFile.readText()
            ApiClient.json.decodeFromString<CachedAppState>(content)
        } catch (e: Exception) {
            null
        }
    }

    suspend fun save(state: CachedAppState) = withContext(Dispatchers.IO) {
        try {
            val content = ApiClient.json.encodeToString(state)
            cacheFile.writeText(content)
        } catch (e: Exception) {
            // best-effort persistence
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        try {
            if (cacheFile.exists()) {
                cacheFile.delete()
            }
        } catch (e: Exception) {
            // ignore
        }
    }
}
