import Capacitor
import UIKit

/**
 The bridge on the gateway the app should load. Capacitor computes its server URL once, in `instanceDescriptor()` before
 the WebView exists, so the address is resolved there: the launch argument, else the remembered gateway, else the bundled
 Connect page. A gateway that never commits its page falls back to Connect instead of leaving a blank screen behind.
 Capacitor's bridge scripts are attached to the shared content controller; what keeps the app on the gateway is
 `WebViewDelegationHandler`'s navigation policy, which prefixes every top-level URL with the server URL.
 */
final class HUIBridgeViewController: CAPBridgeViewController {
    private var gateway: String?
    private var fallback: DispatchWorkItem?

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        gateway = Gateway.resolve()
        if let gateway { descriptor.serverURL = gateway }
        return descriptor
    }

    override func capacitorDidLoad() {
        // Capacitor does not discover plugins by class name: a plugin the app ships must be registered here, before the
        // WebView loads, or every call rejects with "<name> plugin is not implemented on ios".
        bridge?.registerPluginInstance(HuiGatewayPlugin())
        guard let gateway else { return }
        armFallback(gateway, attemptsLeft: 20)
    }

    /// Poll for a committed page whose address is the gateway. Android uses `onPageCommitVisible`; the WebView exposes the
    /// committed URL here, and the prefix rule matches the shell's navigation policy.
    private func armFallback(_ gateway: String, attemptsLeft: Int) {
        fallback?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if let committed = self.webView?.url?.absoluteString, committed.hasPrefix(gateway) { return }
            if attemptsLeft > 0 {
                self.armFallback(gateway, attemptsLeft: attemptsLeft - 1)
                return
            }
            // A gateway that accepted the connection and never answered: come back on Connect, naming it.
            Gateway.markFailed(gateway)
            self.reloadBridge()
        }
        fallback = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }

    /// Load a deep-linked path on this bridge's gateway.
    func open(_ url: URL) {
        guard let webView else { return }
        webView.load(URLRequest(url: url))
    }

    deinit {
        fallback?.cancel()
    }

    /// A bridge's server URL is fixed, so the only way to change it is a fresh bridge.
    func reloadBridge() {
        guard let window = view.window ?? UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.windows.first(where: \.isKeyWindow) }).first else { return }
        window.rootViewController = HUIBridgeViewController()
        window.makeKeyAndVisible()
    }
}
