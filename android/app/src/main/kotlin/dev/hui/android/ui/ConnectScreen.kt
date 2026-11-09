/** Connect to HUI: the gateway's address, the check that it is a HUI gateway, and the refusal when it isn't. */
package dev.hui.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.hui.android.ConnectState

@Composable
fun ConnectScreen(state: ConnectState, onAddress: (String) -> Unit, onConnect: () -> Unit, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.safeDrawingPadding().imePadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Connect to HUI", style = MaterialTheme.typography.headlineMedium)
            Text(
                "HUI runs on your computer. Enter the address of its gateway, for example its Tailscale name.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = state.address,
                onValueChange = onAddress,
                label = { Text("Gateway URL") },
                singleLine = true,
                enabled = !state.checking,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { onConnect() }),
                modifier = Modifier.fillMaxWidth().testTag("gateway-url"),
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Button(onClick = onConnect, enabled = !state.checking, modifier = Modifier.fillMaxWidth()) {
                if (state.checking) CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp) else Text("Connect")
            }
        }
    }
}
