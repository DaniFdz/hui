import Foundation

/**
 A `hui://open?path=` link, turned into the address it opens on the gateway the app is on. The path must be a plain path —
 it starts with `/`, carries no `://` raw or percent-encoded and no backslashes or whitespace — so a link cannot send the
 app to another origin. A `hui://share?url=` link becomes the New Session address that starts a session with what was
 shared. Mirrors the Android shell's `DeepLink.java`. This file compiles in the app and in the Share Extension.
 */
enum DeepLink {
    /// What a share may carry. New Session's composer takes 8 000 characters (the same cap `messageShare` applies to a
    /// message HUI shares out), and the query the value becomes stays under 12 KiB. **The byte bound is the gateway's:**
    /// it is Node's `createServer`, whose 16 KiB request-head budget (`maxHeaderSize`, the default) counts the request
    /// line this query rides in, and the other headers need the remainder. Past it the gateway answers the page's own
    /// navigation with 431 and the app treats it as a gateway that did not answer, so the extension cuts the words to the
    /// budget instead.
    static let maxShareCharacters = 8_000
    static let maxShareQueryBytes = 12 * 1024

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
     sent. The value may hold the words, line breaks and tabs a page had, so `URLQueryItem` encodes it — exactly once.
     `.urlQueryAllowed` is never the encoder: it keeps `&` and `=`, which would turn one value into several query items,
     and `URLComponents` leaves a literal `+`, which a form decoder reads as a space, so the one character it skipped is
     escaped here.
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

     A `\r\n`, or a bare `\r`, is the `\n` it means, so a value written on more than one line stays readable and both
     phones send one share as one value; `\n` and `\t` are then kept, and every other control character refuses the
     value, as the Android half's `ShareTarget` refuses one.
     */
    static func shareQuery(_ value: String) -> String? {
        let shared = value.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        guard !shared.isEmpty, shared.count <= maxShareCharacters else { return nil }
        guard !shared.unicodeScalars.contains(where: refuses) else { return nil }
        // `hui://share` is the link the extension builds; the base only gives `URLComponents` a URL to carry the query.
        guard var components = URLComponents(string: "hui://share") else { return nil }
        components.queryItems = [URLQueryItem(name: "share", value: shared)]
        guard let query = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B"),
              query.utf8.count <= maxShareQueryBytes else { return nil }
        return query
    }

    /// Whether a scalar refuses the share: every control character — C0, DEL and C1, the ranges `Character.CONTROL`
    /// names on the Android half — except the `\n` and `\t` a share keeps. `CharacterSet.controlCharacters` is wider
    /// than that, because it also carries the format characters an emoji sequence is built from, and a share may hold
    /// one of those.
    private static func refuses(_ scalar: Unicode.Scalar) -> Bool {
        if scalar == "\n" || scalar == "\t" { return false }
        return scalar.value < 0x20 || (0x7F...0x9F).contains(scalar.value)
    }

    /**
     The value cut to what the app accepts, on a character boundary: 8 000 characters, and a link whose encoded query
     stays under 12 KiB. Text outside ASCII reaches the byte cap first — a CJK character is nine bytes once escaped —
     and trimming it here means the extension never sends a link the app would refuse into an empty New Session; the
     share opens with the first part instead of not at all, as the Android half's cut address does.
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
