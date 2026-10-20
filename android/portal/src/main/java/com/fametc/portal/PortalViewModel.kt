package com.fametc.portal

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.UUID

class PortalViewModel(app: Application) : AndroidViewModel(app) {
    private companion object {
        val processSessionId: String = UUID.randomUUID().toString()
    }
    private val api = PortalApi()
    private val disk = SecureDisplayStore(app)
    private val diskMutex = Mutex()
    private val preferenceStore = PortalPreferenceStore(app)
    private val _preferences = MutableStateFlow(preferenceStore.read())
    val preferences: StateFlow<PortalPreferences> = _preferences.asStateFlow()
    private val _state = MutableStateFlow(PortalState())
    val state: StateFlow<PortalState> = _state.asStateFlow()
    private val refreshRequests = Channel<Unit>(Channel.CONFLATED)
    private var saved: SavedDisplay? = null
    private var foreground = false
    private var loaded = false
    @Volatile private var generation = 0L
    private var pollJob: Job? = null
    private var tickerJob: Job? = null
    private var pairingJob: Job? = null
    private val bootCount = runCatching {
        Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT)
    }.getOrDefault(-1)
    private val connectivity = app.getSystemService(ConnectivityManager::class.java)
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { viewModelScope.launch { refresh() } }
    }

    init {
        runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) }
        viewModelScope.launch {
            try {
                val restored = diskMutex.withLock { withContext(Dispatchers.IO) { disk.read() } }
                if (restored != null && !restored.token.matches(Regex("fdp_[A-Za-z0-9_-]{43}"))) {
                    throw IllegalStateException("Unrecognized saved credential")
                }
                saved = restored
                val cached = restored?.takeIf { cacheValid(it) }?.cached
                val needsFreshView = restored?.cached != null && cached == null
                _state.update {
                    it.copy(
                        loading = false, paired = restored != null, device = restored?.device,
                        context = cached, offline = restored?.cached != null,
                        error = if (needsFreshView) "Reconnect to refresh your family’s day. The previous saved view is no longer available." else null,
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                diskMutex.withLock { withContext(Dispatchers.IO) { runCatching { disk.clear() } } }
                saved = null
                _state.update { it.copy(loading = false, error = "This display needs to reconnect. Create a new code on your phone.") }
            }
            loaded = true
            if (foreground) startPolling()
        }
    }

    fun onForeground() {
        foreground = true
        tickerJob?.cancel()
        tickerJob = viewModelScope.launch {
            var previousDay: String? = null
            while (isActive) {
                val now = System.currentTimeMillis()
                _state.update { it.copy(nowMillis = now) }
                val record = saved
                if (record?.cached != null && !cacheValid(record)) {
                    val operation = generation
                    val expired = record.copy(cached = null)
                    saved = expired
                    _state.update { it.copy(context = null, offline = true, error = "The saved view has expired. Reconnect to refresh your family’s day.") }
                    try { persist(expired, operation) }
                    catch (error: CancellationException) { throw error }
                    catch (_: Exception) {
                        // The lease remains enforced in memory even if disk is full.
                        if (operation == generation) _state.update { it.copy(error = "The saved view has expired. Reconnect to refresh; storage is currently unavailable.") }
                    }
                }
                val zone = _state.value.context?.timeZone ?: _state.value.device?.timeZone
                val day = DisplayTime.today(now, zone).toString()
                if (previousDay != null && previousDay != day) {
                    if (_state.value.demo) _state.update { it.copy(context = DemoData.create(now)) }
                    else refresh()
                }
                previousDay = day
                delay(1000)
            }
        }
        if (loaded) startPolling()
    }

    fun onBackground() {
        foreground = false
        pollJob?.cancel()
        pollJob = null
        tickerJob?.cancel()
        tickerJob = null
        pairingJob?.cancel()
        pairingJob = null
        _state.update { it.copy(refreshing = false) }
    }

    fun refresh() {
        if (_state.value.demo) {
            _state.update { it.copy(context = DemoData.create(System.currentTimeMillis())) }
            return
        }
        if (foreground && loaded && saved != null) {
            if (pollJob?.isActive != true) startPolling() else refreshRequests.trySend(Unit)
        }
    }

    fun pair(rawCode: String) {
        if (!loaded || _state.value.paired || _state.value.pairing) return
        val code = rawCode.uppercase(Locale.ROOT).replace(Regex("[\\s-]"), "")
        if (!code.matches(Regex("[A-Z2-9]{8}"))) {
            _state.update { it.copy(error = "Enter the eight-character code from your phone.") }
            return
        }
        val operation = ++generation
        pairingJob?.cancel()
        pairingJob = viewModelScope.launch {
            _state.update { it.copy(pairing = true, error = null, demo = false, context = null) }
            try {
                val response = api.pair(code, "${Build.MANUFACTURER} ${Build.MODEL}")
                if (operation != generation) return@launch
                val record = SavedDisplay(response.token, response.device)
                // A lifecycle cancellation cannot leave a committed credential
                // only on disk while the live model still asks to pair again.
                withContext(NonCancellable) {
                    persist(record, operation)
                    if (operation == generation) {
                        saved = record
                        _state.update { it.copy(paired = true, pairing = false, device = response.device, error = null, offline = false) }
                    }
                }
                if (operation != generation) return@launch
                startPolling()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (operation == generation) _state.update {
                    it.copy(pairing = false, error = when (error) {
                        is PortalApiException -> if (error.status == 400 || error.status == 429) error.message else "Pairing is unavailable. Try again shortly."
                        else -> "Could not connect. Check Wi-Fi and create a fresh code if this one was used."
                    })
                }
            } finally {
                if (operation == generation) _state.update { it.copy(pairing = false) }
            }
        }
    }

    private fun startPolling() {
        if (!foreground || saved == null || pollJob?.isActive == true) return
        val operation = generation
        pollJob = viewModelScope.launch {
            var failures = 0
            while (isActive && foreground && operation == generation) {
                val record = saved ?: break
                refreshRequests.tryReceive()
                _state.update { it.copy(refreshing = true) }
                var nextDelay = 60_000L
                try {
                    val context = api.context(record.token)
                    if (operation != generation) break
                    if (context.device.id != record.device.id) throw IllegalStateException("Display identity changed")
                    val updated = record.copy(
                        device = record.device.copy(
                            label = context.device.label,
                            timeZone = context.timeZone,
                            showHomework = context.device.showHomework,
                            showMeals = context.device.showMeals,
                        ),
                        cached = context,
                        savedWallMillis = System.currentTimeMillis(),
                        savedElapsedMillis = SystemClock.elapsedRealtime(),
                        bootCount = bootCount,
                        cacheSessionId = processSessionId,
                    )
                    persist(updated, operation)
                    if (operation != generation) break
                    saved = updated
                    failures = 0
                    _state.update { it.copy(context = context, device = updated.device, error = null, offline = false, refreshing = false) }
                    nextDelay = context.pollAfterSeconds.coerceIn(30, 300).toLong() * 1000
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    if (operation != generation) break
                    if (error is PortalApiException && (error.status == 401 || error.status == 403)) {
                        clearSession("This display was disconnected or its access changed. Pair again from your phone.", false)
                        break
                    }
                    failures = (failures + 1).coerceAtMost(5)
                    nextDelay = minOf(300_000L, 15_000L shl (failures - 1))
                    _state.update { it.copy(refreshing = false, offline = true, error = "Connection paused. Retrying automatically.") }
                } finally {
                    if (operation == generation) _state.update { it.copy(refreshing = false) }
                }
                withTimeoutOrNull(nextDelay) { refreshRequests.receive() }
            }
        }
    }

    private fun cacheValid(record: SavedDisplay) = DisplayTime.validCache(
        record, System.currentTimeMillis(), SystemClock.elapsedRealtime(), bootCount, processSessionId
    )

    private suspend fun persist(record: SavedDisplay, operation: Long) {
        diskMutex.withLock {
            if (operation == generation) withContext(Dispatchers.IO) { disk.write(record) }
        }
    }

    fun unpair() = clearSession(null, true)

    private fun clearSession(message: String?, revoke: Boolean) {
        val token = saved?.token
        val operation = ++generation
        pollJob?.cancel()
        pollJob = null
        pairingJob?.cancel()
        pairingJob = null
        saved = null
        _state.value = PortalState(loading = true, error = message)
        viewModelScope.launch {
            try {
                diskMutex.withLock { withContext(Dispatchers.IO) { disk.clear() } }
                if (operation == generation) _state.update { it.copy(loading = false) }
                if (revoke && token != null) {
                    try { api.disconnect(token) }
                    catch (error: CancellationException) { throw error }
                    catch (_: Exception) {
                        if (operation == generation) _state.update { it.copy(error = "Disconnected on this Portal. Remove it from Displays on your phone to finish revoking access.") }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (operation == generation) _state.update { it.copy(loading = false, error = "Could not remove the saved connection. Revoke this display from your phone and clear the app’s storage.") }
            }
        }
    }

    fun demo() {
        if (_state.value.loading || _state.value.paired || _state.value.pairing) return
        _state.update { it.copy(demo = true, context = DemoData.create(System.currentTimeMillis()), error = null, offline = false) }
    }

    fun leaveDemo() { _state.update { it.copy(demo = false, context = null, error = null) } }

    fun setPreferences(value: PortalPreferences) {
        val safe = value.copy(nightStartHour = value.nightStartHour.coerceIn(0, 23), nightEndHour = value.nightEndHour.coerceIn(0, 23))
        preferenceStore.write(safe)
        _preferences.value = safe
    }

    override fun onCleared() {
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        refreshRequests.close()
        super.onCleared()
    }
}
