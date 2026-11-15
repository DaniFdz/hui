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
 * A {@code hui://open?path=…} link ({@link DeepLink}) opens one screen of that same page, and a share another app sends
 * ({@link ShareTarget}) opens New Session with what was shared.
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

    /**
     * This activity was created by the launch it applies, rather than handed one while it ran (singleTask goes to
     * {@link #onNewIntent}). An image-only share — the one share HUI answers by leaving — closes the activity only when
     * the share is what started it.
     */
    private boolean launchedForShare;

    /** A launch that arrives while the app runs (singleTask) must honour a different gateway, not ignore it. */
    private static final long CONNECT_DEADLINE_MS = 15_000;

    /** This launch was held on Connect to ask for Android 17's local-network permission before loading its gateway. */
    private boolean waitingForLocalNetwork;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HuiGatewayPlugin.class);
        registerPlugin(HuiShellPlugin.class);
        launchedForShare = isShare(getIntent());
        gateway = Gateway.resolve(this);
        // Android 17 blocks the local network until this app holds ACCESS_LOCAL_NETWORK. An install upgrading with a
        // remembered gateway would otherwise spend the fallback's 15 s on a load the platform refuses: load Connect,
        // ask, and rebuild on the gateway once the operator allows it.
        if (gateway != null && !LocalNetwork.granted(this)) {
            waitingForLocalNetwork = true;
            gateway = null;
        }
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
            }
        }
        // What this launch carried — a `hui://open` path or a share — opens over the gateway it loaded, if any.
        openLaunch();
        ready = true;
        if (waitingForLocalNetwork) getWindow().getDecorView().post(() -> LocalNetwork.request(this));
    }

    /** The launch path's local-network answer: a grant rebuilds on the remembered gateway; a refusal leaves Connect. */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LocalNetwork.REQUEST) return;
        if (LocalNetwork.granted(this)) {
            recreate();
            return;
        }
        // The restart the share was kept for never comes: drop it, so a gateway the operator picks on Connect does not
        // open New Session with a share of some earlier launch.
        consumeShare(getIntent());
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
        // The launch intent arrives here from inside super.onCreate, before any of this is attached; onCreate opens what
        // that launch carried.
        if (!ready) return;
        // The gateway question is answered first and alone. A launch that names another gateway restarts the bridge on
        // it, and the restart applies that same intent again (onCreate opens what it carried), so the launch lands on
        // the path it named over the gateway it named: one load, never a deep link or a share and a gateway changing
        // under each other.
        String next = Gateway.resolve(this);
        if (next == null ? gateway != null : !next.equals(gateway)) {
            recreate();
            return;
        }
        openLaunch();
    }

    /** What this launch carried: the screen a `hui://open` link names, then the share another app sent. */
    private void openLaunch() {
        openDeepLink();
        openShare();
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

    /** Whether this intent is another app's Share sheet rather than a launch of the app's own. */
    private static boolean isShare(Intent intent) {
        return intent != null && Intent.ACTION_SEND.equals(intent.getAction());
    }

    /**
     * Open New Session with what another app shared: `<gateway>/new-session?share=…`, the address the page's own intake
     * fills the composer from ({@link ShareTarget}).
     *
     * <p>The share is taken out of the launch intent before anything loads. Every restart this activity asks for — a
     * gateway that did not answer ({@link #fallBack}), a bridge rebuilt on another gateway — applies that same intent
     * again, and a share left in it would open New Session a second time. The one launch that keeps it is the
     * local-network question: the activity Android 17 restarts when the operator allows the network is the one that can
     * open it.
     *
     * <p>A share HUI cannot take is dropped with a toast instead of being applied later: an image on its own (the
     * composer has no place for one yet, and the sheet is where it came from), a share with nothing the composer can
     * hold, a value whose address would be past {@link ShareTarget#MAX_URL_BYTES}, and a launch with no gateway to open
     * anything on. An image-only share also finishes the activity when the share is what started it, so the operator
     * lands back in the app they shared from rather than in an empty HUI.
     */
    private void openShare() {
        Intent intent = getIntent();
        if (!isShare(intent)) return;
        // Android 17's local-network question restarts this activity, and that restart is where a share opens.
        if (waitingForLocalNetwork) return;
        CharSequence shared;
        try {
            shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } catch (RuntimeException wrongType) {
            // Another app can put anything under that key: a value that is not text is a share with no text.
            shared = null;
        }
        ShareTarget.Share share = ShareTarget.parse(
            intent.getType(),
            shared,
            intent.getDataString(),
            intent.hasExtra(Intent.EXTRA_STREAM)
        );
        consumeShare(intent);
        if (share.text == null) {
            say(share.image ? R.string.share_image : R.string.share_nothing);
            if (share.image && launchedForShare) finish();
            return;
        }
        if (gateway == null) {
            say(R.string.share_no_gateway);
            return;
        }
        WebView web = bridge == null ? null : bridge.getWebView();
        if (web == null) return;
        String address = ShareTarget.url(gateway, share.text);
        if (address == null) {
            say(R.string.share_too_long);
            return;
        }
        // The bridge queued the gateway's own root page by the time this runs, exactly as the deep link does; this
        // load supersedes it under the "Connecting to HUI…" cover.
        web.loadUrl(address);
    }

    /**
     * Drop the share from the launch intent, mirroring {@link Gateway#clearLaunch}: the action, the extras a share
     * carries and its clip data are what make the intent a share, and none of them may reach the next activity this
     * launch builds.
     */
    private static void consumeShare(Intent intent) {
        if (!isShare(intent)) return;
        intent.setAction(null);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.removeExtra(Intent.EXTRA_TITLE);
        intent.setClipData(null);
    }

    /** Say what became of a share, the one way the shell talks to the operator outside the page. */
    private void say(int message) {
        ShellDownloads.say(this, getString(message));
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
