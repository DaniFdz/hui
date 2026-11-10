import Foundation

/**
 What the shell remembers and what this launch knows: the `HUIGatewayURL` launch argument (which `UserDefaults` picks up
 from `-HUIGatewayURL <url>`, honoured in debug builds only so another process cannot redirect a release), the address
 the Connect page saved, and the address that did not answer this launch, which sends the app back to Connect. `nil`
 means "load the bundled Connect page". Mirrors the Android shell's `Gateway.java`, including the part that matters: the
 launch argument and the failure marker live for one launch, in memory, so a relaunch retries the gateway and nothing
 another process writes can pin the app to an address.
 */
enum Gateway {
    static let argumentKey = "HUIGatewayURL"
    static let failedKey = "HUIGatewayFailed"
    private static let defaultsKey = "gatewayUrl"

    /// The launch argument, read once: `UserDefaults`' argument domain cannot be cleared, so a consumed argument is
    /// remembered here instead of being removed from it.
    private static var launchArgument: String?? = nil
    /// The address that did not answer on this launch. Android keeps it on the launch Intent; this is its analogue.
    private static var failedThisLaunch: String?
    private static var resolved: String??

    private static var defaults: UserDefaults { .standard }

    #if DEBUG
    private static let honoursLaunchArgument = true
    #else
    private static let honoursLaunchArgument = false
    #endif

    /// The address the bridge should load, or `nil` for the bundled Connect page. Cheap after the first call.
    static func resolve() -> String? {
        if let cached = resolved { return cached }
        let address = compute()
        resolved = .some(address)
        return address
    }

    private static func compute() -> String? {
        if failedThisLaunch != nil { return nil }
        if launchArgument == nil {
            launchArgument = .some(honoursLaunchArgument ? GatewayAddress.normalize(defaults.string(forKey: argumentKey)) : nil)
        }
        if let launch = launchArgument ?? nil {
            remember(launch)
            return launch
        }
        return GatewayAddress.normalize(remembered())
    }

    /// The address that did not answer on this launch, when the app fell back to the Connect page.
    static func failed() -> String? {
        guard let failed = failedThisLaunch else { return nil }
        return failed == GatewayAddress.normalize(remembered()) ? failed : nil
    }

    static func markFailed(_ url: String?) {
        guard let url else { return }
        failedThisLaunch = GatewayAddress.normalize(url)
        resolved = .some(nil)
    }

    /// Drop what this launch carried — a consumed launch argument and the failure marker — so the next resolve reads the
    /// address the Connect page saves.
    static func clearLaunch() {
        launchArgument = .some(nil)
        failedThisLaunch = nil
        resolved = nil
    }

    static func remembered() -> String? { defaults.string(forKey: defaultsKey) }

    static func remember(_ url: String) {
        defaults.set(url, forKey: defaultsKey)
        failedThisLaunch = nil
        resolved = nil
    }

    static func forget() {
        defaults.removeObject(forKey: defaultsKey)
        clearLaunch()
    }
}
