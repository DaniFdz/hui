// Which gateway the app talks to, as the web's settings and update controllers own it: the URL (from the
// -HUIGatewayURL launch argument or typed in, remembered under the same key), and the version check against
// GET /__hui/update that decides whether the gateway is supported, newer, older or an unversioned development build.
// Versions compare as `hui update` compares them: a prerelease is older than its release.
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
        guard state != .connecting else { return }
        guard let base = URL(string: url.trimmingCharacters(in: .whitespaces)), base.scheme == "http" || base.scheme == "https", base.host() != nil else {
            state = .failed("Enter the gateway's address, such as http://127.0.0.1:4000.")
            return
        }
        state = .connecting
        let client = GatewayClient(baseURL: base)
        do {
            let update = try await client.get("/__hui/update", as: API.UpdateSnapshot.self)
            notice = Self.versionNotice(gateway: update.currentVersion, app: appVersion)
            self.client = client
            defaults.set(base.absoluteString, forKey: Self.urlKey)
            state = .connected
        } catch where error is DecodingError || (error as? GatewayError)?.status == 404 {
            state = .failed("This address doesn't answer as a HUI gateway.")
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    nonisolated static func versionNotice(gateway: String?, app: String) -> String? {
        guard let gateway else { return "Development gateway: its version is unverified." }
        switch order(gateway, app) {
        case .orderedAscending: return "This gateway runs HUI \(gateway), older than this app supports (\(app)). Update the gateway."
        case .orderedDescending: return "This gateway runs HUI \(gateway), newer than this app (\(app))."
        case .orderedSame: return nil
        }
    }

    private nonisolated static func order(_ left: String, _ right: String) -> ComparisonResult {
        let left = left.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let right = right.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let core = left[0].compare(right[0], options: .numeric)
        if core != .orderedSame { return core }
        switch (left.dropFirst().first, right.dropFirst().first) {
        case let (leftPrerelease?, rightPrerelease?): return leftPrerelease.compare(rightPrerelease, options: .numeric)
        case (nil, nil): return .orderedSame
        case (nil, _): return .orderedDescending
        case (_, nil): return .orderedAscending
        }
    }
}
