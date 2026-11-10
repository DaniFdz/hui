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
        String name = call.getString("name");
        String type = call.getString("type", "application/octet-stream");
        byte[] bytes = ShellPage.bytes(call.getString("data"));
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
        result.put("name", name);
        result.put("location", saved);
        call.resolve(result);
        ShellDownloads.say(getContext(), getContext().getString(R.string.download_saved, ShellDownloads.sanitize(name), saved));
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
        // user agent anyway. The cookie the gateway needs is added by ShellDownloads.
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
