package dev.hui.app;

import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;

/**
 * The system back button, in the order a phone app is expected to answer it: the page's own overlay (a dialog, the
 * drawer, a pane) first, then back through the web UI's history, then out of the app on a second press.
 *
 * <p>The page gets the first say through one event: {@code document.dispatchEvent(new CustomEvent("hui:back",
 * { cancelable: true }))}, and it keeps the press by calling {@code preventDefault()}. `src/lib/native-shell.ts`'s
 * {@code onBack(callback)} is that listener (WP3); a page without one — the Connect page — simply lets the press
 * through. The dispatch and the answer travel in one `evaluateJavascript` call, so the shell always knows before it acts
 * whether the page took the press.
 *
 * <p>The two halves divide the work, and neither may take the other's: the page only says "I closed something", and
 * this class does everything else. So a page must not keep the press without closing something — that would make back a
 * no-op, which on a phone reads as a broken button — and the page never walks the history or leaves the app itself.
 * Capacitor's App plugin has its own callback that walks the history; `capacitor.config.ts` switches it off
 * ({@code plugins.App.disableBackButtonHandler}) so this is the only answer to a press.
 *
 * <p>The app only leaves on the second press within {@link #LEAVE_WINDOW_MS}, with a toast saying so in between: a back
 * press that silently closed HUI was the one thing an installed app must not do.
 */
final class ShellBack {

    /** How long the second press has to follow the first for the app to leave. */
    private static final long LEAVE_WINDOW_MS = 2000;

    /**
     * Dispatches the press to the page and answers `handled` when the page kept it. `document.dispatchEvent` returns
     * false for a cancelled event, which is the same answer as `defaultPrevented`, and the value survives
     * `evaluateJavascript` as the string `"handled"`.
     */
    private static final String ASK_PAGE = "(function(){try{"
        + "var press=new CustomEvent('hui:back',{cancelable:true});"
        + "document.dispatchEvent(press);"
        + "return press.defaultPrevented?'handled':'pass';"
        + "}catch(error){return 'pass';}})()";

    private final MainActivity activity;
    private final Bridge bridge;
    /** When the first press of a pair happened, in {@link SystemClock#elapsedRealtime()}; 0 when none is armed. */
    private long armedAt;

    private ShellBack(MainActivity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;
    }

    /** Take the back press from the App plugin's own callback, which `capacitor.config.ts` switches off. */
    static void attach(MainActivity activity, Bridge bridge) {
        ShellBack back = new ShellBack(activity, bridge);
        activity.getOnBackPressedDispatcher().addCallback(
            activity,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    back.press();
                }
            }
        );
    }

    private void press() {
        if (activity.isFinishing()) return;
        bridge.eval(ASK_PAGE, this::answer);
    }

    private void answer(String page) {
        if (activity.isFinishing()) return;
        if (page != null && page.contains("handled")) {
            armedAt = 0;
            return;
        }
        WebView web = bridge.getWebView();
        if (web != null && web.canGoBack()) {
            armedAt = 0;
            web.goBack();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (armedAt != 0 && now - armedAt <= LEAVE_WINDOW_MS) {
            armedAt = 0;
            activity.finish();
            return;
        }
        armedAt = now;
        Toast.makeText(activity, R.string.press_back_again, Toast.LENGTH_SHORT).show();
    }
}
