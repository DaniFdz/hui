import Foundation

/**
 What the shell remembers and what this launch knows: the `HUIGatewayURL` launch argument (which `UserDefaults` picks up
 from `-HUIGatewayURL <url>`, honoured in debug builds only so another process cannot redirect a release), the address
 the Connect page saved, and the `HUIGatewayFailed` marker that sends the app back to Connect when the address did not
 answer. `nil` means "load the bundled Connect page". Mirrors the Android shell's `Gateway.java`.
 */
enum Gateway {
    static let argumentKey = "HUIGatewayURL"
    static let failedKey = "HUIGatewayFailed"
    private static let defaultsKey = "gatewayUrl"

    private static var defaults: UserDefaults { .standard }

    #if DEBUG
    private static var honoursLaunchArgument: Bool { true }
    #else
    private static var honoursLaunchArgument: Bool { false }
    #endif

    /// The address the bridge should load, or `nil` for the bundled Connect page.
    static func resolve() -> String? {
        if failed() != nil { return nil }
        if let launch = launchExtra() {
            remember(launch)
            return launch
        }
        return GatewayAddress.normalize(remembered())
    }

    static func launchExtra() -> String? {
        guard honoursLaunchArgument else { return nil }
        return GatewayAddress.normalize(defaults.string(forKey: argumentKey))
    }

    /// Only an address this shell remembers counts, so another process cannot force the Connect page or put text on it.
    static func failed() -> String? {
        guard let failed = GatewayAddress.normalize(defaults.string(forKey: failedKey)) else { return nil }
        return failed == GatewayAddress.normalize(remembered()) ? failed : nil
    }

    static func markFailed(_ url: String?) {
        guard let url else { return }
        defaults.set(url, forKey: failedKey)
    }

    static func clearLaunch() {
        defaults.removeObject(forKey: argumentKey)
        defaults.removeObject(forKey: failedKey)
    }

    static func remembered() -> String? { defaults.string(forKey: defaultsKey) }

    static func remember(_ url: String) {
        defaults.set(url, forKey: defaultsKey)
        defaults.removeObject(forKey: failedKey)
    }

    static func forget() {
        defaults.removeObject(forKey: defaultsKey)
        defaults.removeObject(forKey: failedKey)
    }
}
