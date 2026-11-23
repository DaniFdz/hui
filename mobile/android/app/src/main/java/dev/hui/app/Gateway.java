package dev.hui.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * The gateway address the shell remembers, and what this launch knows about it. The `huiGatewayUrl` launch extra wins in
 * a debug build only (tests and `npm run mobile -- dev` are its users; a release build must not be redirected by another
 * app's intent), otherwise the address the Connect page saved. `huiGatewayFailed` marks an address that did not answer:
 * it forces the bundled Connect page instead of leaving an empty WebView behind, and names the address there. A `null`
 * from {@link #resolve} means "load the Connect page".
 */
final class Gateway {

    /** Launch extra: the gateway this launch loads, remembered for later launches. Honoured in debug builds only. */
    static final String EXTRA = "huiGatewayUrl";
    /** Launch extra: the address that did not answer; while it is set, the bridge loads the Connect page. */
    static final String FAILED_EXTRA = "huiGatewayFailed";

    private static final String PREFS = "hui";
    private static final String KEY = "gatewayUrl";

    private Gateway() {}

    /** The address the bridge should load, or `null` for the bundled Connect page. */
    static String resolve(Activity activity) {
        String failed = failed(activity);
        if (failed != null) return null;
        String extra = launchExtra(activity);
        if (extra != null) {
            remember(activity, extra);
            return extra;
        }
        return GatewayAddress.normalize(remembered(activity));
    }

    /** The normalised gateway an intent names in a debug build; `null` otherwise. */
    static String launchExtra(Activity activity) {
        if (!BuildConfig.DEBUG) return null;
        Intent intent = activity.getIntent();
        return intent == null ? null : GatewayAddress.normalize(intent.getStringExtra(EXTRA));
    }

    /**
     * The address that did not answer on this launch, when the app fell back to the Connect page. Only an address this
     * shell remembers counts, so another app's intent cannot put text on the page or force it open.
     */
    static String failed(Activity activity) {
        Intent intent = activity.getIntent();
        if (intent == null) return null;
        String failed = GatewayAddress.normalize(intent.getStringExtra(FAILED_EXTRA));
        String remembered = GatewayAddress.normalize(remembered(activity));
        return failed != null && failed.equals(remembered) ? failed : null;
    }

    /** Record that a gateway did not answer, so the restart shows the Connect page instead of an empty WebView. */
    static void markFailed(Activity activity, String url) {
        Intent intent = activity.getIntent();
        if (intent != null) intent.putExtra(FAILED_EXTRA, url);
    }

    /**
     * Drop what this launch carried, so the next resolve reads the remembered address. The deep link a launch opened
     * ({@link DeepLink}) goes with it: a gateway the user has just chosen starts on its own page, not on a path an
     * earlier launch happened to name.
     */
    static void clearLaunch(Activity activity) {
        Intent intent = activity.getIntent();
        if (intent == null) return;
        intent.removeExtra(EXTRA);
        intent.removeExtra(FAILED_EXTRA);
        intent.setData(null);
    }

    static String remembered(Context context) {
        return prefs(context).getString(KEY, null);
    }

    static void remember(Context context, String url) {
        prefs(context).edit().putString(KEY, url).apply();
    }

    static void forget(Context context) {
        prefs(context).edit().remove(KEY).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
