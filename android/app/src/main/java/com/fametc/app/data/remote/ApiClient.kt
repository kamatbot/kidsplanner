package com.fametc.app.data.remote

import android.content.Context
import android.content.SharedPreferences
import android.webkit.CookieManager
import com.fametc.app.Config
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

object ApiClient {

    private const val PREFS_NAME = "fametc_cookies"
    private lateinit var prefs: SharedPreferences

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        coerceInputValues = true
    }

    lateinit var okHttpClient: OkHttpClient
        private set

    lateinit var retrofit: Retrofit
        private set

    lateinit var api: FamEtcApi
        private set

    fun initialize(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val cookieJar = PersistentCookieJar(prefs)

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val headerInterceptor = Interceptor { chain ->
            val original = chain.request()
            val requestBuilder = original.newBuilder()

            // Attach client headers (X-FamETC-Client: android, client secret key if set)
            Config.clientHeaders.forEach { (k, v) ->
                requestBuilder.header(k, v)
            }
            requestBuilder.header("User-Agent", Config.webUserAgentToken)

            chain.proceed(requestBuilder.build())
        }

        okHttpClient = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(headerInterceptor)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS) // support chat long-poll wait
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        retrofit = Retrofit.Builder()
            .baseUrl(Config.baseURL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        api = retrofit.create(FamEtcApi::class.java)
    }

    /**
     * Manually sync stored cookies into android.webkit.CookieManager so
     * in-app HybridWebView instances load already signed in.
     */
    fun syncCookiesToWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        val raw = prefs.getString("all_cookies", null) ?: return
        for (cookieStr in raw.split("\n")) {
            if (cookieStr.isNotBlank()) {
                cookieManager.setCookie(Config.baseURL, cookieStr)
            }
        }
        cookieManager.flush()
    }

    fun clearCookies() {
        prefs.edit().clear().apply()
        val cookieManager = CookieManager.getInstance()
        cookieManager.removeAllCookies(null)
        cookieManager.flush()
    }

    private class PersistentCookieJar(private val prefs: SharedPreferences) : CookieJar {
        private val cookies = mutableMapOf<String, Cookie>()

        init {
            val raw = prefs.getString("all_cookies", null)
            raw?.split("\n")?.forEach { line ->
                val parts = line.split(";", limit = 2)
                if (parts.isNotEmpty()) {
                    val kv = parts[0].trim()
                    val eq = kv.indexOf('=')
                    if (eq > 0) {
                        val name = kv.substring(0, eq).trim()
                        val value = kv.substring(eq + 1).trim()
                        val cookie = Cookie.Builder()
                            .domain("fametc.com")
                            .path("/")
                            .name(name)
                            .value(value)
                            .build()
                        cookies[name] = cookie
                    }
                }
            }
        }

        override fun saveFromResponse(url: HttpUrl, cookieList: List<Cookie>) {
            var updated = false
            for (cookie in cookieList) {
                cookies[cookie.name] = cookie
                updated = true
            }
            if (updated) {
                val serialized = cookies.values.joinToString("\n") { "${it.name}=${it.value}; Path=/; Domain=${it.domain}" }
                prefs.edit().putString("all_cookies", serialized).apply()
                syncCookiesToWebView()
            }
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            return cookies.values.toList()
        }
    }
}
