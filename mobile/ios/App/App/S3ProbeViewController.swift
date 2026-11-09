/**
 * Spike S3 only (docs/mobile-app-plan.md): measures the runtime-URL seam of a Capacitor iOS shell. WP5 replaces this
 * with the real shell. It subclasses CAPBridgeViewController and overrides instanceDescriptor(), the documented
 * override point: CAPBridgeViewController.loadView() calls it, builds InstanceConfiguration from it, and loads
 * configuration.serverURL. The gateway address comes from `-HUIGatewayURL <url>` in ProcessInfo, which UserDefaults
 * also reads as a key/value pair, so the same launch argument works for a test and for the app.
 */
import Capacitor

class S3ProbeViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        let arguments = ProcessInfo.processInfo.arguments
        let fromDefaults = UserDefaults.standard.string(forKey: "HUIGatewayURL")
        var lines = [
            "arguments=\(arguments)",
            "userDefaults.HUIGatewayURL=\(fromDefaults ?? "<none>")",
            "descriptor.serverURL before=\(descriptor.serverURL ?? "<nil>")",
        ]
        if let gateway = fromDefaults, !gateway.isEmpty {
            descriptor.serverURL = gateway
            descriptor.allowedNavigationHostnames = ["*"]
        }
        lines.append("descriptor.serverURL after=\(descriptor.serverURL ?? "<nil>")")
        lines.append("descriptor.allowedNavigationHostnames=\(descriptor.allowedNavigationHostnames)")
        // simctl's --console did not deliver the app's stdout on this runner, so the evidence is a file in the app's
        // container that the workflow reads with `xcrun simctl get_app_container`.
        record(lines.joined(separator: "\n"))
        return descriptor
    }

    private func record(_ text: String) {
        print("HUIPROBE \(text)")
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        try? "\(text)\n".write(to: caches.appendingPathComponent("s3-probe.txt"), atomically: true, encoding: .utf8)
    }
}
