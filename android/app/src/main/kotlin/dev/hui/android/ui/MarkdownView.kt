/** Draws `parseMarkdown`'s blocks with HUI's type: code in a scrolling monospace card, tables in a horizontal scroll. */
package dev.hui.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.hui.android.core.MdBlock
import dev.hui.android.core.MdSpan
import dev.hui.android.core.parseInline
import dev.hui.android.core.parseMarkdown

@Composable
fun MarkdownView(source: String, modifier: Modifier = Modifier) {
    val blocks = remember(source) { parseMarkdown(source) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (block in blocks) Block(block)
    }
}

@Composable
private fun inline(text: String): AnnotatedString {
    val code = MaterialTheme.colorScheme.surfaceContainer
    val link = MaterialTheme.colorScheme.primary
    return buildAnnotatedString {
        for (span in parseInline(text)) when (span) {
            is MdSpan.Plain -> append(span.text)
            is MdSpan.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(span.text) }
            is MdSpan.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(span.text) }
            is MdSpan.Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = code)) { append(span.text) }
            is MdSpan.Link -> withLink(LinkAnnotation.Url(span.url, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) { append(span.text) }
        }
    }
}

@Composable
private fun Block(block: MdBlock) {
    val type = MaterialTheme.typography
    when (block) {
        is MdBlock.Heading -> Text(
            inline(block.text),
            style = when (block.level) { 1 -> type.titleLarge; 2 -> type.titleMedium; else -> type.titleSmall },
            fontWeight = FontWeight.SemiBold,
        )
        is MdBlock.Paragraph -> Text(inline(block.text), style = type.bodyLarge)
        is MdBlock.ListItem -> Row(Modifier.padding(start = (block.depth * 16).dp)) {
            Text(block.marker, style = type.bodyLarge, modifier = Modifier.width(24.dp))
            Text(inline(block.text), style = type.bodyLarge)
        }
        is MdBlock.Quote -> Row {
            Column(Modifier.width(3.dp).height(20.dp).background(MaterialTheme.colorScheme.outline)) {}
            Text(inline(block.text), style = type.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp))
        }
        is MdBlock.Code -> Text(
            block.text,
            fontFamily = FontFamily.Monospace,
            style = type.bodySmall,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .horizontalScroll(rememberScrollState())
                .padding(12.dp),
        )
        is MdBlock.Table -> Column(
            Modifier
                .horizontalScroll(rememberScrollState())
                .clip(RoundedCornerShape(8.dp))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)),
        ) {
            TableRow(block.header, header = true)
            for (row in block.rows) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                TableRow(row, header = false)
            }
        }
        MdBlock.Rule -> HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun TableRow(cells: List<String>, header: Boolean) {
    Row(Modifier.background(if (header) MaterialTheme.colorScheme.surfaceContainer else Color.Transparent)) {
        for (cell in cells) Text(
            inline(cell),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.width(140.dp).padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}
