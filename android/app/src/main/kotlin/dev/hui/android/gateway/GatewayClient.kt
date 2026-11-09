/**
 * The app's one client of a HUI gateway: every request carries `x-hui: 1` (the gateway's API gate), JSON is decoded
 * leniently, and event streams are read line by line into `SseFrame`s. It owns the gateway check the Connect screen
 * runs (SPEC.md, "The iOS app connects to one gateway", which the 2026-11-09 decision applies to Android).
 */
package dev.hui.android.gateway

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class GatewayError(message: String) : IOException(message)

/** What a gateway said about itself: its released version, or null for a development gateway. */
data class GatewayIdentity(val url: String, val version: String?)

class GatewayClient(val baseUrl: HttpUrl) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()
    // A stream's only deadline is the connection's: it stays open across turns and the gateway heartbeats it.
    private val streams = http.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()

    private fun request(path: String) = Request.Builder().url(baseUrl.resolve(path)!!).header("x-hui", "1")

    private suspend fun call(request: Request): String = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val body = response.body.string()
            if (!response.isSuccessful) throw GatewayError(errorMessage(body) ?: "The gateway answered ${response.code}.")
            body
        }
    }

    private fun errorMessage(body: String): String? = runCatching {
        HuiJson.parseToJsonElement(body).let { (it as? kotlinx.serialization.json.JsonObject)?.get("error")?.toString()?.trim('"') }
    }.getOrNull()

    suspend fun identity(): GatewayIdentity {
        val body = try {
            call(request("/__hui/update").get().build())
        } catch (error: GatewayError) {
            throw GatewayError(NOT_HUI)
        }
        val snapshot = try {
            HuiJson.decodeFromString<UpdateSnapshot>(body).also {
                if (!body.contains("\"currentVersion\"")) throw SerializationException("no currentVersion")
            }
        } catch (error: SerializationException) {
            throw GatewayError(NOT_HUI)
        } catch (error: IllegalArgumentException) {
            throw GatewayError(NOT_HUI)
        }
        return GatewayIdentity(baseUrl.toString().removeSuffix("/"), snapshot.currentVersion)
    }

    suspend fun sessions(): SessionList = HuiJson.decodeFromString(call(request("/__hui/sessions").get().build()))

    suspend fun open(id: String): OpenResponse =
        HuiJson.decodeFromString(call(request("/__hui/sessions/${id.encoded()}/open").post(EMPTY).build()))

    suspend fun prompt(id: String, text: String, requestId: String) {
        val body = buildJsonObject {
            put("text", text)
            put("requestId", requestId)
        }.toString().toRequestBody(JSON)
        call(request("/__hui/sessions/${id.encoded()}/prompt").post(body).build())
    }

    suspend fun abort(id: String) {
        call(request("/__hui/sessions/${id.encoded()}/abort").post(EMPTY).build())
    }

    /** The frames of one event stream until it ends or fails; the caller reconnects. */
    fun events(path: String): Flow<SseFrame> = flow {
        val response = streams.newCall(request(path).header("accept", "text/event-stream").get().build()).execute()
        response.use {
            if (!it.isSuccessful) throw GatewayError("The stream answered ${it.code}.")
            val source = it.body.source()
            val decoder = SseDecoder()
            while (currentCoroutineContext().isActive) {
                val line = source.readUtf8Line() ?: break
                decoder.line(line)?.let { frame -> emit(frame) }
            }
        }
    }.flowOn(Dispatchers.IO)

    private fun String.encoded() = java.net.URLEncoder.encode(this, "UTF-8").replace("+", "%20")

    companion object {
        const val NOT_HUI = "This address doesn't answer as a HUI gateway."
        const val ENTER_ADDRESS = "Enter the gateway's address, such as http://127.0.0.1:4000."
        private val JSON = "application/json".toMediaType()
        private val EMPTY = "{}".toRequestBody(JSON)

        /** A typed address as a gateway URL: a scheme is added when missing; null when it isn't an address. */
        fun parse(typed: String): HttpUrl? {
            val trimmed = typed.trim()
            if (trimmed.isEmpty()) return null
            val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
            return withScheme.toHttpUrlOrNull()?.takeIf { it.scheme == "http" || it.scheme == "https" }
        }
    }
}
