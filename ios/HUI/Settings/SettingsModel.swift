// The gateway's settings document, as the web's settings controller holds it: read once the gateway connects, changed
// here at once and written back whole with PUT /__hui/settings. A write the gateway refuses keeps the change for now
// and sets saveFailed, so Settings says it was not saved, and the next start reads what the gateway kept.
import Observation
import SwiftUI

@MainActor
@Observable
final class SettingsModel {
    private(set) var settings: API.Settings?
    private(set) var saveFailed = false
    private var writes = 0

    func load(_ client: GatewayClient) async {
        settings = try? await client.get("/__hui/settings")
    }

    func change(_ client: GatewayClient?, _ edit: (inout API.Settings) -> Void) {
        guard var next = settings, let client else { return }
        edit(&next)
        settings = next
        writes += 1
        let write = writes
        Task {
            let saved = try? await client.send("PUT", "/__hui/settings", body: next, as: API.Settings.self)
            guard write == writes else { return }
            saveFailed = saved == nil
        }
    }

    var colorScheme: ColorScheme? {
        switch settings?.themeMode {
        case .dark: .dark
        case .light: .light
        default: nil
        }
    }

    var dynamicTypeSize: DynamicTypeSize {
        switch settings?.textScale {
        case ._90: .medium
        case ._110: .xLarge
        case ._125: .xxLarge
        case ._140: .xxxLarge
        default: .large
        }
    }
}
