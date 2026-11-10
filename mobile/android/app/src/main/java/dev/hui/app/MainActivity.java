package dev.hui.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.TextView;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.WebViewListener;

/**
 * The app's only activity. It resolves the gateway this launch loads and builds the bridge with it as the server URL, so
 * Capacitor's document-start script — the whole bridge, plugins included — is registered for the gateway's origin; with
 * no gateway the bridge loads the bundled Connect page from `https://localhost`. While a gateway loads, a "Connecting
 * to HUI…" view covers the WebView, and a gateway that does not answer falls back to the Connect page instead of
 * leaving an empty WebView behind.
 *
 * <p>The shell's own behaviour hangs off the same WebView: the system back button ({@link ShellBack}), the window's
 * edges and the status bar's colours ({@link ShellWindow}), downloads ({@link ShellDownloads}), the app's script inside
 * the page ({@link ShellPage}) and the link policy that keeps the gateway's own links in the app ({@link ShellLinks}).
 * A {@code hui://open?path=…} link ({@link DeepLink}) opens one screen of that same page.
 */
public class MainActivity extends BridgeActivity {

    /** The gateway this bridge loads; `null` when it loads the bundled Connect page. */
    private String gateway;
    private TextView connecting;
    private boolean fellBack;

    /**
     * False while {@code onCreate} runs: {@link BridgeActivity#load()} calls {@link #onNewIntent} with the launch intent
     * from inside {@code super.onCreate}, before the shell is attached, and {@code onCreate} applies that intent itself.
     */
    private boolean ready;

    /** A launch that arrives while the app runs (singleTask) must honour a different gateway, not ignore it. */
    private static final long CONNECT_DEADLINE_MS = 15_000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HuiGatewayPlugin.class);
        registerPlugin(HuiShellPlugin.class);
        gateway = Gateway.resolve(this);
        if (gateway != null) config = EmbeddedConfig.withGateway(this, gateway);
        super.onCreate(savedInstanceState);
        // API 30 and later draw every app edge to edge and the shell pads the page's frame itself (ShellWindow); below
        // 30 the platform fits the window to the bars and resizes it for the keyboard, which is what kept the composer
        // visible before. Asking for edge to edge there would move the page under the bars with no padding to pay for it.
        if (ShellWindow.PADS_FRAME) EdgeToEdge.enable(this);
        // A bridge that could not be built (a broken WebView, see BridgeActivity) leaves nothing to attach the shell to.
        if (bridge != null) {
            ShellWindow.attach(this, bridge);
            ShellBack.attach(this, bridge);
            ShellDownloads.attach(this, bridge);
            if (gateway != null) {
                attachGatewayLoad();
                ShellPage.attach(bridge);
                openDeepLink();
            }
        }
        ready = true;
    }

    @Override
    public void onResume() {
        super.onResume();
        // A theme changed in the web UI while the app was in the background is only readable now.
        ShellWindow.read(this, bridge);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // The launch intent arrives here from inside super.onCreate, before any of this is attached; onCreate opens the
        // deep link that launch carried.
        if (!ready) return;
        // The gateway question is answered first and alone. A launch that names another gateway restarts the bridge on
        // it, and the restart applies that same intent again (onCreate opens its deep link), so the launch lands on the
        // path it named over the gateway it named: one load, never a deep link and a gateway changing under each other.
        String next = Gateway.resolve(this);
        if (next == null ? gateway != null : !next.equals(gateway)) {
            recreate();
            return;
        }
        openDeepLink();
    }

    /**
     * Open the screen a `hui://open?path=…` link names, over the gateway this launch loaded. Nothing happens when no
     * gateway is remembered (the Connect page has no screens of its own) and when the link names anything the gateway's
     * own address cannot simply be prefixed to; {@link DeepLink#path} is that decision.
     */
    private void openDeepLink() {
        if (gateway == null || bridge == null) return;
        WebView web = bridge.getWebView();
        if (web == null) return;
        String path = DeepLink.path(link());
        if (path == null) return;
        // The bridge queued the gateway's own root page by the time this runs; this load supersedes it before it can
        // paint, under the "Connecting to HUI…" cover.
        web.loadUrl(DeepLink.url(gateway, path));
    }

    private String link() {
        Intent intent = getIntent();
        return intent == null ? null : intent.getDataString();
    }

    /** Cover the loading WebView, and turn a main-frame failure into the Connect page. */
    private void attachGatewayLoad() {
        connecting = new TextView(this);
        connecting.setText(R.string.connecting);
        connecting.setGravity(android.view.Gravity.CENTER);
        connecting.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 18);
        connecting.setTextColor(getColor(R.color.connecting_text));
        connecting.setBackgroundColor(getColor(R.color.connecting_background));
        addContentView(connecting, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // A gateway that accepts the connection and never answers would otherwise cover the WebView until Chromium
        // gives up; bound it, so a stalled load lands on the Connect page like a refused one.
        connecting.postDelayed(() -> {
            if (connecting != null) fallBack();
        }, CONNECT_DEADLINE_MS);
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView webView, String url) {
                hideConnecting();
            }

            @Override
            public void onPageLoaded(WebView webView) {
                hideConnecting();
                ShellWindow.read(MainActivity.this, bridge);
            }
        });
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            /**
             * A main-frame failure is answered here: the Connect page replaces the gateway that did not answer. So the
             * failure is not passed on, because {@code super}'s path tells every WebView listener about an error on a
             * page this activity is about to discard, and loads Capacitor's own error page over the restart when the
             * config names one (`errorPath`, unset here). A frame that is not the main one keeps Capacitor's behaviour.
             */
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) fallBack();
                else super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                // Same rule as onReceivedError above: the shell answers a main-frame error, so it is not passed on.
                if (request.isForMainFrame()) fallBack();
                else super.onReceivedHttpError(view, request, errorResponse);
            }

            /**
             * The gateway's own pages stay in the app, including a link that only changes the scheme; every other origin
             * and every non-web scheme goes to the system, through Capacitor's one opening path so plugins that handle a
             * URL (an in-app browser, a share target) still see it first. A frame inside the page is left alone: it is
             * the page's own content, not a navigation the user asked for.
             */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String link = request.getUrl().toString();
                switch (ShellLinks.target(bridge.getAppUrl(), link)) {
                    case IN_APP:
                        return false;
                    case UPGRADE:
                        view.loadUrl(ShellLinks.upgraded(bridge.getAppUrl(), link));
                        return true;
                    default:
                        return bridge.launchIntent(request.getUrl());
                }
            }
        });
    }

    private void hideConnecting() {
        if (connecting == null) return;
        ViewGroup parent = (ViewGroup) connecting.getParent();
        if (parent != null) parent.removeView(connecting);
        connecting = null;
    }

    /**
     * The gateway did not answer: restart on the Connect page with the address named there. It stays remembered, so the
     * next launch retries it and the page offers "Change gateway" to replace it.
     */
    private void fallBack() {
        if (fellBack) return;
        fellBack = true;
        runOnUiThread(() -> {
            Gateway.markFailed(MainActivity.this, gateway);
            recreate();
        });
    }
}
