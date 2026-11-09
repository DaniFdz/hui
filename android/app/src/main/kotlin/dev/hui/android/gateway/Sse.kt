/**
 * Server-sent event framing for the gateway's streams (`GET /__hui/sessions/events`, `GET /__hui/sessions/:id/events`):
 * lines in, `{event, data}` frames out. Multi-line `data:` joins with newlines, a comment (`:`) is a heartbeat, CRLF and
 * a missing `event:` (meaning "message") are handled as `src/lib/event-stream.ts` handles them on the web.
 */
package dev.hui.android.gateway

data class SseFrame(val event: String, val data: String)

class SseDecoder {
    private var event: String? = null
    private val data = StringBuilder()
    private var hasData = false

    /** Feeds one line without its terminator; returns the frame a blank line completes, if any. */
    fun line(raw: String): SseFrame? {
        val line = raw.removeSuffix("\r")
        if (line.isEmpty()) {
            val frame = if (hasData) SseFrame(event ?: "message", data.toString()) else null
            event = null
            data.setLength(0)
            hasData = false
            return frame
        }
        if (line.startsWith(":")) return null
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.substring(0, colon)
        var value = if (colon < 0) "" else line.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "event" -> event = value
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
        }
        return null
    }
}
