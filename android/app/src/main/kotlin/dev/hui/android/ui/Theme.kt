/**
 * HUI's default theme (`themes/hui.json`) as Material 3 colour schemes, light and dark following the phone. Later the
 * app reads the operator's theme from the gateway (docs/native-android-plan.md, 2.7).
 */
package dev.hui.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    background = Color(0xFFFAF9F7), onBackground = Color(0xFF151B21),
    surface = Color(0xFFFAF9F7), onSurface = Color(0xFF151B21),
    surfaceContainer = Color(0xFFF1EFEB), surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEDF1F4), onSurfaceVariant = Color(0xFF5B6770),
    outline = Color(0xFFE2DED8), outlineVariant = Color(0xFFE2DED8),
    primary = Color(0xFF0B6BCB), onPrimary = Color.White,
    secondaryContainer = Color(0xFFE3EEF9), onSecondaryContainer = Color(0xFF151B21),
    error = Color(0xFFCF222E), onError = Color.White,
)

private val Dark = darkColorScheme(
    background = Color(0xFF0E1015), onBackground = Color(0xFFEEF4F8),
    surface = Color(0xFF0E1015), onSurface = Color(0xFFEEF4F8),
    surfaceContainer = Color(0xFF151B21), surfaceContainerHigh = Color(0xFF1A222B),
    surfaceVariant = Color(0xFF1A222B), onSurfaceVariant = Color(0xFF9FB0BD),
    outline = Color(0xFF232A33), outlineVariant = Color(0xFF232A33),
    primary = Color(0xFF4EA8DE), onPrimary = Color(0xFF090B0E),
    secondaryContainer = Color(0xFF1C2B38), onSecondaryContainer = Color(0xFFEEF4F8),
    error = Color(0xFFF87171), onError = Color(0xFF090B0E),
)

@Composable
fun HuiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
