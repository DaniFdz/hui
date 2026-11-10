package dev.hui.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The window's edges. Android 15 and later draw every app edge to edge, so the page would otherwise sit under the status
 * bar and the navigation bar, and the soft keyboard would cover the composer instead of pushing the page up. From
 * Android 11 (API 30, {@link #PADS_FRAME}) the WebView's frame is padded with the system bar, cutout and keyboard insets
 * instead, which is what keeps the whole page — the composer included — visible. Below 30 the platform still fits the
 * window to the bars and `adjustResize` shrinks it for the keyboard, so nothing is padded here and the composer is above
 * the keyboard exactly as it was before this shell existed.
 *
 * <p>The shell is the one owner of those insets where it pads. The page also reads them (`env(safe-area-inset-*)` into
 * its `--safe-area-*` tokens, `src/styles/openclaw-reference/base.css`), so a device with a cutout would pay for the
 * same inset twice; {@code res/raw/hui_shell.js} zeroes those tokens when this class pads the frame. An emulator without
 * a cutout reports zero there, so that half is reasoned, not measured (mobile/AGENTS.md says so).
 *
 * <p>The status bar takes the page's own colour and icon scheme: the page reports its resolved `color-scheme` and its
 * `--bg` background, and the strip the padding reveals behind the page is painted with that colour, so it reads as part
 * of HUI rather than as the system's bar. Below API 30 the system's own bar is that strip, and it gets the same colour.
 * It is read again on resume, so a theme changed in the UI and then backgrounded is right when the app comes back;
 * `@capacitor/status-bar` (`setStatusBar` in `src/lib/native-shell.ts`, WP3) can set it live for a change on screen.
 */
final class ShellWindow {

    /**
     * Whether this shell pads the page's frame with the system insets itself, which is what API 30 and later need once
     * the window draws edge to edge. Below that the platform fits the window to the bars and `adjustResize` handles the
     * keyboard, so the shell keeps its hands off the insets there.
     */
    static final boolean PADS_FRAME = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;

    /**
     * What the page reports: the scheme it resolved (`light`/`dark`) and its own background. The probe element resolves
     * a token that may be an expression, exactly as the boot screen does.
     */
    private static final String THEME = "(function(){try{"
        + "var root=document.documentElement;"
        + "var scheme=root.style.colorScheme;"
        + "if(scheme!=='light'&&scheme!=='dark')scheme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';"
        + "var probe=document.createElement('span');probe.hidden=true;probe.style.color='var(--bg)';root.appendChild(probe);"
        + "var background=getComputedStyle(probe).color;probe.remove();"
        + "if(!background||background==='rgba(0, 0, 0, 0)')background=getComputedStyle(document.body).backgroundColor;"
        + "return {scheme:scheme,background:background};"
        + "}catch(error){return {scheme:'',background:''};}})()";

    private ShellWindow() {}

    static void attach(MainActivity activity, Bridge bridge) {
        if (PADS_FRAME) padFrame(activity, bridge);
        // Until the page reports its own theme, the system's says which way to paint.
        apply(activity, bridge, night(activity), null);
        read(activity, bridge);
    }

    /**
     * Take the window's insets off the platform and pay for them on the WebView's frame. Only API 30 and later:
     * {@code MainActivity} asks for edge to edge there, and a page under the bars with nothing padding it would hide the
     * composer.
     */
    private static void padFrame(MainActivity activity, Bridge bridge) {
        Window window = activity.getWindow();
        // Android 15 and later draw every app edge to edge; this asks older releases for the same (and is idempotent
        // where the platform already does it), so the padding below is the one thing that decides where the page ends.
        // Asserted here as well as by the activity's EdgeToEdge.enable, because the padding depends on it.
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        View web = bridge.getWebView();
        View frame = web.getParent() instanceof View ? (View) web.getParent() : web;
        // The window pads itself with the system bars and hands the insets down already consumed, which would leave the
        // page inset by the platform and the shell unable to paint the strip in the page's own colour. The decor stops
        // padding here and lets the insets through. The frames below only stop fitting the system windows: their own
        // listeners (the Keyboard plugin's, which reports the soft keyboard) stay in place.
        View decor = window.getDecorView();
        ViewCompat.setFitsSystemWindows(decor, false);
        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, insets) -> {
            view.setPadding(0, 0, 0, 0);
            return insets;
        });
        for (View view = frame; view != decor && view != null; view = view.getParent() instanceof View ? (View) view.getParent() : null) {
            ViewCompat.setFitsSystemWindows(view, false);
        }
        // Padding on the frame, not on the WebView: the WebView's own padding is clipped, it does not make the page's
        // viewport smaller, and a page that does not pad itself (no cutout means `env(safe-area-inset-*)` is 0) would
        // draw under the bars. Inside the frame's padding the WebView is the visible size, and the strip behind it is
        // painted in the page's own colour.
        ViewCompat.setOnApplyWindowInsetsListener(frame, (view, insets) -> {
            pad(view, insets);
            return insets;
        });
        ViewCompat.requestApplyInsets(frame);
    }

    private static boolean night(MainActivity activity) {
        int mode = activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The page's own theme, asked whenever the app comes back and every time the page finishes loading. */
    static void read(MainActivity activity, Bridge bridge) {
        if (bridge == null) return;
        bridge.eval(THEME, answer -> {
            if (activity.isFinishing() || answer == null) return;
            try {
                JSONObject theme = new JSONObject(answer);
                apply(activity, bridge, !"light".equals(theme.optString("scheme")), ShellColor.parse(theme.optString("background")));
            } catch (JSONException ex) {
                // An answer that is not the page's theme leaves the system's own colours in place.
            }
        });
    }

    /** Status bar and navigation bar icons that read against `color`, and the strip behind the padded page. */
    private static void apply(MainActivity activity, Bridge bridge, boolean dark, Integer color) {
        Window window = activity.getWindow();
        int painted = color != null ? color : activity.getColor(dark ? R.color.page_background_dark : R.color.page_background_light);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        // Where the shell pads, the bars are transparent and what shows through is the WebView's own background in the
        // strip its padding leaves, plus the view behind it anywhere the WebView does not reach. Below API 30 the system
        // draws the bars itself, and these window colours are what paint them.
        window.setStatusBarColor(painted);
        window.setNavigationBarColor(painted);
        if (bridge == null) return;
        View web = bridge.getWebView();
        if (web == null) return;
        web.setBackgroundColor(painted);
        if (web.getParent() instanceof View) ((View) web.getParent()).setBackgroundColor(painted);
    }

    /** Keep the page out from under the bars and above the keyboard. */
    private static void pad(View frame, WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
        frame.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
    }
}
