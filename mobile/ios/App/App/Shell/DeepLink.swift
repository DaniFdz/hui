import Foundation

/**
 A `hui://open?path=` link, turned into the address it opens on the gateway the app is on. The path must be a plain path —
 it starts with `/`, carries no `://` raw or percent-encoded and no backslashes or whitespace — so a link cannot send the
 app to another origin. Mirrors the Android shell's `DeepLink.java`.
 */
enum DeepLink {
    static func target(path: String?, gateway: String) -> URL? {
        guard let path, path.hasPrefix("/") else { return nil }
        let decoded = path.removingPercentEncoding ?? path
        for candidate in [path, decoded] {
            if candidate.contains("://") || candidate.contains("\\") || candidate.contains(" ") || candidate.contains("\t") {
                return nil
            }
        }
        return URL(string: gateway + path)
    }
}
