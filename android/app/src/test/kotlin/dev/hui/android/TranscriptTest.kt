/** The chat's rows: a snapshot's transcript, streamed text joining one live reply, and a tool call from start to end. */
package dev.hui.android

import dev.hui.android.core.ChatRow
import dev.hui.android.core.applyEvent
import dev.hui.android.core.rowsOf
import dev.hui.android.core.transcriptOf
import dev.hui.android.gateway.HuiJson
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class TranscriptTest {
    private fun json(text: String) = HuiJson.parseToJsonElement(text) as JsonObject

    @Test
    fun snapshotRows() {
        val transcript = transcriptOf(json("""{"transcript":[{"kind":"message","role":"user","text":"hi"},{"kind":"tool","id":"t1","name":"read","output":"x"},{"kind":"future-kind"}]}"""))!!
        assertEquals(
            listOf(ChatRow.Message("t0", "user", "hi"), ChatRow.Tool("t1", "t1", "read", false, false, "x")),
            rowsOf(transcript),
        )
    }

    @Test
    fun streamedTextAndTools() {
        var rows: List<ChatRow> = listOf(ChatRow.Message("t0", "user", "hi"))
        for (event in listOf(
            """{"type":"text","delta":"Hel"}""",
            """{"type":"text","delta":"lo"}""",
            """{"type":"tool_start","id":"c1","name":"bash"}""",
            """{"type":"tool_end","id":"c1","name":"bash","output":"ok"}""",
            """{"type":"text","delta":"Done"}""",
        )) rows = applyEvent(rows, json(event), 1)
        assertEquals(listOf("user:hi", "assistant:Hello", "bash:false:ok", "assistant:Done"), rows.map {
            when (it) {
                is ChatRow.Message -> "${it.role}:${it.text}"
                is ChatRow.Tool -> "${it.name}:${it.running}:${it.output}"
                else -> it.toString()
            }
        })
    }
}
