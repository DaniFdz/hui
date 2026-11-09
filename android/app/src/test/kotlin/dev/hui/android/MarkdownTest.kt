/** The chat's Markdown: the blocks an agent reply uses, inline spans, and links limited to safe schemes. */
package dev.hui.android

import dev.hui.android.core.MdBlock
import dev.hui.android.core.MdSpan
import dev.hui.android.core.parseInline
import dev.hui.android.core.parseMarkdown
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    @Test
    fun blocks() {
        val source = "# Tool complete\n\n- output received\n- **Markdown verified**\n\n```text\nfixture-ok\n```\n\n| Check | Result |\n| --- | --- |\n| Tool | Passed |\n\nTwo\nlines"
        assertEquals(
            listOf(
                MdBlock.Heading(1, "Tool complete"),
                MdBlock.ListItem("•", "output received", 0),
                MdBlock.ListItem("•", "**Markdown verified**", 0),
                MdBlock.Code("text", "fixture-ok"),
                MdBlock.Table(listOf("Check", "Result"), listOf(listOf("Tool", "Passed"))),
                MdBlock.Paragraph("Two lines"),
            ),
            parseMarkdown(source),
        )
    }

    @Test
    fun inlineSpansAndSafeLinks() {
        assertEquals(
            listOf(MdSpan.Plain("a "), MdSpan.Bold("b"), MdSpan.Plain(" "), MdSpan.Code("c"), MdSpan.Plain(" "), MdSpan.Link("d", "https://x.dev"), MdSpan.Plain(" "), MdSpan.Plain("e"), MdSpan.Plain(" "), MdSpan.Italic("f")),
            parseInline("a **b** `c` [d](https://x.dev) [e](javascript:void) *f*"),
        )
    }
}
