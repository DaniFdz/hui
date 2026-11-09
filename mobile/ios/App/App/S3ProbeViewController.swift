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
        print("HUIPROBE arguments=\(arguments)")
        print("HUIPROBE userDefaults.HUIGatewayURL=\(fromDefaults ?? "<none>")")
        print("HUIPROBE descriptor.serverURL before=\(descriptor.serverURL ?? "<nil>")")
        if let gateway = fromDefaults, !gateway.isEmpty {
            descriptor.serverURL = gateway
            descriptor.allowedNavigationHostnames = ["*"]
        }
        print("HUIPROBE descriptor.serverURL after=\(descriptor.serverURL ?? "<nil>")")
        return descriptor
    }
}
