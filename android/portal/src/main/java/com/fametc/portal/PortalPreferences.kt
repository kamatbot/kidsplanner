package com.fametc.portal

import android.content.Context

enum class ScreenMode { ALWAYS, SCHEDULED, NORMAL }
enum class ScreenOrientation { AUTO, LANDSCAPE, PORTRAIT }

data class PortalPreferences(
    val screenMode: ScreenMode = ScreenMode.ALWAYS,
    val orientation: ScreenOrientation = ScreenOrientation.AUTO,
    val nightStartHour: Int = 21,
    val nightEndHour: Int = 7,
    val biggerText: Boolean = false,
    // Where the night frame's Next card sits, as a fraction of the free space (1, 1 = bottom-right).
    val nextCardX: Float = 1f,
    val nextCardY: Float = 1f,
)

/** Only non-sensitive local display preferences live here. */
class PortalPreferenceStore(context: Context) {
    private val prefs = context.getSharedPreferences("fam_portal_preferences", Context.MODE_PRIVATE)
    fun read() = PortalPreferences(
        screenMode = runCatching { ScreenMode.valueOf(prefs.getString("fam_screen_mode", "ALWAYS")!!) }.getOrDefault(ScreenMode.ALWAYS),
        orientation = runCatching { ScreenOrientation.valueOf(prefs.getString("fam_orientation", "AUTO")!!) }.getOrDefault(ScreenOrientation.AUTO),
        nightStartHour = prefs.getInt("fam_night_start", 21).coerceIn(0, 23),
        nightEndHour = prefs.getInt("fam_night_end", 7).coerceIn(0, 23),
        biggerText = prefs.getBoolean("fam_bigger_text", false),
        nextCardX = prefs.getFloat("fam_next_card_x", 1f).coerceIn(0f, 1f),
        nextCardY = prefs.getFloat("fam_next_card_y", 1f).coerceIn(0f, 1f),
    )
    fun write(value: PortalPreferences) {
        prefs.edit()
            .putString("fam_screen_mode", value.screenMode.name)
            .putString("fam_orientation", value.orientation.name)
            .putInt("fam_night_start", value.nightStartHour)
            .putInt("fam_night_end", value.nightEndHour)
            .putBoolean("fam_bigger_text", value.biggerText)
            .putFloat("fam_next_card_x", value.nextCardX)
            .putFloat("fam_next_card_y", value.nextCardY)
            .apply()
    }
}
