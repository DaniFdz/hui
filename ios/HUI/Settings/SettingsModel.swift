// The gateway's settings document, as the web's settings controller holds it: read once the gateway connects, changed
// here at once and written back whole with PUT /__hui/settings. A write the gateway refuses keeps the change for now
// and sets saveFailed, so Settings says it was not saved; writes go one at a time, in order, and the next start reads
// what the gateway kept. A theme is chosen only once its file loads, so one that fails leaves the previous theme. The chosen theme's file goes through the core's themePalettes, the mapping the web applies, so
// every colour format the web accepts works: it says which variants the theme carries (a theme with one variant fixes
// the colour mode, through the core's effectiveColorScheme) and each mode's background, text, card and accent, the
// accent override solved to read on that mode's page as on the web.
import Observation
import SwiftUI

@MainActor
@Observable
final class SettingsModel {
    private(set) var settings: API.Settings?
    private(set) var saveFailed = false
    private(set) var copy = SettingsCopy()
    private(set) var variant = "both"
    private(set) var colorScheme: ColorScheme?
    private(set) var themes: [API.ThemeRef]?
    private(set) var palettes = ThemePalettes()
    private let core: HUICore
    private var themeFile: API.JSONValue?
    private var writes = 0
    private var writing: Task<Void, Never>?
    private var looks = 0

    init(core: HUICore) {
        self.core = core
        Task { if let copy = try? await core.settingsCopy() { self.copy = copy } }
    }

    func load(_ client: GatewayClient) async {
        settings = try? await client.get("/__hui/settings")
        themes = (try? await client.get("/__hui/themes", as: API.ThemesResponse.self))?.themes
        await loadTheme(client)
    }

    func choose(theme: String, _ client: GatewayClient?) async {
        guard let client, let ref = themes?.first(where: { $0.id == theme }), let file = try? await client.get(ref.url, as: API.JSONValue.self) else { return }
        change(client) { $0.theme = theme }
        themeFile = file
        await refreshLook()
    }

    func palette(_ scheme: ColorScheme) -> ThemePalette? {
        (scheme == .dark ? palettes.dark : palettes.light) ?? palettes.dark ?? palettes.light
    }

    private func loadTheme(_ client: GatewayClient) async {
        let theme = settings?.theme
        let file: API.JSONValue? = if let ref = themes?.first(where: { $0.id == theme }) { try? await client.get(ref.url) } else { nil }
        guard settings?.theme == theme else { return }
        themeFile = file
        await refreshLook()
    }

    private func refreshLook() async {
        looks += 1
        let look = looks
        let accent = settings?.accent ?? ""
        let found: ThemePalettes? = if let themeFile { try? await core.themePalettes(themeFile, accent: accent) } else { nil }
        let variant = found?.variant ?? "both"
        let scheme = (try? await core.effectiveColorScheme(settings?.themeMode.rawValue ?? "system", variant: variant)) ?? ""
        guard look == looks else { return }
        self.variant = variant
        palettes = found ?? ThemePalettes()
        colorScheme = scheme == "dark" ? .dark : scheme == "light" ? .light : nil
    }

    func change(_ client: GatewayClient?, _ edit: (inout API.Settings) -> Void) {
        guard var next = settings, let client else { return }
        edit(&next)
        let looksChanged = next.theme != settings?.theme || next.accent != settings?.accent || next.themeMode != settings?.themeMode
        settings = next
        writes += 1
        let write = writes
        if looksChanged { Task { await refreshLook() } }
        let previous = writing
        writing = Task {
            await previous?.value
            let saved = try? await client.send("PUT", "/__hui/settings", body: next, as: API.Settings.self)
            guard write == writes else { return }
            saveFailed = saved == nil
        }
    }

    var accent: Color? {
        settings.flatMap { Color(hex: $0.accent) }
    }

    var textScale: Double {
        (settings?.textScale.rawValue ?? 100) / 100
    }
}

struct ThemePalettes: Decodable, Equatable, Sendable {
    var variant = "both"
    var light: ThemePalette?
    var dark: ThemePalette?
}

struct ThemePalette: Decodable, Equatable, Sendable {
    var background: String
    var foreground: String
    var card: String
    var accent: String
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
            .background(palette.flatMap { Color(hex: $0.background) } ?? .clear)
            .foregroundStyle(palette.flatMap { Color(hex: $0.foreground) } ?? .primary)
            .tint(palette.flatMap { Color(hex: $0.accent) } ?? settings.accent)
            .environment(\.themeCard, palette.flatMap { Color(hex: $0.card) })
    }
}

extension EnvironmentValues {
    @Entry var themeCard: Color?
}
