package com.fametc.portal

import android.content.pm.ActivityInfo
import android.os.Bundle
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
                if (hold) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        model.onForeground()
    }

    override fun onStop() {
        foreground = false
        model.onBackground()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
        super.onStop()
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        brightUntilElapsed = SystemClock.elapsedRealtime() + 2 * 60 * 1000L
    }
}
