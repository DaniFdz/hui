package dev.hui.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Spike S1: the one native call the bundled Connect page needs. It remembers the gateway address and restarts the
 * activity, which rebuilds the Capacitor bridge with that address as its server URL.
 */
@CapacitorPlugin(name = "HuiGateway")
public class HuiGatewayPlugin extends Plugin {

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        Gateway.remember(getContext(), url.trim());
        JSObject result = new JSObject();
        result.put("url", url.trim());
        call.resolve(result);
        // Resolve reaches the Connect page first; the restart then builds a bridge whose app URL is the gateway.
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void getGateway(PluginCall call) {
        JSObject result = new JSObject();
        result.put("url", Gateway.remembered(getContext()));
        call.resolve(result);
    }
}
