/**
 * The slice of the gateway's payloads (`docs/api.schema.json`) the app reads so far, decoded leniently so a newer
 * gateway's extra fields never break it. These are hand-written until the schema emitter writes Kotlin
 * (docs/native-android-plan.md, 2.4).
 */
package dev.hui.android.gateway

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

val HuiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

@Serializable
data class UpdateSnapshot(val currentVersion: String? = null)

@Serializable
data class SessionList(val revision: Long = 0, val groups: List<SessionGroup> = emptyList())

@Serializable
data class SessionGroup(val label: String, val sessions: List<SessionView> = emptyList())

@Serializable
data class SessionView(
    val id: String,
    val title: String = "",
    val group: String = "",
    val displayCwd: String = "",
    val status: String = "idle",
    val model: String? = null,
    val parentId: String? = null,
    val bot: SessionBot? = null,
    val archived: Boolean? = null,
    val unread: Boolean? = null,
    val pinned: Boolean? = null,
    val updatedAt: String = "",
)

@Serializable
data class SessionBot(val id: String, val handle: String = "", val name: String = "")

@Serializable
data class SessionStatusUpdate(val id: String, val status: String, val unread: Boolean? = null, val title: String? = null)

@Serializable
data class OpenResponse(val session: SessionView, val snapshot: SessionSnapshot)

@Serializable
data class SessionSnapshot(val transcript: List<JsonObject>? = null, val status: String = "idle")
