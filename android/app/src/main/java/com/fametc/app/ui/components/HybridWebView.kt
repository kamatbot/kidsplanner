package com.fametc.app.ui.components

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.*
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.fametc.app.Config
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.ui.theme.FamTheme

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HybridWebView(
    path: String,
    isEmbedded: Boolean = false,
    modifier: Modifier = Modifier
) {
    var isLoading by remember { mutableStateOf(true) }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            factory = { context ->
                ApiClient.syncCookiesToWebView()

                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        allowFileAccess = false
                        databaseEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        userAgentString = "$userAgentString ${Config.webUserAgentToken}"
                    }

                    // Javascript interface bridge
                    addJavascriptInterface(FamWebAppInterface(), Config.BRIDGE_NAME)

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val url = request?.url?.toString() ?: return false
                            if (Config.isAllowedHost(url)) {
                                return false // load inside WebView
                            }
                            // Open external link in system browser
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                            } catch (e: Exception) {
                                // ignore
                            }
                            return true
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            if (isEmbedded) {
                                view?.evaluateJavascript(EMBEDDED_SHELL_SCRIPT, null)
                            }
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            if (isEmbedded) {
                                view?.evaluateJavascript(EMBEDDED_SHELL_SCRIPT, null)
                            }
                            isLoading = false
                        }
                    }

                    val fullUrl = if (path.startsWith("http")) path else "${Config.baseURL}$path"
                    loadUrl(fullUrl)
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = FamTheme.colors.accent
            )
        }
    }
}

class FamWebAppInterface {
    @JavascriptInterface
    fun postMessage(message: String) {
        // Handle JS bridge messages if needed
    }
}

private const val EMBEDDED_SHELL_SCRIPT = """
    (function() {
        var style = document.createElement('style');
        style.textContent = '.standalone-app-shell .app-sidebar { display: none !important; }' +
            '.standalone-app-shell .standalone-main-content-wrap { flex: 1 1 100% !important; width: 100% !important; }';
        (document.head || document.documentElement).appendChild(style);
    }());
"""
