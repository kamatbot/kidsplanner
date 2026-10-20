package com.fametc.portal

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSource
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PortalApiException(val status: Int, message: String) : IOException(message)

class PortalApi {
    companion object {
        const val ORIGIN = "https://www.fametc.com"
        const val SETUP_ADDRESS = "www.fametc.com/displays"
        val json = Json { ignoreUnknownKeys = true }
        private val PHOTO_ID = Regex("a_[0-9a-f]{36}")
        private const val MAX_JSON_BYTES = 2L * 1024 * 1024
        private const val MAX_PHOTO_BYTES = 8L * 1024 * 1024
    }

    // No cookie jar, redirects, request logging, Google services or custom host.
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun pair(code: String, model: String): PairResponse {
        val response = request(
            Request.Builder().url("$ORIGIN/api/display/pair")
                .post(json.encodeToString(PairRequest(code, model.take(100))).toRequestBody(jsonType))
                .build()
        )
        return withContext(Dispatchers.Default) {
            val parsed = json.decodeFromString<PairResponse>(response)
            if (!parsed.token.matches(Regex("fdp_[A-Za-z0-9_-]{43}")) || parsed.device.id.isBlank()) {
                throw IOException("Could not finish pairing. Generate a new code on your phone.")
            }
            ZoneId.of(parsed.device.timeZone)
            parsed
        }
    }

    suspend fun context(token: String): DisplayContext {
        val response = request(
            Request.Builder().url("$ORIGIN/api/display/context")
                .header("Authorization", "Bearer $token")
                .header("Cache-Control", "no-cache")
                .build()
        )
        return withContext(Dispatchers.Default) {
            val result = json.decodeFromString<DisplayContext>(response)
            if (result.schemaVersion != 1 || result.days.size != 7 || result.members.size > 100 ||
                result.homework.size > 500 || result.meals.size > 100 ||
                result.days.any { it.events.size > 500 }
            ) throw IOException("This display needs an app update to show the latest data.")
            ZoneId.of(result.timeZone)
            Instant.parse(result.generatedAt)
            val firstDay = LocalDate.parse(result.today)
            result.days.forEachIndexed { index, day ->
                if (LocalDate.parse(day.date) != firstDay.plusDays(index.toLong())) {
                    throw IOException("The calendar response was incomplete. Try refreshing.")
                }
            }
            result
        }
    }

    suspend fun disconnect(token: String) {
        request(
            Request.Builder().url("$ORIGIN/api/display/disconnect")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody(jsonType)).build()
        )
    }

    suspend fun photo(token: String, id: String): ByteArray {
        if (!PHOTO_ID.matches(id)) throw IOException("Invalid photo id")
        return call(
            Request.Builder().url("$ORIGIN/api/display/photos/$id")
                .header("Authorization", "Bearer $token")
                .header("Cache-Control", "no-cache")
                .build(),
            "image/*", MAX_PHOTO_BYTES,
        ) { it.readByteArray() }
    }

    private suspend fun request(request: Request): String =
        call(request, "application/json", MAX_JSON_BYTES) { it.readUtf8() }

    private suspend fun <T> call(request: Request, accept: String, limit: Long, parse: (BufferedSource) -> T): T = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request.newBuilder().header("Accept", accept).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        if (response.code == 401 || response.code == 403) {
                            throw PortalApiException(response.code, "This display no longer has access.")
                        }
                        val body = response.body ?: throw IOException("Empty response")
                        // Read at most `limit` bytes (2 MiB for error bodies) even when Content-Length is absent.
                        val max = if (response.isSuccessful) limit else MAX_JSON_BYTES
                        val source = body.source()
                        source.request(max + 1)
                        if (source.buffer.size > max) throw IOException("Response too large")
                        if (!response.isSuccessful) {
                            val serverMessage = runCatching {
                                json.parseToJsonElement(source.readUtf8()).jsonObject["error"]?.jsonPrimitive?.content
                            }.getOrNull()
                            throw PortalApiException(response.code, serverMessage?.take(180) ?: "Fam ETC is temporarily unavailable.")
                        }
                        val parsed = parse(source)
                        if (continuation.isActive) continuation.resume(parsed)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            }
        })
    }
}
