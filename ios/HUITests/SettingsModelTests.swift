// The theme file reading: #rrggbb tokens become colours, anything else is refused, and a mode without its background
// or foreground gives no palette.
import SwiftUI
import Testing
@testable import HUI

struct SettingsModelTests {
    @Test func readsOnlySixDigitHexColours() {
        #expect(Color(hex: "#282a36") == Color(.sRGB, red: 40 / 255, green: 42 / 255, blue: 54 / 255))
        #expect(Color(hex: "282a36") == nil)
        #expect(Color(hex: "#fff") == nil)
        #expect(Color(hex: "oklch(0.2 0 0)") == nil)
    }

    @Test func aPaletteNeedsItsBackgroundAndForegroundAndFallsBackForTheRest() {
        let palette = ThemePalette(["background": .string("#000000"), "foreground": .string("#ffffff")])
        #expect(palette?.card == Color(hex: "#000000"))
        #expect(palette?.primary == Color(hex: "#ffffff"))
        #expect(ThemePalette(["background": .string("#000000")]) == nil)
    }
}
