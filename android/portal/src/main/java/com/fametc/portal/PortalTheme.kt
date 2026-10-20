package com.fametc.portal

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp

object PortalColors {
    val Background = Color(0xFF15141C)
    val Panel = Color(0xFF211F2C)
    val Elevated = Color(0xFF2B2838)
    val Stroke = Color(0xFF393447)
    val Text = Color(0xFFF4F1FB)
    val Secondary = Color(0xFFBBB5CA)
    val Violet = Color(0xFFB39AFF)
    val Homework = Color(0xFFFFB16B)
    val Mint = Color(0xFF6BD6BC)
    val Error = Color(0xFFFFB4AB)
}

@Composable
fun PortalTheme(biggerText: Boolean, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val typography = Typography(
        displaySmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal, fontSize = 40.sp, lineHeight = 46.sp),
        headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 36.sp),
        titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp),
        titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
        bodyLarge = TextStyle(fontSize = 18.sp, lineHeight = 26.sp),
        bodyMedium = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
        labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
        labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    )
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * if (biggerText) 1.15f else 1f)) {
        MaterialTheme(
            colorScheme = darkColorScheme(
                primary = PortalColors.Violet,
                onPrimary = PortalColors.Background,
                secondary = PortalColors.Mint,
                background = PortalColors.Background,
                onBackground = PortalColors.Text,
                surface = PortalColors.Panel,
                onSurface = PortalColors.Text,
                surfaceVariant = PortalColors.Elevated,
                onSurfaceVariant = PortalColors.Secondary,
                outline = PortalColors.Stroke,
                error = PortalColors.Error,
            ),
            typography = typography,
            content = content,
        )
    }
}
