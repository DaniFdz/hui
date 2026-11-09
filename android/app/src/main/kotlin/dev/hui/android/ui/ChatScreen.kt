/**
 * One session's chat: the transcript's messages (the agent's as Markdown), thinking, tool calls and errors as rows (newest at the bottom), its
 * live status, and a composer that sends with a request id and turns into Stop while a turn runs.
 */
package dev.hui.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.hui.android.ChatState
import dev.hui.android.core.ChatRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    chat: ChatState,
    onBack: () -> Unit,
    onDraft: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val running = chat.status == "running" || chat.status == "starting"
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = {
                    Column {
                        Text(chat.title.ifBlank { "Session" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(statusLabel(chat.status), style = MaterialTheme.typography.labelMedium, color = statusColor(chat.status))
                    }
                },
            )
        },
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.navigationBarsPadding().imePadding().padding(12.dp)) {
                    chat.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = chat.draft,
                            onValueChange = onDraft,
                            label = { Text("Message") },
                            maxLines = 6,
                            modifier = Modifier.weight(1f).testTag("composer"),
                        )
                        if (running) OutlinedButton(onClick = onStop) { Text("Stop") }
                        else Button(onClick = onSend, enabled = chat.draft.isNotBlank() && !chat.sending) { Text("Send") }
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (chat.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            val list = rememberLazyListState()
            LaunchedEffect(chat.rows.size, (chat.rows.lastOrNull() as? ChatRow.Message)?.text?.length) {
                if (chat.rows.isNotEmpty()) list.scrollToItem(chat.rows.size - 1)
            }
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize().testTag("transcript"),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            ) {
                items(chat.rows, key = { it.key }) { row -> Row(row) }
            }
        }
    }
}

@Composable
private fun Row(row: ChatRow) {
    when (row) {
        is ChatRow.Message -> if (row.role == "user") {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.widthIn(max = 320.dp),
                ) { SelectionContainer { Text(row.text, Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) } }
            }
        } else {
            SelectionContainer { MarkdownView(row.text) }
        }
        is ChatRow.Thinking -> Folded("Thinking", row.text)
        is ChatRow.Tool -> Folded(
            when {
                row.running -> "${row.name} · running"
                row.failed -> "${row.name} · failed"
                else -> row.name
            },
            row.output,
            mono = true,
        )
        is ChatRow.Error -> Text(row.message, color = MaterialTheme.colorScheme.error)
        is ChatRow.Note -> Text(row.text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A one-line card that opens to its text, as the web folds thinking and tool output. */
@Composable
private fun Folded(title: String, body: String, mono: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        TextButton(onClick = { open = !open }, modifier = Modifier.fillMaxWidth()) {
            Text(title, modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (open && body.isNotBlank()) {
            Text(
                body.take(4000),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
            )
        }
    }
}
