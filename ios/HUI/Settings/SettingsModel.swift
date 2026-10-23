// The gateway's settings document, as the web's settings controller holds it: read once the gateway connects, changed
// here at once and written back whole with PUT /__hui/settings. A write the gateway refuses keeps the change for now
// and sets saveFailed, so Settings says it was not saved; writes go one at a time, in order, and the next start reads what the gateway kept. The chosen
// theme's file says which variants it carries (a theme with one variant fixes the colour mode, as on the web) and the
// colours of each: its background, foreground, card and primary tokens, written as #rrggbb, become the app's colours,
// and the accent override, when set, its tint.
import Observation
import SwiftUI

@MainActor
@Observable
final class SettingsModel {
    private(set) var settings: API.Settings?
    private(set) var saveFailed = false
    private(set) var variant = "both"
    private(set) var themes: [API.ThemeRef] = []
    private(set) var palettes: [String: ThemePalette] = [:]
    private var writes = 0
    private var writing: Task<Void, Never>?

    func load(_ client: GatewayClient) async {
        settings = try? await client.get("/__hui/settings")
        themes = (try? await client.get("/__hui/themes", as: API.ThemesResponse.self))?.themes ?? []
        await loadTheme(client)
    }

    func choose(theme: String, _ client: GatewayClient?) async {
        change(client) { $0.theme = theme }
        if let client { await loadTheme(client) }
    }

    func palette(_ scheme: ColorScheme) -> ThemePalette? {
        palettes[scheme == .dark ? "dark" : "light"] ?? palettes.values.first
    }

    private func loadTheme(_ client: GatewayClient) async {
        let theme = settings?.theme
        let file: API.JSONValue? = if let ref = themes.first(where: { $0.id == theme }) { try? await client.get(ref.url) } else { nil }
        guard settings?.theme == theme else { return }
        guard case .object(let file) = file else {
            variant = "both"
            palettes = [:]
            return
        }
        let modes = if case .object(let vars) = file["cssVars"] { vars } else { file }
        variant = modes["light"] == nil && modes["dark"] != nil ? "dark" : modes["dark"] == nil && modes["light"] != nil ? "light" : "both"
        palettes = modes.compactMapValues { mode in
            guard case .object(let tokens) = mode else { return nil }
            return ThemePalette(tokens)
        }
    }

    func change(_ client: GatewayClient?, _ edit: (inout API.Settings) -> Void) {
        guard var next = settings, let client else { return }
        edit(&next)
        settings = next
        writes += 1
        let write = writes
        let previous = writing
        writing = Task {
            await previous?.value
            let saved = try? await client.send("PUT", "/__hui/settings", body: next, as: API.Settings.self)
            guard write == writes else { return }
            saveFailed = saved == nil
        }
    }

    var colorScheme: ColorScheme? {
        switch variant == "both" ? settings?.themeMode.rawValue : variant {
        case "dark": .dark
        case "light": .light
        default: nil
        }
    }

    var accent: Color? {
        settings.flatMap { Color(hex: $0.accent) }
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

struct ThemePalette: Equatable {
    var background: Color
    var foreground: Color
    var card: Color
    var primary: Color

    init?(_ tokens: [String: API.JSONValue]) {
        func color(_ name: String) -> Color? {
            if case .string(let hex) = tokens[name] { Color(hex: hex) } else { nil }
        }
        guard let background = color("background"), let foreground = color("foreground") else { return nil }
        self.background = background
        self.foreground = foreground
        card = color("card") ?? background
        primary = color("primary") ?? foreground
    }
}

extension Color {
    init?(hex: String) {
        guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(.sRGB, red: Double(value >> 16 & 0xff) / 255, green: Double(value >> 8 & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}

struct Themed: ViewModifier {
    let settings: SettingsModel
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = settings.palette(scheme)
        content
            .scrollContentBackground(palette == nil ? .automatic : .hidden)
            .background(palette?.background ?? .clear)
            .foregroundStyle(palette?.foreground ?? .primary)
            .tint(settings.accent ?? palette?.primary)
            .environment(\.themeCard, palette?.card)
    }
}

extension EnvironmentValues {
    @Entry var themeCard: Color?
}
