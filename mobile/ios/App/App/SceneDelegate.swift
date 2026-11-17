import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = HUIBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        if let url = connectionOptions.urlContexts.first?.url { _ = openDeepLink(url) }
        #if DEBUG
        // `simctl openurl` leaves iOS's "Open in HUI?" confirmation on screen, which the screenshot oracle cannot
        // dismiss, so CI launches with the link the system would deliver. Debug-only, like `-HUIGatewayURL`.
        if connectionOptions.urlContexts.isEmpty,
           let raw = UserDefaults.standard.string(forKey: "HUIURL"),
           let url = URL(string: raw) {
            _ = openDeepLink(url)
        }
        #endif
    }

    /// `hui://open?path=/sessions/…` loads that path on the gateway the app is on, as the Android shell's deep link does.
    /// `hui://share?url=…` starts a New Session with what a Share Extension was given. Without a gateway a link is ignored
    /// (the Connect page has no screens), and anything that is not a plain path or a share HUI takes is refused.
    private func openDeepLink(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "hui" else { return false }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let query: (String) -> String? = { name in components.queryItems?.first(where: { $0.name == name })?.value }
        switch url.host?.lowercased() {
        case "open":
            guard let path = query("path"),
                  let gateway = Gateway.resolve(),
                  let target = DeepLink.target(path: path, gateway: gateway) else { return true }
            (window?.rootViewController as? HUIBridgeViewController)?.open(target)
            return true
        case "share":
            guard let value = query("url"),
                  let gateway = Gateway.resolve(),
                  let target = DeepLink.share(url: value, gateway: gateway) else { return true }
            (window?.rootViewController as? HUIBridgeViewController)?.open(target)
            return true
        default:
            return false
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url, openDeepLink(url) { return }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
