package dev.hui.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;

/**
 * What the app's script inside the gateway's page ({@code res/raw/hui_shell.js}, injected by {@link ShellPage}) can ask
 * the shell to do: save a download the page made itself ({@code saveDownload}, with the bytes), hand a plain download to
 * the system ({@code downloadUrl}, with the name the anchor carries), and report a download that could not be saved
 * ({@code report}). Each one answers the page and says the outcome in one toast, so a download never fails silently.
 */
@CapacitorPlugin(name = "HuiShell")
public class HuiShellPlugin extends Plugin {

    @PluginMethod
    public void saveDownload(PluginCall call) {
        String data = call.getString("data");
        // The page stops at the same size before it reads the file (res/raw/hui_shell.js), so this bound only answers a
        // page that ignored it: the payload arrives as one base64 string, and decoding an unbounded one would cost the
        // app a copy of it before anything could refuse it.
        if (data != null && data.length() > ShellDownloads.MAX_BASE64) {
            ShellDownloads.say(getContext(), getContext().getString(R.string.download_too_large, ShellDownloads.MAX_MIB));
            call.reject("The download is larger than " + ShellDownloads.MAX_MIB + " MiB.");
            return;
        }
        String name = ShellDownloads.sanitize(call.getString("name"));
        String type = call.getString("type", "application/octet-stream");
        byte[] bytes = ShellPage.bytes(data);
        if (bytes == null) {
            call.reject("data must be base64.");
            return;
        }
        String saved;
        try {
            saved = ShellDownloads.saveBytes(getContext(), name, type, bytes);
        } catch (IOException | RuntimeException ex) {
            Logger.error("Could not save a download", ex);
            ShellDownloads.say(getContext(), getContext().getString(R.string.download_failed));
            call.reject("The download could not be saved.");
            return;
        }
        JSObject result = new JSObject();
        // The name the app actually wrote, not the one the page asked for, so the page can name the saved file.
        result.put("name", name);
        result.put("location", saved);
        call.resolve(result);
        ShellDownloads.say(getContext(), getContext().getString(R.string.download_saved, name, saved));
    }

    @PluginMethod
    public void downloadUrl(PluginCall call) {
        String url = call.getString("url");
        String name = ShellDownloads.sanitize(call.getString("name"));
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("url must be an http:// or https:// URL.");
            return;
        }
        // No WebView call here: plugin methods run off the main thread, and the system download manager sends its own
        // user agent anyway. The headers the gateway needs are added by ShellDownloads, for the gateway's own URLs only.
        ShellDownloads.download(getContext(), url, null, name, call.getString("type"), getBridge().getAppUrl());
        JSObject result = new JSObject();
        result.put("name", name);
        call.resolve(result);
    }

    /** A download the page could not even read: the app is the one that can say so. */
    @PluginMethod
    public void report(PluginCall call) {
        ShellDownloads.say(getContext(), call.getString("message", getContext().getString(R.string.download_failed)));
        call.resolve();
    }
}
