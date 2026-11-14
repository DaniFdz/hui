package dev.hui.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Android 17's local-network permission in one place: the launch path (a remembered gateway must not spend the
 * fallback's deadline on a load the platform refuses) and {@link HuiGatewayPlugin} (the Connect page's probe) both ask
 * through it. Android 16 and lower grant local-network access through INTERNET, so every answer there is "granted".
 */
final class LocalNetwork {

    /** The launch path's request id; the plugin uses Capacitor's own callback path. */
    static final int REQUEST = 0x4c4e;

    private LocalNetwork() {}

    /** Whether this platform has the runtime permission at all. */
    static boolean needed() {
        return Build.VERSION.SDK_INT >= 37;
    }

    /** Whether the app may reach a host on the local network now. */
    static boolean granted(Activity activity) {
        return !needed() || activity.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED;
    }

    /** Ask the operator, unless the platform has no such permission or the app already holds it. */
    static void request(Activity activity) {
        if (needed() && !granted(activity)) {
            activity.requestPermissions(new String[] { Manifest.permission.ACCESS_LOCAL_NETWORK }, REQUEST);
        }
    }
}
