package com.fametc.app.data.repository

import android.content.Context
import com.fametc.app.data.local.CachedAppState
import com.fametc.app.data.local.DiskCache
import com.fametc.app.data.model.*
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.data.remote.FamEtcApi
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.SimpleDateFormat
import java.util.*

class AppRepository(
    private val context: Context,
    private val api: FamEtcApi,
    private val diskCache: DiskCache
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Core Observables
    private val _me = MutableStateFlow<User?>(null)
    val me: StateFlow<User?> = _me.asStateFlow()

    private val _family = MutableStateFlow<Family?>(null)
    val family: StateFlow<Family?> = _family.asStateFlow()

    private val _chatRooms = MutableStateFlow<List<ChatRoom>>(listOf(ChatRoom(FAMILY_ROOM_ID, null, "Family")))
    val chatRooms: StateFlow<List<ChatRoom>> = _chatRooms.asStateFlow()

    private val _messagesByRoom = MutableStateFlow<Map<String, List<ChatMessage>>>(emptyMap())
    val messagesByRoom: StateFlow<Map<String, List<ChatMessage>>> = _messagesByRoom.asStateFlow()

    private val _events = MutableStateFlow<List<CalendarEvent>>(emptyList())
    val events: StateFlow<List<CalendarEvent>> = _events.asStateFlow()

    private val _familyEvents = MutableStateFlow<List<FamilyEvent>>(emptyList())
    val familyEvents: StateFlow<List<FamilyEvent>> = _familyEvents.asStateFlow()

    private val _homework = MutableStateFlow<List<HomeworkItem>>(emptyList())
    val homework: StateFlow<List<HomeworkItem>> = _homework.asStateFlow()

    private val _actions = MutableStateFlow<List<FamilyAction>>(emptyList())
    val actions: StateFlow<List<FamilyAction>> = _actions.asStateFlow()

    private val _notes = MutableStateFlow<List<Note>>(emptyList())
    val notes: StateFlow<List<Note>> = _notes.asStateFlow()

    private val _meals = MutableStateFlow<MealsState?>(null)
    val meals: StateFlow<MealsState?> = _meals.asStateFlow()

    private val _kidRequests = MutableStateFlow<List<KidAccessRequest>>(emptyList())
    val kidRequests: StateFlow<List<KidAccessRequest>> = _kidRequests.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _needsAuth = MutableStateFlow(false)
    val needsAuth: StateFlow<Boolean> = _needsAuth.asStateFlow()

    private val _syncError = MutableStateFlow<String?>(null)
    val syncError: StateFlow<String?> = _syncError.asStateFlow()

    private val _homeworkMutationIDs = MutableStateFlow<Set<String>>(emptySet())
    val homeworkMutationIDs: StateFlow<Set<String>> = _homeworkMutationIDs.asStateFlow()

    private val _completingActionIDs = MutableStateFlow<Set<String>>(emptySet())
    val completingActionIDs: StateFlow<Set<String>> = _completingActionIDs.asStateFlow()

    // Active Chat room tracking
    private var activeRoomId: String? = null
    private var chatLoopJob: Job? = null
    private var familyPollJob: Job? = null

    val isParent: Boolean get() = _me.value?.role != "kid"
    val kids: List<Kid> get() = _family.value?.kids ?: emptyList()
    val kidScope: String? get() = if (_me.value?.role == "kid") _me.value?.kidId else null

    val visibleFamilyEvents: List<FamilyEvent>
        get() {
            val role = _me.value?.role
            val scopeId = kidScope
            return if (role == "kid") {
                if (scopeId == null) emptyList()
                else _familyEvents.value.filter { it.kidId == null || it.kidId == scopeId }
            } else {
                _familyEvents.value.filter { !it.isImportedTimetable }
            }
        }

    val visibleEvents: List<CalendarEvent>
        get() {
            val role = _me.value?.role
            val scopeId = kidScope
            return if (role == "kid") {
                if (scopeId == null) emptyList()
                else _events.value.filter { it.kidId == null || it.kidId == scopeId }
            } else {
                _events.value
            }
        }

    fun isMine(m: ChatMessage): Boolean {
        val currentUserId = _me.value?.id ?: return false
        return if (m.postedByUserId != null) m.postedByUserId == currentUserId
        else m.senderId == currentUserId
    }

    fun senderName(m: ChatMessage): String {
        if (!m.senderName.isNullOrBlank()) return m.senderName
        if (m.senderType == "kid") {
            return _family.value?.kids?.firstOrNull { it.id == m.senderId }?.name ?: "Kid"
        }
        return _family.value?.parents?.firstOrNull { it.id == m.senderId }?.name ?: "Parent"
    }

    // MARK: - Lifecycle

    suspend fun load() {
        // 1. Instant disk cache load
        val cached = diskCache.load()
        if (cached != null && _family.value == null) {
            _me.value = cached.me
            _family.value = cached.family
            _messagesByRoom.value = cached.messagesByRoom
            _events.value = cached.events
            _familyEvents.value = cached.familyEvents
            _homework.value = cached.homework
            _actions.value = cached.actions
            _notes.value = cached.notes
            _meals.value = cached.meals
        }

        // 2. Network refresh
        refresh()
    }

    suspend fun refresh() = withContext(Dispatchers.IO) {
        _isRefreshing.value = true
        try {
            val meResp = api.me()
            _me.value = meResp.user
            _needsAuth.value = false

            val fams = api.families().families
            val currentFam = fams.firstOrNull()
            _family.value = currentFam

            if (currentFam != null) {
                // Fetch domains concurrently
                coroutineScope {
                    val msgsDef = async { try { api.chatMessages(limit = 50).messages } catch (e: Exception) { emptyList() } }
                    val kidsReqDef = async { try { api.kidAccessRequests().requests } catch (e: Exception) { emptyList() } }
                    val calSyncDef = async { try { api.syncCalendar(mapOf("force" to false)).events ?: emptyList() } catch (e: Exception) { emptyList() } }
                    val famEventsDef = async { try { api.familyEvents().events } catch (e: Exception) { emptyList() } }
                    val hwDef = async { try { api.homework().homework } catch (e: Exception) { emptyList() } }
                    val actionsDef = async { try { api.familyActions().actions } catch (e: Exception) { emptyList() } }
                    val notesDef = async { try { api.notes().notes } catch (e: Exception) { emptyList() } }
                    val mealsDef = async { try { api.meals() } catch (e: Exception) { null } }
                    val roomsDef = async { try { api.chatRooms() } catch (e: Exception) { listOf(ChatRoom(FAMILY_ROOM_ID, null, currentFam.name)) } }

                    val msgs = msgsDef.await()
                    val map = _messagesByRoom.value.toMutableMap()
                    map[FAMILY_ROOM_ID] = dedupeMessages(msgs)
                    _messagesByRoom.value = map

                    _kidRequests.value = kidsReqDef.await()
                    _events.value = calSyncDef.await()
                    _familyEvents.value = famEventsDef.await()
                    _homework.value = hwDef.await()
                    _actions.value = actionsDef.await()
                    _notes.value = notesDef.await()
                    _meals.value = mealsDef.await()
                    _chatRooms.value = roomsDef.await()
                }
            } else {
                try {
                    _chatRooms.value = api.chatRooms()
                } catch (e: Exception) {
                    // soft fallback
                }
            }
            _syncError.value = null
            persist()
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 401) {
                _needsAuth.value = true
            } else {
                _syncError.value = e.message()
            }
        } catch (e: Exception) {
            _syncError.value = e.localizedMessage
        } finally {
            _isRefreshing.value = false
            startFamilyBackgroundPoll()
            restartChatLoop()
        }
    }

    private suspend fun persist() {
        diskCache.save(
            CachedAppState(
                me = _me.value,
                family = _family.value,
                messagesByRoom = _messagesByRoom.value,
                events = _events.value,
                familyEvents = _familyEvents.value,
                homework = _homework.value,
                actions = _actions.value,
                notes = _notes.value,
                meals = _meals.value
            )
        )
    }

    fun signedOut() {
        chatLoopJob?.cancel()
        familyPollJob?.cancel()
        ApiClient.clearCookies()
        scope.launch { diskCache.clear() }
        _me.value = null
        _family.value = null
        _messagesByRoom.value = emptyMap()
        _events.value = emptyList()
        _familyEvents.value = emptyList()
        _homework.value = emptyList()
        _actions.value = emptyList()
        _notes.value = emptyList()
        _meals.value = null
        _kidRequests.value = emptyList()
        _needsAuth.value = true
    }

    // MARK: - Chat Polling & Mutation

    fun setActiveRoom(roomId: String?) {
        activeRoomId = roomId
        restartChatLoop()
    }

    private fun restartChatLoop() {
        chatLoopJob?.cancel()
        val roomId = activeRoomId ?: return
        chatLoopJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                try {
                    val currentList = _messagesByRoom.value[roomId] ?: emptyList()
                    val lastId = currentList.lastOrNull()?.id
                    val resp = if (roomId.startsWith("trip:")) {
                        val tripId = roomId.removePrefix("trip:")
                        api.tripChatMessages(tripId = tripId, afterId = lastId, wait = 1)
                    } else {
                        api.chatMessages(afterId = lastId, wait = 1)
                    }
                    if (resp.messages.isNotEmpty()) {
                        val merged = dedupeMessages(currentList + resp.messages)
                        val map = _messagesByRoom.value.toMutableMap()
                        map[roomId] = merged
                        _messagesByRoom.value = map
                    }
                } catch (e: Exception) {
                    delay(3000)
                }
            }
        }
    }

    private fun startFamilyBackgroundPoll() {
        if (familyPollJob != null) return
        familyPollJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                delay(8000)
                if (activeRoomId != FAMILY_ROOM_ID) {
                    try {
                        val current = _messagesByRoom.value[FAMILY_ROOM_ID] ?: emptyList()
                        val lastId = current.lastOrNull()?.id
                        val resp = api.chatMessages(afterId = lastId, wait = 0)
                        if (resp.messages.isNotEmpty()) {
                            val merged = dedupeMessages(current + resp.messages)
                            val map = _messagesByRoom.value.toMutableMap()
                            map[FAMILY_ROOM_ID] = merged
                            _messagesByRoom.value = map
                        }
                    } catch (e: Exception) {
                        // ignore background poll errors
                    }
                }
            }
        }
    }

    suspend fun postChatMessage(text: String, roomId: String) = withContext(Dispatchers.IO) {
        val req = PostChatMessageRequest(text = text.trim())
        val resp = if (roomId.startsWith("trip:")) {
            val tripId = roomId.removePrefix("trip:")
            api.postTripChatMessage(tripId, req)
        } else {
            api.postChatMessage(req)
        }
        val current = _messagesByRoom.value[roomId] ?: emptyList()
        val map = _messagesByRoom.value.toMutableMap()
        map[roomId] = dedupeMessages(current + listOf(resp.message))
        _messagesByRoom.value = map
    }

    suspend fun sendBuzz(text: String = "BUZZ!", roomId: String) = withContext(Dispatchers.IO) {
        val body = mapOf("text" to text.ifBlank { "BUZZ!" })
        if (roomId.startsWith("trip:")) {
            val tripId = roomId.removePrefix("trip:")
            api.sendTripBuzz(tripId, body)
        } else {
            api.sendBuzz(body)
        }
    }

    suspend fun deleteChatMessage(id: String, roomId: String) = withContext(Dispatchers.IO) {
        if (roomId.startsWith("trip:")) {
            val tripId = roomId.removePrefix("trip:")
            api.deleteTripChatMessage(tripId, id)
        } else {
            api.deleteChatMessage(id)
        }
        val current = _messagesByRoom.value[roomId] ?: emptyList()
        val map = _messagesByRoom.value.toMutableMap()
        map[roomId] = current.filter { it.id != id }
        _messagesByRoom.value = map
    }

    suspend fun flagChatMessage(id: String, reason: String, roomId: String = FAMILY_ROOM_ID) = withContext(Dispatchers.IO) {
        if (roomId.startsWith("trip:")) {
            val tripId = roomId.removePrefix("trip:")
            api.flagTripChatMessage(tripId, id, mapOf("reason" to reason))
        } else {
            api.flagChatMessage(id, mapOf("reason" to reason))
        }
    }

    // MARK: - Homework Mutations

    suspend fun setHomeworkStatus(id: String, status: String) = withContext(Dispatchers.IO) {
        _homeworkMutationIDs.value = _homeworkMutationIDs.value + id
        try {
            val updated = api.setHomeworkStatus(id, mapOf("status" to status)).homework
            _homework.value = _homework.value.map { if (it.id == id) updated else it }
        } finally {
            _homeworkMutationIDs.value = _homeworkMutationIDs.value - id
        }
    }

    suspend fun setHomeworkChecklistStep(id: String, index: Int, done: Boolean) = withContext(Dispatchers.IO) {
        _homeworkMutationIDs.value = _homeworkMutationIDs.value + id
        try {
            val updated = api.setHomeworkChecklistStep(id, index, mapOf("done" to done)).homework
            _homework.value = _homework.value.map { if (it.id == id) updated else it }
        } finally {
            _homeworkMutationIDs.value = _homeworkMutationIDs.value - id
        }
    }

    // MARK: - Family Actions

    suspend fun completeAction(id: String) = withContext(Dispatchers.IO) {
        _completingActionIDs.value = _completingActionIDs.value + id
        try {
            val updated = api.updateFamilyAction(id, mapOf("status" to "done")).action
            _actions.value = _actions.value.map { if (it.id == id) updated else it }
        } finally {
            _completingActionIDs.value = _completingActionIDs.value - id
        }
    }

    suspend fun snoozeAction(id: String, until: String) = withContext(Dispatchers.IO) {
        val updated = api.updateFamilyAction(id, mapOf("status" to "snoozed", "snoozedUntil" to until)).action
        _actions.value = _actions.value.map { if (it.id == id) updated else it }
    }

    // MARK: - Calendar Events

    suspend fun addFamilyEvent(
        title: String,
        date: String,
        time: String? = null,
        endDate: String? = null,
        category: String? = null,
        kidId: String? = null,
        repeatRule: String? = null,
        notes: String? = null
    ) = withContext(Dispatchers.IO) {
        val payload = mapOf(
            "title" to title,
            "date" to date,
            "time" to time,
            "endDate" to endDate,
            "category" to category,
            "kidId" to kidId,
            "repeat" to repeatRule,
            "notes" to notes
        )
        val resp = api.addFamilyEvent(payload)
        _familyEvents.value = _familyEvents.value + resp.event
    }

    suspend fun deleteFamilyEvent(id: String) = withContext(Dispatchers.IO) {
        api.deleteFamilyEvent(id)
        _familyEvents.value = _familyEvents.value.filter { it.id != id && it.seriesId != id }
    }

    // MARK: - Kid Access Approval

    suspend fun approveKidRequest(id: String) = withContext(Dispatchers.IO) {
        val resp = api.approveKidAccess(id)
        _family.value = resp.family
        _kidRequests.value = _kidRequests.value.filter { it.id != id }
    }

    suspend fun denyKidRequest(id: String) = withContext(Dispatchers.IO) {
        api.denyKidAccess(id)
        _kidRequests.value = _kidRequests.value.filter { it.id != id }
    }

    // MARK: - Notes

    suspend fun createNote(body: String, date: String = todayDate(), source: String = "manual") = withContext(Dispatchers.IO) {
        val resp = api.createNote(mapOf("body" to body, "date" to date, "source" to source))
        _notes.value = listOf(resp.note) + _notes.value
    }

    suspend fun deleteNote(id: String) = withContext(Dispatchers.IO) {
        api.deleteNote(id)
        _notes.value = _notes.value.filter { it.id != id }
    }

    // MARK: - Meals & Shopping

    suspend fun addPantryItem(name: String, category: String, level: String) = withContext(Dispatchers.IO) {
        val item = api.addPantryItem(mapOf("name" to name, "category" to category, "level" to level)).item
        val curr = _meals.value ?: MealsState()
        _meals.value = curr.copy(pantry = curr.pantry + item)
    }

    suspend fun deletePantryItem(id: String) = withContext(Dispatchers.IO) {
        api.deletePantryItem(id)
        val curr = _meals.value ?: return@withContext
        _meals.value = curr.copy(pantry = curr.pantry.filter { it.id != id })
    }

    suspend fun addShoppingItem(text: String, category: String? = null) = withContext(Dispatchers.IO) {
        val item = api.addShoppingItem(mapOf("text" to text, "category" to category)).item
        val curr = _meals.value ?: MealsState()
        _meals.value = curr.copy(shopping = curr.shopping + item)
    }

    suspend fun toggleShoppingItem(id: String, done: Boolean) = withContext(Dispatchers.IO) {
        val item = api.toggleShoppingItem(id, mapOf("done" to done)).item
        val curr = _meals.value ?: return@withContext
        _meals.value = curr.copy(shopping = curr.shopping.map { if (it.id == id) item else it })
    }

    suspend fun deleteShoppingItem(id: String) = withContext(Dispatchers.IO) {
        api.deleteShoppingItem(id)
        val curr = _meals.value ?: return@withContext
        _meals.value = curr.copy(shopping = curr.shopping.filter { it.id != id })
    }

    private fun dedupeMessages(list: List<ChatMessage>): List<ChatMessage> {
        val seen = mutableSetOf<String>()
        val result = mutableListOf<ChatMessage>()
        for (m in list) {
            if (seen.add(m.id)) {
                result.add(m)
            }
        }
        return result.sortedBy { it.createdAt }
    }

    companion object {
        fun todayDate(): String {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            return sdf.format(Date())
        }
    }
}
