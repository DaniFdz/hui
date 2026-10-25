// The app's type: Settings' Text size as the `textScale` environment value, the interface and chat faces as `uiFont`
// and `chatFont` (the family names the core's TYPEFACES carry, an empty one for the system face), and the bundled
// families CoreText answers for as `loadedFonts`. As the web's Text size does, every text style's size is the iOS
// default for that style times the chosen scale exactly, so Settings' Text size changes all text together and in
// proportion. Text that sets its style through `typeface` reports its point size, families and the loaded faces as its
// accessibility value once the app was launched with -HUILooks YES (remembered, so a relaunch keeps it), the reading
// the shared tests' hui.look takes on iOS; a terminal preview reports the whole stack it draws with, as the web's
// computed font-family does.
import SwiftUI

extension EnvironmentValues {
    @Entry var textScale = 1.0
    @Entry var uiFont = ""
    @Entry var chatFont = ""
    @Entry var loadedFonts: [String] = []
}

private let defaultSizes: [Font.TextStyle: Double] = [
    .largeTitle: 34, .title: 28, .title2: 22, .title3: 20, .headline: 17, .body: 17,
    .callout: 16, .subheadline: 15, .footnote: 13, .caption: 12, .caption2: 11,
]

struct Typeface: ViewModifier {
    var style: Font.TextStyle
    var weight: Font.Weight?
    var mono = false
    var prose = false
    var stack: [String] = []
    var reports = false
    @Environment(\.textScale) private var textScale
    @Environment(\.uiFont) private var uiFont
    @Environment(\.chatFont) private var chatFont
    @Environment(\.loadedFonts) private var loadedFonts

    func body(content: Content) -> some View {
        let size = (defaultSizes[style] ?? 17) * textScale
        let chosenWeight = weight ?? (style == .headline ? .semibold : .regular)
        let families = stack.isEmpty ? [mono ? "JetBrains Mono" : prose ? chatFont : uiFont].filter { !$0.isEmpty } : stack
        let font = families.first.map { Font.custom($0, size: size).weight(chosenWeight) }
            ?? Font.system(size: size, weight: chosenWeight, design: mono ? .monospaced : .default)
        if reports, Typeface.reportsLooks {
            content.font(font).accessibilityValue(Typeface.report(size: size, families: families.isEmpty ? ["System"] : families, loaded: loadedFonts))
        } else {
            content.font(font)
        }
    }

    static func report(size: Double, families: [String], loaded: [String]) -> String {
        "size=\(size);fonts=\(families.joined(separator: ","));loaded=\(loaded.joined(separator: ","))"
    }

    private static let reportsLooks = {
        let on = UserDefaults.standard.bool(forKey: "HUILooks")
        if on { UserDefaults.standard.set(true, forKey: "HUILooks") }
        return on
    }()
}

extension View {
    func typeface(_ style: Font.TextStyle, weight: Font.Weight? = nil, mono: Bool = false, prose: Bool = false, stack: [String] = []) -> some View {
        modifier(Typeface(style: style, weight: weight, mono: mono, prose: prose, stack: stack))
    }

    /// The type a container draws its rows with, for the shared tests' look of a list rather than one of its texts.
    func typefaceReport(_ style: Font.TextStyle) -> some View {
        modifier(TypefaceReport(style: style))
    }
}

extension Text {
    func typeface(_ style: Font.TextStyle, weight: Font.Weight? = nil, mono: Bool = false, prose: Bool = false, stack: [String] = []) -> some View {
        modifier(Typeface(style: style, weight: weight, mono: mono, prose: prose, stack: stack, reports: true))
    }
}

private struct TypefaceReport: ViewModifier {
    var style: Font.TextStyle
    @Environment(\.textScale) private var textScale
    @Environment(\.uiFont) private var uiFont
    @Environment(\.loadedFonts) private var loadedFonts

    func body(content: Content) -> some View {
        content.accessibilityValue(Typeface.report(size: (defaultSizes[style] ?? 17) * textScale,
                                                    families: uiFont.isEmpty ? ["System"] : [uiFont], loaded: loadedFonts))
    }
}
