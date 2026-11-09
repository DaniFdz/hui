/**
 * The chat's rows from a session stream: a snapshot's transcript replaces them, and live events (text and thinking
 * deltas, tool start/update/end, errors) extend the turn in progress until the settled snapshot replaces it again. A
 * small first port of `src/lib/transcript-state.ts`; conformance fixtures from the TypeScript tests will pin it
 * (docs/native-android-plan.md, 2.5).
 */
package dev.hui.android.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

sealed interface ChatRow {
    val key: String

    data class Message(override val key: String, val role: String, val text: String) : ChatRow
    data class Thinking(override val key: String, val text: String) : ChatRow
    data class Tool(override val key: String, val id: String, val name: String, val running: Boolean, val failed: Boolean, val output: String) : ChatRow
    data class Error(override val key: String, val message: String) : ChatRow
    data class Note(override val key: String, val text: String) : ChatRow
}

private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.bool(name: String): Boolean = (this[name] as? JsonPrimitive)?.booleanOrNull == true

/** Rows of a snapshot transcript, keyed by position so a later snapshot reuses them. */
fun rowsOf(transcript: List<JsonObject>): List<ChatRow> = transcript.mapIndexedNotNull { index, entry ->
    val key = "t$index"
    when (entry.string("kind")) {
        "message" -> ChatRow.Message(key, entry.string("role") ?: "assistant", entry.string("text") ?: "")
        "thinking" -> ChatRow.Thinking(key, entry.string("text") ?: "")
        "tool" -> ChatRow.Tool(key, entry.string("id") ?: key, entry.string("name") ?: "tool", false, entry.bool("failed"), entry.string("output") ?: "")
        "error" -> ChatRow.Error(key, entry.string("message") ?: "")
        "compaction" -> ChatRow.Note(key, "Context compacted")
        "call" -> ChatRow.Note(key, "Call with ${entry.string("call") ?: "a bot"}")
        else -> null
    }
}

/** Applies one runtime event (`SessionEvent`) to the rows. */
fun applyEvent(rows: List<ChatRow>, event: JsonObject, live: Int): List<ChatRow> {
    val key = "l$live-${rows.size}"
    return when (event.string("type")) {
        "text" -> appendDelta(rows, key, event.string("delta") ?: "", thinking = false)
        "thinking" -> appendDelta(rows, key, event.string("delta") ?: "", thinking = true)
        "tool_start" -> rows + ChatRow.Tool(key, event.string("id") ?: key, event.string("name") ?: "tool", true, false, "")
        "tool_update", "tool_end" -> {
            val id = event.string("id")
            val at = rows.indexOfLast { it is ChatRow.Tool && it.id == id }
            if (at < 0) rows
            else rows.toMutableList().also {
                val tool = it[at] as ChatRow.Tool
                it[at] = tool.copy(
                    running = event.string("type") == "tool_update",
                    failed = event.bool("failed"),
                    output = event.string("output") ?: tool.output,
                )
            }
        }
        "error" -> rows + ChatRow.Error(key, event.string("message") ?: "")
        else -> rows
    }
}

private fun appendDelta(rows: List<ChatRow>, key: String, delta: String, thinking: Boolean): List<ChatRow> {
    val last = rows.lastOrNull()
    if (!thinking && last is ChatRow.Message && last.role == "assistant" && last.key.startsWith("l")) {
        return rows.dropLast(1) + last.copy(text = last.text + delta)
    }
    if (thinking && last is ChatRow.Thinking && last.key.startsWith("l")) {
        return rows.dropLast(1) + last.copy(text = last.text + delta)
    }
    return rows + if (thinking) ChatRow.Thinking(key, delta) else ChatRow.Message(key, "assistant", delta)
}

/** A transcript array read from a frame's JSON, or null when the frame carries none. */
fun transcriptOf(data: JsonElement?): List<JsonObject>? =
    ((data as? JsonObject)?.get("transcript") as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it as? JsonObject }
