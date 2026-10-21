// Which gateway the app talks to, as the web's settings and update controllers own it: the URL (from the
// -HUIGatewayURL launch argument or typed in, remembered under the same key), and the version check against
// GET /__hui/update that decides whether the gateway is supported, newer, older or an unversioned development build.
import Foundation
import Observation

@MainActor
@Observable
final class GatewayModel {
    static let urlKey = "HUIGatewayURL"

    enum State: Equatable {
        case disconnected
        case connecting
        case failed(String)
        case connected
    }

    var url: String
    private(set) var state: State = .disconnected
    private(set) var client: GatewayClient?
    private(set) var notice: String?

    let appVersion: String

    init(defaults: UserDefaults = .standard, appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0") {
        url = defaults.string(forKey: Self.urlKey) ?? ""
        self.appVersion = appVersion
    }

    func connect(defaults: UserDefaults = .standard) async {
        guard let base = URL(string: url.trimmingCharacters(in: .whitespaces)), base.scheme == "http" || base.scheme == "https", base.host() != nil else {
            state = .failed("Enter the gateway's address, such as http://127.0.0.1:4000.")
            return
        }
        state = .connecting
        let client = GatewayClient(baseURL: base)
        do {
            let update = try await client.send("/__hui/update", as: API.UpdateSnapshot.self)
            notice = Self.versionNotice(gateway: update.currentVersion, app: appVersion)
            self.client = client
            defaults.set(base.absoluteString, forKey: Self.urlKey)
            state = .connected
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    nonisolated static func versionNotice(gateway: String?, app: String) -> String? {
        guard let gateway else { return "Development gateway: its version is unverified." }
        switch gateway.compare(app, options: .numeric) {
        case .orderedAscending: return "This gateway runs HUI \(gateway), older than this app supports (\(app)). Update the gateway."
        case .orderedDescending: return "This gateway runs HUI \(gateway), newer than this app (\(app))."
        case .orderedSame: return nil
        }
    }
}
