// The app's type (Settings' Text size as the `textScale` environment value), as the web's Text size sets it: every text style's size is the iOS default for that style times the
// chosen scale exactly (the web scales its root font size), so Settings' Text size changes all text together and in
// proportion. Text that sets its style through `typeface` reports its point size and family as its
// accessibility value once the app was launched with -HUILooks YES (remembered, so a relaunch keeps it), the reading the shared tests' hui.look takes on iOS.
import SwiftUI

extension EnvironmentValues {
    @Entry var textScale = 1.0
}

private let defaultSizes: [Font.TextStyle: Double] = [
    .largeTitle: 34, .title: 28, .title2: 22, .title3: 20, .headline: 17, .body: 17,
    .callout: 16, .subheadline: 15, .footnote: 13, .caption: 12, .caption2: 11,
]

struct Typeface: ViewModifier {
    var style: Font.TextStyle
    var weight: Font.Weight?
    var mono = false
    var reports = false
    @Environment(\.textScale) private var textScale

    func body(content: Content) -> some View {
        let size = (defaultSizes[style] ?? 17) * textScale
        let chosenWeight = weight ?? (style == .headline ? .semibold : .regular)
        let font = Font.system(size: size, weight: chosenWeight, design: mono ? .monospaced : .default)
        if reports, Typeface.reportsLooks {
            content.font(font).accessibilityValue(String("size=\(size);fonts=\(mono ? "System Mono" : "System")"))
        } else {
            content.font(font)
        }
    }

    private static let reportsLooks = {
        let on = UserDefaults.standard.bool(forKey: "HUILooks")
        if on { UserDefaults.standard.set(true, forKey: "HUILooks") }
        return on
    }()
}

extension View {
    func typeface(_ style: Font.TextStyle, weight: Font.Weight? = nil, mono: Bool = false) -> some View {
        modifier(Typeface(style: style, weight: weight, mono: mono))
    }
}

extension Text {
    func typeface(_ style: Font.TextStyle, weight: Font.Weight? = nil, mono: Bool = false) -> some View {
        modifier(Typeface(style: style, weight: weight, mono: mono, reports: true))
    }
}
