package dev.hui.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * The one plugin the Connect page uses: {@code connect} remembers a gateway address and reloads the app on it, because a
 * live bridge's server URL cannot change; {@code forget} drops it and comes back to the Connect page ("Change gateway");
 * {@code getState} says what this launch remembers and which address, if any, just failed to answer.
 */
@CapacitorPlugin(name = "HuiGateway")
public class HuiGatewayPlugin extends Plugin {

    @PluginMethod
    public void connect(PluginCall call) {
        String url = GatewayAddress.normalize(call.getString("url"));
        if (url == null) {
            call.reject("The gateway address must be an http:// or https:// URL.");
            return;
        }
        Gateway.remember(getContext(), url);
        Gateway.clearLaunch(getActivity());
        JSObject result = new JSObject();
        result.put("url", url);
        call.resolve(result);
        // The answer reaches the page first; the restart then builds a bridge whose app URL is the gateway.
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void forget(PluginCall call) {
        Gateway.forget(getContext());
        Gateway.clearLaunch(getActivity());
        JSObject result = new JSObject();
        result.put("gateway", JSONObject.NULL);
        call.resolve(result);
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        String gateway = Gateway.remembered(getContext());
        String failed = Gateway.failed(getActivity());
        JSObject result = new JSObject();
        result.put("gateway", gateway == null ? JSONObject.NULL : gateway);
        result.put("failed", failed == null ? JSONObject.NULL : failed);
        call.resolve(result);
    }
}
