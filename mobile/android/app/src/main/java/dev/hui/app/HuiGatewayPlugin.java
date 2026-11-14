package dev.hui.app;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * The one plugin the Connect page uses: {@code connect} remembers a gateway address and reloads the app on it, because a
 * live bridge's server URL cannot change; {@code forget} drops it and comes back to the Connect page ("Change gateway");
 * {@code getState} says what this launch remembers and which address, if any, just failed to answer; and
 * {@code requestLocalNetwork} asks for local-network access before the page probes a LAN gateway.
 */
@CapacitorPlugin(name = "HuiGateway", permissions = {
    @Permission(alias = "localNetwork", strings = { Manifest.permission.ACCESS_LOCAL_NETWORK })
})
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

    /**
     * Ask for local-network access before the Connect page probes a LAN gateway. Android 16 and lower grant it through
     * INTERNET without a prompt; Android 17 (targetSdk 37) blocks it until the operator allows it. The page reports a
     * refusal itself so the probe does not masquerade as a gateway that did not answer.
     */
    @PluginMethod
    public void requestLocalNetwork(PluginCall call) {
        if (Build.VERSION.SDK_INT < 37 || getPermissionState("localNetwork") == PermissionState.GRANTED) {
            resolveLocalNetwork(call);
            return;
        }
        requestPermissionForAlias("localNetwork", call, "localNetworkResult");
    }

    @PermissionCallback
    private void localNetworkResult(PluginCall call) {
        resolveLocalNetwork(call);
    }

    private void resolveLocalNetwork(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", Build.VERSION.SDK_INT < 37 || getPermissionState("localNetwork") == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }
}
