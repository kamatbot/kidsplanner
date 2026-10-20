package com.fametc.portal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.ViewModelProvider
import java.time.Instant
import java.time.LocalTime

class PortalActivity : ComponentActivity() {
    private val model by lazy { ViewModelProvider(this)[PortalViewModel::class.java] }
    private var foreground by mutableStateOf(false)
    private var brightUntilElapsed by mutableStateOf(0L)

    // FLAG_KEEP_SCREEN_ON alone has let the Portal's screensaver start. While the
    // board should stay lit we also hold a screen wake lock, and if a screensaver
    // (an Android dream) starts anyway, a wake-up lock ends it straight away.
    private var holdScreen = false
    private val power by lazy { getSystemService(Context.POWER_SERVICE) as PowerManager }
    @Suppress("DEPRECATION")
    private val screenLock by lazy {
        power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK, "fametc:board").apply { setReferenceCounted(false) }
    }
    private val dreamReceiver = object : BroadcastReceiver() {
        @Suppress("DEPRECATION")
        override fun onReceive(context: Context, intent: Intent) {
            if (!holdScreen) return
            power.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "fametc:wake",
            ).acquire(5_000)
        }
    }

    private fun holdScreen(hold: Boolean) {
        holdScreen = hold
        if (hold) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (!screenLock.isHeld) screenLock.acquire()
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (screenLock.isHeld) screenLock.release()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContent {
            val state by model.state.collectAsState()
            val preferences by model.preferences.collectAsState()
            val photos by model.photos.collectAsState()
            val zone = state.context?.timeZone ?: state.device?.timeZone
            val localTime = Instant.ofEpochMilli(state.nowMillis).atZone(DisplayTime.zone(zone)).toLocalTime()
            val quiet = preferences.screenMode == ScreenMode.SCHEDULED && DisplayTime.isNight(
                localTime, LocalTime.of(preferences.nightStartHour, 0), LocalTime.of(preferences.nightEndHour, 0)
            )
            val temporarilyBright = SystemClock.elapsedRealtime() < brightUntilElapsed
            LaunchedEffect(preferences.orientation) {
                requestedOrientation = when (preferences.orientation) {
                    ScreenOrientation.AUTO -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                    ScreenOrientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    ScreenOrientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                }
            }
            LaunchedEffect(foreground, state.paired, state.demo, preferences.screenMode, quiet, temporarilyBright) {
                val active = foreground && (state.paired || state.demo)
                val hold = active && when (preferences.screenMode) {
                    ScreenMode.ALWAYS -> true
                    ScreenMode.SCHEDULED -> !quiet || temporarilyBright
                    ScreenMode.NORMAL -> false
                }
                holdScreen(hold)
                val brightness = if (active && quiet && !temporarilyBright) 0.05f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                if (window.attributes.screenBrightness != brightness) {
                    window.attributes = window.attributes.apply { screenBrightness = brightness }
                }
            }
            PortalTheme(preferences.biggerText) {
                PortalRoot(
                    state = state,
                    preferences = preferences,
                    photos = photos,
                    quiet = quiet && !temporarilyBright,
                    onPair = model::pair,
                    onDemo = model::demo,
                    onLeaveDemo = model::leaveDemo,
                    onRefresh = model::refresh,
                    onPreferences = model::setPreferences,
                    onUnpair = model::unpair,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        foreground = true
        registerReceiver(dreamReceiver, IntentFilter(Intent.ACTION_DREAMING_STARTED))
        model.onForeground()
    }

    override fun onStop() {
        foreground = false
        unregisterReceiver(dreamReceiver)
        model.onBackground()
        holdScreen(false)
        window.attributes = window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
        super.onStop()
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        brightUntilElapsed = SystemClock.elapsedRealtime() + 2 * 60 * 1000L
    }
}
