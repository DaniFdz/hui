/**
 * The app's state and its owner: which screen shows, the gateway it is connected to, the live session list and the
 * open chat. Mirrors the web's controllers (`src/controllers/settings-controller.ts` for the gateway,
 * `sessions-controller.ts`, `conversation-controller.ts` and `composer-controller.ts`) at MVP depth: it lists, opens,
 * streams and sends, and reconnects a dropped stream with the web's backoff.
 */
package dev.hui.android

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.hui.android.core.ChatRow
import dev.hui.android.core.applyEvent
import dev.hui.android.core.rowsOf
import dev.hui.android.core.transcriptOf
import dev.hui.android.gateway.GatewayClient
import dev.hui.android.gateway.GatewayError
import dev.hui.android.gateway.GatewayIdentity
import dev.hui.android.gateway.HuiJson
import dev.hui.android.gateway.SessionGroup
import dev.hui.android.gateway.SessionStatusUpdate
import java.util.UUID
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

sealed interface Screen {
    data object Connect : Screen
    data object Sessions : Screen
    data class Chat(val id: String) : Screen
}

data class ConnectState(val address: String = "", val checking: Boolean = false, val error: String? = null)

data class ChatState(
    val id: String,
    val title: String,
    val rows: List<ChatRow> = emptyList(),
    val status: String = "starting",
    val loading: Boolean = true,
    val draft: String = "",
    val sending: Boolean = false,
    val error: String? = null,
)

data class UiState(
    val screen: Screen = Screen.Connect,
    val connect: ConnectState = ConnectState(),
    val gateway: GatewayIdentity? = null,
    val groups: List<SessionGroup> = emptyList(),
    val listError: String? = null,
    val chat: ChatState? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("hui", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(UiState(connect = ConnectState(address = prefs.getString(GATEWAY_KEY, "") ?: "")))
    val state: StateFlow<UiState> = _state
    private var client: GatewayClient? = null
    private var listJob: Job? = null
    private var chatJob: Job? = null

    /** Opens on the launch extra's gateway, or the remembered one, without asking. */
    fun start(launchGateway: String?) {
        val address = launchGateway?.takeIf { it.isNotBlank() } ?: prefs.getString(GATEWAY_KEY, null)
        if (address != null && _state.value.gateway == null) {
            _state.update { it.copy(connect = it.connect.copy(address = address)) }
            connect()
        }
    }

    fun editAddress(address: String) = _state.update { it.copy(connect = it.connect.copy(address = address, error = null)) }

    fun connect() {
        val typed = _state.value.connect.address
        val url = GatewayClient.parse(typed)
        if (url == null) {
            _state.update { it.copy(connect = it.connect.copy(error = GatewayClient.ENTER_ADDRESS)) }
            return
        }
        _state.update { it.copy(connect = it.connect.copy(checking = true, error = null)) }
        viewModelScope.launch {
            val candidate = GatewayClient(url)
            try {
                val identity = candidate.identity()
                client = candidate
                prefs.edit().putString(GATEWAY_KEY, identity.url).apply()
                _state.update { it.copy(screen = Screen.Sessions, gateway = identity, connect = ConnectState(address = identity.url)) }
                watchSessions()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = if (error is GatewayError) error.message else GatewayClient.NOT_HUI
                _state.update { it.copy(connect = it.connect.copy(checking = false, error = message)) }
            }
        }
    }

    fun disconnect() {
        listJob?.cancel()
        chatJob?.cancel()
        client = null
        prefs.edit().remove(GATEWAY_KEY).apply()
        _state.update { UiState(connect = ConnectState(address = it.connect.address)) }
    }

    private fun watchSessions() {
        listJob?.cancel()
        listJob = viewModelScope.launch {
            val gateway = client ?: return@launch
            reconnecting { attempt ->
                refreshList(gateway)
                gateway.events("/__hui/sessions/events").collect { frame ->
                    attempt.reset()
                    when (frame.event) {
                        "sessions" -> refreshList(gateway)
                        "status" -> applyStatus(HuiJson.decodeFromString<SessionStatusUpdate>(frame.data))
                        "snapshot" -> {
                            val statuses = HuiJson.parseToJsonElement(frame.data).jsonObject["statuses"] as? JsonArray
                            statuses?.forEach { applyStatus(HuiJson.decodeFromJsonElement(SessionStatusUpdate.serializer(), it)) }
                        }
                    }
                }
            }
        }
    }

    private suspend fun refreshList(gateway: GatewayClient) {
        try {
            val list = gateway.sessions()
            _state.update { it.copy(groups = list.groups, listError = null) }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            _state.update { it.copy(listError = error.message ?: "The sessions didn't load.") }
            throw error
        }
    }

    private fun applyStatus(update: SessionStatusUpdate) = _state.update { state ->
        state.copy(
            groups = state.groups.map { group ->
                group.copy(sessions = group.sessions.map { if (it.id == update.id) it.copy(status = update.status, unread = update.unread ?: it.unread, title = update.title ?: it.title) else it })
            },
            chat = state.chat?.let { if (it.id == update.id) it.copy(status = update.status) else it },
        )
    }

    fun openChat(id: String) {
        val session = _state.value.groups.flatMap { it.sessions }.firstOrNull { it.id == id }
        _state.update { it.copy(screen = Screen.Chat(id), chat = ChatState(id = id, title = session?.title ?: "Session")) }
        chatJob?.cancel()
        chatJob = viewModelScope.launch {
            val gateway = client ?: return@launch
            reconnecting { attempt ->
                val opened = gateway.open(id)
                updateChat(id) { it.copy(title = opened.session.title, status = opened.snapshot.status, rows = opened.snapshot.transcript?.let(::rowsOf) ?: it.rows, loading = false, error = null) }
                var live = 0
                gateway.events("/__hui/sessions/${id}/events").collect { frame ->
                    attempt.reset()
                    val data = runCatching { HuiJson.parseToJsonElement(frame.data) }.getOrNull()
                    when (frame.event) {
                        "snapshot", "transcript" -> {
                            val transcript = transcriptOf(data)
                            val status = ((data as? JsonObject)?.get("status") as? JsonPrimitive)?.contentOrNull
                            updateChat(id) { chat -> chat.copy(rows = transcript?.let(::rowsOf) ?: chat.rows, status = status ?: chat.status, loading = false) }
                        }
                        "event" -> (data as? JsonObject)?.let { event ->
                            if ((event["type"] as? JsonPrimitive)?.contentOrNull == "turn_start") live++
                            updateChat(id) { chat -> chat.copy(rows = applyEvent(chat.rows, event, live)) }
                        }
                        "status" -> ((data as? JsonObject)?.get("status") as? JsonPrimitive)?.contentOrNull?.let { status -> updateChat(id) { it.copy(status = status) } }
                        "closed" -> return@collect
                    }
                }
            }
        }
    }

    fun closeChat() {
        chatJob?.cancel()
        _state.update { it.copy(screen = Screen.Sessions, chat = null) }
    }

    fun editDraft(text: String) {
        val id = _state.value.chat?.id ?: return
        updateChat(id) { it.copy(draft = text) }
    }

    fun send() {
        val chat = _state.value.chat ?: return
        val text = chat.draft.trim()
        if (text.isEmpty() || chat.sending) return
        val requestId = UUID.randomUUID().toString()
        updateChat(chat.id) { it.copy(sending = true, error = null) }
        viewModelScope.launch {
            try {
                client?.prompt(chat.id, text, requestId)
                updateChat(chat.id) { it.copy(sending = false, draft = "") }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                updateChat(chat.id) { it.copy(sending = false, error = error.message ?: "The message wasn't sent.") }
            }
        }
    }

    fun stop() {
        val chat = _state.value.chat ?: return
        viewModelScope.launch {
            runCatching { client?.abort(chat.id) }.onFailure { error -> updateChat(chat.id) { it.copy(error = error.message) } }
        }
    }

    private fun updateChat(id: String, change: (ChatState) -> ChatState) =
        _state.update { state -> state.copy(chat = state.chat?.let { if (it.id == id) change(it) else it }) }

    private class Attempt {
        var count = 0
        fun reset() { count = 0 }
    }

    /** Runs a stream again after it ends or fails, with the web's backoff: about half a second, doubling to 4 s. */
    private suspend fun reconnecting(body: suspend (Attempt) -> Unit) {
        val attempt = Attempt()
        while (true) {
            try {
                body(attempt)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
            }
            val ceiling = min(4000.0, 500.0 * (1 shl min(attempt.count, 4)))
            attempt.count++
            delay((ceiling / 2 + Random.nextDouble() * ceiling / 2).toLong())
        }
    }

    companion object {
        private const val GATEWAY_KEY = "gateway"
    }
}
