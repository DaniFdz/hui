// The faces HUI bundles for the interface, the chat and the terminal, as the web's public/fonts ships them: the same
// nine OpenClaw faces plus System, converted once from that folder's woff2 subsets (see the README beside them) and
// declared in Info.plist's UIAppFonts, so CoreText knows them at launch, `Font.custom` draws them and the terminal
// preview's Nerd Font symbols come from HUI's own symbols face. The catalogue itself, its labels and each face's
// family name come from the core (the web's TYPEFACES and typefaceFamily), never from copies here.
import UIKit

struct TypefaceFace: Decodable, Hashable, Sendable {
    var id: String
    var label: String
    var note: String
    var family: String?
}

struct AccentPreset: Decodable, Hashable, Sendable {
    var id: String
    var label: String
    var value: String
}

enum Fonts {
    /// The bundled families CoreText answers for, which is what the app can draw and what `loaded` reports.
    static func loaded(_ families: [String]) -> [String] {
        families.filter { UIFont(name: $0, size: 12) != nil }
    }
}