package dev.hui.app;

import android.util.Base64;

import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * The app's own script inside the gateway's page, `res/raw/hui_shell.js`: the two things a WebView cannot do itself,
 * saving the `blob:` downloads the page makes and keeping the name its anchors carry (see the script's header). It is
 * injected after each page load, so a reload gets it again and the page never depends on it existing earlier: nothing
 * the page does at load time uses it, only a click later.
 *
 * <p>The page answers the app through the {@link HuiShellPlugin}, and through `window.__huiShell` when the app needs
 * the bytes of a download the page started without a click (a `blob:` URL from {@link ShellDownloads}).
 */
final class ShellPage {

    private ShellPage() {}

    static void attach(Bridge bridge) {
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(android.webkit.WebView webView) {
                inject(bridge);
            }
        });
    }

    private static void inject(Bridge bridge) {
        // Where the shell pads the page's frame (ShellWindow), the shell owns the system insets and the page must not pay
        // for the same one again; the script zeroes its own `--safe-area-*` tokens when it is told that.
        String insets = ShellWindow.PADS_FRAME ? "window.__huiShellOwnInsets=true;" : "";
        bridge.eval(insets + read(bridge), null);
    }

    /**
     * Ask the page to save a download it made, when no anchor click did it (a `blob:` URL the WebView started itself).
     * The page fetches the bytes and answers through {@link HuiShellPlugin#saveDownload}.
     */
    static void save(Bridge bridge, String url, String name) {
        bridge.eval("window.__huiShell && window.__huiShell.save(" + jsString(url) + ", " + jsString(name) + ")", null);
    }

    /** A JS string literal, quoted and escaped for {@code eval}: the values here are URLs and file names. */
    static String jsString(String value) {
        if (value == null) return "null";
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int at = 0; at < value.length(); at++) {
            char character = value.charAt(at);
            if (character == '"' || character == '\\') out.append('\\').append(character);
            else if (character == '\n') out.append("\\n");
            else if (character == '\r') out.append("\\r");
            else if (character == '\t') out.append("\\t");
            else if (character < 0x20) out.append(String.format("\\u%04x", (int) character));
            else out.append(character);
        }
        return out.append('"').toString();
    }

    /** The bytes the page sent, decoded; `null` when they are not base64. */
    static byte[] bytes(String base64) {
        if (base64 == null) return null;
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private static String read(Bridge bridge) {
        try (InputStream stream = bridge.getContext().getResources().openRawResource(R.raw.hui_shell)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            com.getcapacitor.Logger.error("Could not read res/raw/hui_shell.js", ex);
            return "";
        }
    }
}
