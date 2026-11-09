package dev.hui.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.TextView;

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
 */
public class MainActivity extends BridgeActivity {

    /** The gateway this bridge loads; `null` when it loads the bundled Connect page. */
    private String gateway;
    private TextView connecting;
    private boolean fellBack;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HuiGatewayPlugin.class);
        gateway = Gateway.resolve(this);
        if (gateway != null) config = EmbeddedConfig.withGateway(this, gateway);
        super.onCreate(savedInstanceState);
        if (gateway != null) attachGatewayLoad();
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

        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView webView, String url) {
                hideConnecting();
            }

            @Override
            public void onPageLoaded(WebView webView) {
                hideConnecting();
            }
        });
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) fallBack();
                else super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) fallBack();
                else super.onReceivedHttpError(view, request, errorResponse);
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
