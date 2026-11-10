import Capacitor
import Foundation

/**
 The Connect page's native half, with the same name, method names and semantics as the Android shell's
 `HuiGatewayPlugin.java`: `connect` remembers an address and rebuilds the bridge on it (a live bridge's server URL cannot
 change), `forget` drops it and comes back to Connect ("Change gateway"), and `getState` says what this launch knows.
 */
@objc(HuiGatewayPlugin)
public class HuiGatewayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HuiGatewayPlugin"
    public let jsName = "HuiGateway"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    ]

    @objc func connect(_ call: CAPPluginCall) {
        guard let url = GatewayAddress.normalize(call.getString("url")) else {
            call.reject("The gateway address must be an http:// or https:// URL.")
            return
        }
        Gateway.remember(url)
        call.resolve(["url": url])
        // The answer reaches the page first; the rebuild then loads the gateway's origin.
        DispatchQueue.main.async { [weak self] in self?.reloadBridge() }
    }

    @objc func forget(_ call: CAPPluginCall) {
        Gateway.forget()
        call.resolve(["gateway": NSNull()])
        DispatchQueue.main.async { [weak self] in self?.reloadBridge() }
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve([
            "gateway": Gateway.remembered() ?? NSNull(),
            "failed": Gateway.failed() ?? NSNull(),
        ])
    }

    /// A bridge's app URL is fixed, so the root view controller is replaced by a fresh bridge.
    private func reloadBridge() {
        guard let controller = bridge?.viewController as? HUIBridgeViewController else {
            CAPLog.print("HuiGateway: no bridge controller to rebuild on")
            return
        }
        controller.reloadBridge()
    }
}
