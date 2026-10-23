// The core's theme mapping as the app decodes it: any colour format the web accepts becomes a #rrggbb palette per
// mode, the variant comes with it, and the shared Settings words load.
import SwiftUI
import Testing
@testable import HUI

struct SettingsModelTests {
    @Test func readsOnlySixDigitHexColours() {
        #expect(Color(hex: "#282a36") == Color(.sRGB, red: 40 / 255, green: 42 / 255, blue: 54 / 255))
        #expect(Color(hex: "#fff") == nil)
    }

    @Test func themePalettesComeFromTheCore() async throws {
        let core = try HUICore.bundled()
        let file = API.JSONValue.object(["dark": .object(["background": .string("oklch(0 0 0)"), "foreground": .string("hsl(0 0% 100%)")])])
        let palettes = try await core.themePalettes(file, accent: "")
        #expect(palettes?.variant == "dark")
        #expect(palettes?.dark?.background == "#000000")
        #expect(palettes?.dark?.foreground == "#ffffff")
        #expect(palettes?.light == nil)
        #expect(try await core.effectiveColorScheme("light", variant: "dark") == "dark")
    }

    @Test func settingsWordsComeFromTheCore() async throws {
        let copy = try await HUICore.bundled().settingsCopy()
        #expect(copy.noMatch == "No settings match.")
        #expect(copy.scales["125"] == "XL")
        #expect(copy.modes["system"] == "System")
    }
}
