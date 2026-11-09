package dev.hui.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

/**
 * Spike S1: the runtime server URL. With a remembered gateway (or the `huiGatewayUrl` extra) the bridge is built with
 * that address as its server URL, so Capacitor's document-start script — the whole bridge, plugins included — is
 * registered for the gateway's origin. With none, Capacitor loads the bundled Connect page from https://localhost.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(HuiGatewayPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        String gateway = Gateway.resolve(this);
        if (gateway != null) {
            this.config = new CapConfig.Builder(this).setServerUrl(gateway).create();
        }
        super.load();
    }
}
