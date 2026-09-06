package com.fametc.app

import android.net.Uri

/**
 * Central configuration for the Fam ETC Android client.
 * Mirrors iOS Config.swift.
 */
object Config {
    // Canonical production origin. Matches server CANONICAL_HOST.
    const val DEFAULT_BASE_URL = "https://www.fametc.com"

    var baseURL: String = DEFAULT_BASE_URL

    val allowedHosts: Set<String> = setOf("www.fametc.com", "fametc.com")

    const val BRIDGE_NAME = "fam"

    // WebAuthn Relying Party ID
    const val RP_ID = "fametc.com"

    // Android client identification headers
    var androidClientKey: String = ""

    val clientHeaders: Map<String, String>
        get() {
            val headers = mutableMapOf("X-FamETC-Client" to "android")
            if (androidClientKey.isNotEmpty()) {
                headers["X-FamETC-Client-Key"] = androidClientKey
            }
            return headers
        }

    val webUserAgentToken: String
        get() = if (androidClientKey.isEmpty()) "FamETCAndroid" else "FamETCAndroid/$androidClientKey"

    fun isAllowedHost(urlStr: String?): Boolean {
        if (urlStr == null) return false
        val host = Uri.parse(urlStr).host?.lowercase() ?: return false
        return allowedHosts.contains(host)
    }
}
