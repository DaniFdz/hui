import Foundation

/**
 A `hui://open?path=` link, turned into the address it opens on the gateway the app is on. The path must be a plain path —
 it starts with `/`, carries no `://` raw or percent-encoded and no backslashes or whitespace — so a link cannot send the
 app to another origin. A `hui://share?url=` link becomes the New Session address that starts a session with what was
 shared. Mirrors the Android shell's `DeepLink.java`. This file compiles in the app and in the Share Extension.
 */
enum DeepLink {
    /// What a share may carry. New Session's composer takes 8 000 characters (the same cap `messageShare` applies to a
    /// message HUI shares out), and the query the value becomes stays under 32 KiB so no path refuses the address.
    static let maxShareCharacters = 8_000
    static let maxShareQueryBytes = 32 * 1024

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

    /**
     `<gateway>/new-session?share=<value>`, the session that starts with a web address or some text the Share Extension
     sent. The value may hold any character a page had, so `URLQueryItem` encodes it — exactly once. `.urlQueryAllowed`
     is never the encoder: it keeps `&` and `=`, which would turn one value into several query items, and `URLComponents`
     leaves a literal `+`, which a form decoder reads as a space, so the one character it skipped is escaped here.
     */
    static func share(url: String?, gateway: String) -> URL? {
        guard let url, let query = shareQuery(url) else { return nil }
        guard var components = URLComponents(string: gateway + "/new-session") else { return nil }
        components.percentEncodedQuery = query
        return components.url
    }

    /**
     The `share=<value>` query the app accepts, encoded once, or nothing past either cap. One helper, because the
     extension has to know what the app will take before it builds a link the operator watches open.
     */
    static func shareQuery(_ value: String) -> String? {
        guard !value.isEmpty, value.count <= maxShareCharacters else { return nil }
        guard !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        // `hui://share` is the link the extension builds; the base only gives `URLComponents` a URL to carry the query.
        guard var components = URLComponents(string: "hui://share") else { return nil }
        components.queryItems = [URLQueryItem(name: "share", value: value)]
        guard let query = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B"),
              query.utf8.count <= maxShareQueryBytes else { return nil }
        return query
    }

    /**
     The value cut to what the app accepts, on a character boundary: 8 000 characters, and a link whose encoded query
     stays under 32 KiB. Text outside ASCII reaches the byte cap first — a CJK character is nine bytes once escaped —
     and trimming it here means the extension never sends a link the app would refuse into an empty New Session.
     */
    static func fittedShare(_ value: String) -> String? {
        let limited = String(value.prefix(maxShareCharacters))
        if shareQuery(limited) != nil { return limited }
        var accepted = 0
        var rejected = limited.count
        while accepted < rejected {
            let middle = (accepted + rejected + 1) / 2
            if shareQuery(String(limited.prefix(middle))) != nil { accepted = middle } else { rejected = middle - 1 }
        }
        return accepted > 0 ? String(limited.prefix(accepted)) : nil
    }
}
