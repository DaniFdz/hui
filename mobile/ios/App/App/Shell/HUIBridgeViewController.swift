import Capacitor
import UIKit

/**
 The bridge on the gateway the app should load. Capacitor computes its server URL once, in `instanceDescriptor()` before
 the WebView exists, so the address is resolved there: the launch argument, else the remembered gateway, else the bundled
 Connect page (`https://localhost`). Capacitor's document-start script is registered for that origin, so the plugins work
 on the gateway's page. A gateway that does not answer falls back to Connect through `HUIGatewayFailed`.
 */
final class HUIBridgeViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let gateway = Gateway.resolve() {
            descriptor.serverURL = gateway
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        guard let gateway = Gateway.resolve() else { return }
        let bridge = self.bridge
        // A gateway that never answers would leave "Connect to HUI" as an empty white screen; bound it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, let webView = bridge?.webView else { return }
            // The Connect page has its own body marker; anything still blank means the gateway did not answer.
            webView.evaluateJavaScript("document.body && document.body.childElementCount > 0") { result, _ in
                if (result as? Bool) == true { return }
                Gateway.markFailed(gateway)
                self.reloadOnConnect()
            }
        }
    }

    /// Rebuild the bridge, which is the only way to change its server URL.
    private func reloadOnConnect() {
        guard let window = view.window, let scene = window.windowScene else { return }
        let fresh = HUIBridgeViewController()
        window.rootViewController = fresh
        window.makeKeyAndVisible()
        _ = scene // the scene keeps the window
    }
}
