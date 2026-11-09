/** SSE framing: named events, multi-line data, CRLF, heartbeat comments and frames without an event name. */
package dev.hui.android

import dev.hui.android.gateway.SseDecoder
import dev.hui.android.gateway.SseFrame
import org.junit.Assert.assertEquals
import org.junit.Test

class SseDecoderTest {
    private fun decode(vararg lines: String): List<SseFrame> {
        val decoder = SseDecoder()
        return lines.mapNotNull(decoder::line)
    }

    @Test
    fun namedEventsAndHeartbeats() {
        assertEquals(
            listOf(SseFrame("status", "{\"status\":\"running\"}"), SseFrame("message", "a\nb")),
            decode(": heartbeat", "", "event: status\r", "data: {\"status\":\"running\"}\r", "\r", "data:a", "data: b", ""),
        )
    }

    @Test
    fun aBlankLineWithoutDataIsNoFrame() {
        assertEquals(emptyList<SseFrame>(), decode("event: snapshot", "", ""))
    }
}
