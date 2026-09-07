package com.fametc.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

@Immutable
data class FamColors(
    val bg: Color,
    val sidebar: Color,
    val panel: Color,
    val panel2: Color,
    val border: Color,
    val text: Color,
    val textSecond: Color,
    val muted: Color,
    val accent: Color,
    val accentSoft: Color,
    val onAccent: Color,
    val coral: Color,
    val warn: Color,
    val grid: Color,
    val isDark: Boolean
)

val LocalFamColors = staticCompositionLocalOf {
    FamColors(
        bg = HorizonColors.BgLight,
        sidebar = HorizonColors.SidebarLight,
        panel = HorizonColors.PanelLight,
        panel2 = HorizonColors.Panel2Light,
        border = HorizonColors.BorderLight,
        text = HorizonColors.TextLight,
        textSecond = HorizonColors.TextSecondLight,
        muted = HorizonColors.MutedLight,
        accent = HorizonColors.AccentLight,
        accentSoft = HorizonColors.AccentSoftLight,
        onAccent = Color.White,
        coral = HorizonColors.CoralLight,
        warn = HorizonColors.WarnLight,
        grid = HorizonColors.GridLight,
        isDark = false
    )
}

object FamTheme {
    val colors: FamColors
        @Composable
        get() = LocalFamColors.current

    val typography: FamTypography
        get() = FamTypography
}

@Composable
fun FamEtcTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val famColors = if (darkTheme) {
        FamColors(
            bg = HorizonColors.BgDark,
            sidebar = HorizonColors.SidebarDark,
            panel = HorizonColors.PanelDark,
            panel2 = HorizonColors.Panel2Dark,
            border = HorizonColors.BorderDark,
            text = HorizonColors.TextDark,
            textSecond = HorizonColors.TextSecondDark,
            muted = HorizonColors.MutedDark,
            accent = HorizonColors.AccentDark,
            accentSoft = HorizonColors.AccentSoftDark,
            onAccent = Color(0xFF1C1526),
            coral = HorizonColors.CoralDark,
            warn = HorizonColors.WarnDark,
            grid = HorizonColors.GridDark,
            isDark = true
        )
    } else {
        FamColors(
            bg = HorizonColors.BgLight,
            sidebar = HorizonColors.SidebarLight,
            panel = HorizonColors.PanelLight,
            panel2 = HorizonColors.Panel2Light,
            border = HorizonColors.BorderLight,
            text = HorizonColors.TextLight,
            textSecond = HorizonColors.TextSecondLight,
            muted = HorizonColors.MutedLight,
            accent = HorizonColors.AccentLight,
            accentSoft = HorizonColors.AccentSoftLight,
            onAccent = Color.White,
            coral = HorizonColors.CoralLight,
            warn = HorizonColors.WarnLight,
            grid = HorizonColors.GridLight,
            isDark = false
        )
    }

    val materialColors = if (darkTheme) {
        darkColorScheme(
            primary = famColors.accent,
            onPrimary = famColors.onAccent,
            background = famColors.bg,
            onBackground = famColors.text,
            surface = famColors.panel,
            onSurface = famColors.text,
            outline = famColors.border
        )
    } else {
        lightColorScheme(
            primary = famColors.accent,
            onPrimary = famColors.onAccent,
            background = famColors.bg,
            onBackground = famColors.text,
            surface = famColors.panel,
            onSurface = famColors.text,
            outline = famColors.border
        )
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.statusBarColor = famColors.bg.toArgb()
            window.navigationBarColor = famColors.bg.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    CompositionLocalProvider(LocalFamColors provides famColors) {
        MaterialTheme(
            colorScheme = materialColors,
            content = content
        )
    }
}
