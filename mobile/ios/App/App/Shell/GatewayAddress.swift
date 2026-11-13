import Foundation

/**
 The gateway address the app accepts: `http://` or `https://`, with a host, without credentials, without a query or a
 fragment, and without trailing slashes. It is the same rule as the Android shell's `GatewayAddress.java` and the Connect
 page's `normalizeGateway`. Those two read `mobile/gateway-addresses.txt`; the Swift rule has no test target, so the
 ios-smoke job is its only proof and the contract test keeps its shape in step with the others.
 */
enum GatewayAddress {
    static func normalize(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        let lower = value.lowercased()
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else { return nil }
        guard var components = URLComponents(string: value) else { return nil }
        guard let host = components.host, !host.isEmpty else { return nil }
        guard components.user == nil, components.password == nil else { return nil }
        guard components.query == nil, components.fragment == nil else { return nil }
        guard let scheme = components.scheme?.lowercased() else { return nil }
        components.query = nil
        components.fragment = nil
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        // A literal IPv6 host comes back unbracketed, and a URL needs the brackets back.
        var authority = host.contains(":") ? "[\(host.lowercased())]" : host.lowercased()
        if let port = components.port { authority += ":\(port)" }
        return "\(scheme)://\(authority)\(path)"
    }
}
