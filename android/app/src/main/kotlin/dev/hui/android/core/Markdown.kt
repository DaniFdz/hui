/**
 * A first Markdown reader for the chat: blocks (headings, paragraphs, bullet and numbered lists, fenced code, tables,
 * quotes, rules) and inline spans (bold, italic, code, links), enough for agent replies. The web's full rules
 * (`src/lib/markdown/parser.ts`: math, alerts, embeds, file references) arrive with its tokens or a port
 * (docs/native-android-plan.md, 2.7); raw HTML stays text, as it does there.
 */
package dev.hui.android.core

sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class ListItem(val marker: String, val text: String, val depth: Int) : MdBlock
    data class Code(val language: String, val text: String) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data class Quote(val text: String) : MdBlock
    data object Rule : MdBlock
}

sealed interface MdSpan {
    val text: String

    data class Plain(override val text: String) : MdSpan
    data class Bold(override val text: String) : MdSpan
    data class Italic(override val text: String) : MdSpan
    data class Code(override val text: String) : MdSpan
    data class Link(override val text: String, val url: String) : MdSpan
}

private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
private val BULLET = Regex("^(\\s*)([-*+])\\s+(.*)$")
private val NUMBERED = Regex("^(\\s*)(\\d+[.)])\\s+(.*)$")
private val FENCE = Regex("^\\s*(```|~~~)\\s*([\\w+-]*)")
private val TABLE_DIVIDER = Regex("^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")

private fun cells(line: String) = line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }

fun parseMarkdown(source: String): List<MdBlock> {
    val lines = source.replace("\r\n", "\n").split("\n")
    val blocks = mutableListOf<MdBlock>()
    val paragraph = mutableListOf<String>()
    fun flush() {
        if (paragraph.isNotEmpty()) blocks += MdBlock.Paragraph(paragraph.joinToString(" ") { it.trim() })
        paragraph.clear()
    }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val fence = FENCE.find(line)
        when {
            fence != null -> {
                flush()
                val close = fence.groupValues[1]
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(close)) body += lines[i++]
                blocks += MdBlock.Code(fence.groupValues[2], body.joinToString("\n"))
            }
            line.isBlank() -> flush()
            HEADING.matches(line) -> {
                flush()
                val match = HEADING.find(line)!!
                blocks += MdBlock.Heading(match.groupValues[1].length, match.groupValues[2].trim().trimEnd('#').trim())
            }
            RULE.matches(line) -> {
                flush()
                blocks += MdBlock.Rule
            }
            line.contains('|') && i + 1 < lines.size && TABLE_DIVIDER.matches(lines[i + 1]) -> {
                flush()
                val header = cells(line)
                i += 2
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && lines[i].contains('|') && lines[i].isNotBlank()) rows += cells(lines[i++])
                blocks += MdBlock.Table(header, rows)
                continue
            }
            BULLET.matches(line) || NUMBERED.matches(line) -> {
                flush()
                val match = BULLET.find(line) ?: NUMBERED.find(line)!!
                val marker = match.groupValues[2].let { if (it.first().isDigit()) it else "•" }
                blocks += MdBlock.ListItem(marker, match.groupValues[3], match.groupValues[1].length / 2)
            }
            line.trimStart().startsWith(">") -> {
                flush()
                blocks += MdBlock.Quote(line.trimStart().removePrefix(">").trim())
            }
            else -> paragraph += line
        }
        i++
    }
    flush()
    return blocks
}

private val INLINE = Regex("\\*\\*(.+?)\\*\\*|__(.+?)__|`([^`]+)`|\\[([^\\]]+)]\\(([^)\\s]+)\\)|(?<![\\w*])\\*(?!\\s)(.+?)(?<!\\s)\\*(?![\\w*])|(?<!\\w)_(?!\\s)(.+?)(?<!\\s)_(?!\\w)")

fun parseInline(text: String): List<MdSpan> {
    val spans = mutableListOf<MdSpan>()
    var at = 0
    for (match in INLINE.findAll(text)) {
        if (match.range.first > at) spans += MdSpan.Plain(text.substring(at, match.range.first))
        val g = match.groupValues
        spans += when {
            g[1].isNotEmpty() -> MdSpan.Bold(g[1])
            g[2].isNotEmpty() -> MdSpan.Bold(g[2])
            g[3].isNotEmpty() -> MdSpan.Code(g[3])
            g[4].isNotEmpty() -> safeLink(g[4], g[5])
            g[6].isNotEmpty() -> MdSpan.Italic(g[6])
            else -> MdSpan.Italic(g[7])
        }
        at = match.range.last + 1
    }
    if (at < text.length) spans += MdSpan.Plain(text.substring(at))
    return spans
}

/** Only http(s) and mailto links open; anything else stays its text, as the web's safe-scheme rule keeps it. */
private fun safeLink(text: String, url: String): MdSpan =
    if (Regex("^(https?:|mailto:)", RegexOption.IGNORE_CASE).containsMatchIn(url)) MdSpan.Link(text, url) else MdSpan.Plain(text)
