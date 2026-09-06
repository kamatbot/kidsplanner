package com.fametc.app.ui.features.planning

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fametc.app.ui.components.HybridWebView
import com.fametc.app.ui.theme.FamTheme

/**
 * Trips webview surface (matches iOS TripsScreen.swift).
 * Itinerary, flights, lodging, invites, and trips list live on the web at /trips.
 */
@Composable
fun TripsScreen() {
    Scaffold(containerColor = FamTheme.colors.bg) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(bottom = 64.dp)
        ) {
            HybridWebView(path = "/trips", isEmbedded = true)
        }
    }
}
