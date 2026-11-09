/**
 * The app's one activity: draws edge to edge, hands the `huiGatewayUrl` launch extra (how the e2e fixture and
 * `npm run android -- dev` point the app at a gateway) to the view model, and shows the current screen.
 */
package dev.hui.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.hui.android.ui.ChatScreen
import dev.hui.android.ui.ConnectScreen
import dev.hui.android.ui.HuiTheme
import dev.hui.android.ui.SessionsScreen

class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model.start(intent.getStringExtra("huiGatewayUrl"))
        setContent {
            HuiTheme {
                val state by model.state.collectAsStateWithLifecycle()
                // Test tags double as resource ids, so the e2e engine finds them with getByTestId.
                val root = Modifier.semantics { testTagsAsResourceId = true }
                when (val screen = state.screen) {
                    Screen.Connect -> ConnectScreen(state.connect, model::editAddress, model::connect, root)
                    Screen.Sessions -> SessionsScreen(state, model::openChat, model::disconnect, root)
                    is Screen.Chat -> {
                        BackHandler { model.closeChat() }
                        state.chat?.let { ChatScreen(it, model::closeChat, model::editDraft, model::send, model::stop, root) }
                    }
                }
            }
        }
    }
}
