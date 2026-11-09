/**
 * The session list: the gateway's groups in its order (`ungrouped` shown as OTHER, labels uppercase, as the web's
 * sidebar shows them), each session's title, folder and live status, without archived sessions, subagents and bot
 * chats (the web lists those under their parent and their bot).
 */
package dev.hui.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.hui.android.UiState
import dev.hui.android.gateway.SessionView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(state: UiState, onOpen: (String) -> Unit, onDisconnect: () -> Unit, modifier: Modifier = Modifier) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Sessions")
                        Text(
                            state.gateway?.version?.let { "Gateway $it" } ?: "Development gateway: its version is unverified.",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = { TextButton(onClick = onDisconnect) { Text("Change gateway") } },
            )
        },
    ) { padding ->
        val groups = state.groups
            .map { group -> group to group.sessions.filter { it.archived != true && it.parentId == null && it.bot == null } }
            .filter { (_, sessions) -> sessions.isNotEmpty() }
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            state.listError?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }
            if (groups.isEmpty() && state.listError == null) item { Text("No sessions yet.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            groups.forEach { (group, sessions) ->
                item(key = "group:${group.label}") {
                    Text(
                        if (group.label == "ungrouped") "OTHER" else group.label.uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 6.dp),
                    )
                }
                items(sessions, key = { it.id }) { session ->
                    SessionRow(session, onOpen)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
private fun SessionRow(session: SessionView, onOpen: (String) -> Unit) {
    val title = session.title.ifBlank { "Untitled session" }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onOpen(session.id) }
            .clearAndSetSemantics {
                contentDescription = "$title, status ${session.status}"
                role = Role.Button
            }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StatusDot(session.status, session.unread == true)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                session.displayCwd,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(statusLabel(session.status), style = MaterialTheme.typography.labelMedium, color = statusColor(session.status))
    }
}

@Composable
fun StatusDot(status: String, unread: Boolean) {
    Box(
        Modifier.size(10.dp).clip(CircleShape).background(
            if (unread && status == "idle") MaterialTheme.colorScheme.primary else statusColor(status),
        ),
    )
}

fun statusLabel(status: String) = when (status) {
    "idle" -> "Idle"
    "running" -> "Running"
    "waiting" -> "Needs input"
    "starting" -> "Starting"
    "error" -> "Error"
    "reconnecting" -> "Reconnecting"
    "disconnected" -> "Disconnected"
    else -> status
}

@Composable
fun statusColor(status: String): Color = when (status) {
    "running", "starting", "reconnecting" -> MaterialTheme.colorScheme.primary
    "waiting" -> Color(0xFFD29922)
    "error", "disconnected" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}
