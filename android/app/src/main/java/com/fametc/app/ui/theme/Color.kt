package com.fametc.app.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Horizon Palette - 1:1 match with public/css/horizon.css and Theme.swift
object HorizonColors {
    // Light
    val BgLight = Color(0xFFF1EFEC)
    val SidebarLight = Color(0xFFF8F6F3)
    val PanelLight = Color(0xFFFFFFFF)
    val Panel2Light = Color(0xFFFAF8F5)
    val BorderLight = Color(0xFFE7E3DD)
    val TextLight = Color(0xFF211E1B)
    val TextSecondLight = Color(0xFF6A655F)
    val MutedLight = Color(0xFF6F6A63)
    val AccentLight = Color(0xFF6F43D6)
    val AccentSoftLight = Color(0x1C6F43D6)
    val CoralLight = Color(0xFFF0704F)
    val WarnLight = Color(0xFF8A6410)
    val GridLight = Color(0xFFEDEAE5)

    // Dark
    val BgDark = Color(0xFF211F1D)
    val SidebarDark = Color(0xFF262421)
    val PanelDark = Color(0xFF2C2926)
    val Panel2Dark = Color(0xFF33302C)
    val BorderDark = Color(0xFF3B3733)
    val TextDark = Color(0xFFF1EFEC)
    val TextSecondDark = Color(0xFFA29C93)
    val MutedDark = Color(0xFF968F86)
    val AccentDark = Color(0xFFB98CFF)
    val AccentSoftDark = Color(0x26B98CFF)
    val CoralDark = Color(0xFFFF8A66)
    val WarnDark = Color(0xFFD6A24A)
    val GridDark = Color(0xFF35322E)

    // Categorical
    val Blue = Color(0xFF2563EB)
    val Violet = Color(0xFF7C3AED)
    val Amber = Color(0xFFF59E0B)
    val Green = Color(0xFF16A34A)
    val Red = Color(0xFFDC2626)
    val Teal = Color(0xFF0D9488)
    val Orange = Color(0xFFEA580C)

    val BlueDark = Color(0xFF60A5FA)
    val VioletDark = Color(0xFFA78BFA)
    val AmberDark = Color(0xFFFBBF24)
    val GreenDark = Color(0xFF4ADE80)
    val RedDark = Color(0xFFF87171)
    val TealDark = Color(0xFF2DD4BF)
    val OrangeDark = Color(0xFFFB923C)

    fun kidColor(index: Int, isDark: Boolean = false): Color {
        val lightCycle = listOf(Teal, Amber, Blue, Violet, Red, Orange)
        val darkCycle = listOf(TealDark, AmberDark, BlueDark, VioletDark, RedDark, OrangeDark)
        val cycle = if (isDark) darkCycle else lightCycle
        return cycle[Math.floorMod(index, cycle.size)]
    }

    fun signalGradient(isDark: Boolean = false): Brush {
        val coral = if (isDark) CoralDark else CoralLight
        val accent = if (isDark) AccentDark else AccentLight
        return Brush.horizontalGradient(listOf(coral, accent))
    }
}
