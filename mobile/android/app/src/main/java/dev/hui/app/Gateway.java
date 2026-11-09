package dev.hui.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * The gateway address the shell remembers, and what this launch knows about it. The `huiGatewayUrl` launch extra wins
 * (tests and `npm run mobile -- dev`), otherwise the address the Connect page saved. `huiGatewayFailed` marks an address
 * that did not answer: it forces the bundled Connect page instead of leaving an empty WebView behind, and names the
 * address there. A `null` from {@link #resolve} means "load the Connect page".
 */
final class Gateway {

    /** Launch extra: the gateway this launch loads, remembered for later launches. */
    static final String EXTRA = "huiGatewayUrl";
    /** Launch extra: the address that did not answer; while it is set, the bridge loads the Connect page. */
    static final String FAILED_EXTRA = "huiGatewayFailed";

    private static final String PREFS = "hui";
    private static final String KEY = "gatewayUrl";

    private Gateway() {}

    /** The address the bridge should load, or `null` for the bundled Connect page. */
    static String resolve(Activity activity) {
        if (failed(activity) != null) return null;
        Intent intent = activity.getIntent();
        String extra = intent == null ? null : GatewayAddress.normalize(intent.getStringExtra(EXTRA));
        if (extra != null) {
            remember(activity, extra);
            return extra;
        }
        return remembered(activity);
    }

    /** The address that did not answer on this launch, when the app fell back to the Connect page. */
    static String failed(Activity activity) {
        Intent intent = activity.getIntent();
        return intent == null ? null : intent.getStringExtra(FAILED_EXTRA);
    }

    /** Record that a gateway did not answer, so the restart shows the Connect page instead of an empty WebView. */
    static void markFailed(Activity activity, String url) {
        Intent intent = activity.getIntent();
        if (intent != null) intent.putExtra(FAILED_EXTRA, url);
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

    /** Drop this launch's gateway extras, so the bridge the restart builds reads what was just saved. */
    static void clearLaunch(Activity activity) {
        Intent intent = activity.getIntent();
        if (intent == null) return;
        intent.removeExtra(EXTRA);
        intent.removeExtra(FAILED_EXTRA);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
