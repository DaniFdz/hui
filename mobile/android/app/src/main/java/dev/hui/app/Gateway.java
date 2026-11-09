package dev.hui.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

/**
 * The gateway address the shell remembers: the `huiGatewayUrl` launch extra wins (tests and `npm run android -- dev`),
 * otherwise the address the Connect page saved. `null` means the app starts on the bundled Connect page.
 */
final class Gateway {

    static final String EXTRA = "huiGatewayUrl";
    private static final String PREFS = "hui";
    private static final String KEY = "gatewayUrl";

    private Gateway() {}

    static String resolve(Activity activity) {
        String extra = activity.getIntent().getStringExtra(EXTRA);
        if (extra != null && !extra.trim().isEmpty()) {
            remember(activity, extra.trim());
            return extra.trim();
        }
        return remembered(activity);
    }

    static String remembered(Context context) {
        return prefs(context).getString(KEY, null);
    }

    static void remember(Context context, String url) {
        prefs(context).edit().putString(KEY, url).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
