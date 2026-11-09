package dev.hui.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;

import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The config the bridge runs on: the `capacitor.config.json` that `cap sync` copies into the app's assets, amended with
 * this launch's gateway as `server.url`. Building a config from scratch (`new CapConfig.Builder(context)`) starts from
 * Capacitor's defaults and silently drops the generated file's `allowNavigation`, `loggingBehavior`, `errorPath` and
 * plugin settings, so the file is loaded and amended instead.
 *
 * <p>The one thing the file cannot say is the build type: Capacitor derives WebView debugging, and the default logging
 * behaviour, from the running app's debuggable flag, and the asset constructor has no context to ask. Those two values
 * are therefore filled in here from that flag.
 */
final class EmbeddedConfig {

    private static final String ASSET = "capacitor.config.json";

    private EmbeddedConfig() {}

    /**
     * The generated config with {@code gateway} as the server URL. Falls back to a builder-made config when the asset is
     * missing or malformed: a broken generated file must not keep the app from starting.
     */
    @SuppressWarnings("deprecation")
    static CapConfig withGateway(Context context, String gateway) {
        AssetManager assets = context.getAssets();
        try {
            JSONObject json = new JSONObject(read(assets));
            JSONObject server = object(json, "server");
            server.put("url", gateway);
            JSONObject android = object(json, "android");
            if (!android.has("webContentsDebuggingEnabled")) android.put("webContentsDebuggingEnabled", isDebuggable(context));
            // The deprecated constructor is the only path from an asset JSON to a CapConfig; loadDefault(Context) reads
            // the file but offers no way to set server.url afterwards.
            return new CapConfig(assets, json);
        } catch (IOException | JSONException ex) {
            Logger.warn("Could not read assets/" + ASSET + "; building the config without it: " + ex);
            return new CapConfig.Builder(context).setServerUrl(gateway).create();
        }
    }

    private static String read(AssetManager assets) throws IOException {
        try (InputStream stream = assets.open(ASSET)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** One object of the config, created when the file has no such section. */
    private static JSONObject object(JSONObject json, String key) throws JSONException {
        JSONObject found = json.optJSONObject(key);
        if (found != null) return found;
        JSONObject created = new JSONObject();
        json.put(key, created);
        return created;
    }

    private static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
}
