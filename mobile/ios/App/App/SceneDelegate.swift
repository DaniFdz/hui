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
    }

    /// `hui://open?path=/sessions/…` loads that path on the gateway the app is on, as the Android shell's deep link does.
    /// Without a gateway the link is ignored, and anything that is not a plain path is refused.
    private func openDeepLink(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "hui", url.host?.lowercased() == "open" else { return false }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = components.queryItems?.first(where: { $0.name == "path" })?.value,
              let gateway = Gateway.resolve(),
              let target = DeepLink.target(path: path, gateway: gateway) else { return true }
        (window?.rootViewController as? HUIBridgeViewController)?.open(target)
        return true
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url, openDeepLink(url) { return }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
