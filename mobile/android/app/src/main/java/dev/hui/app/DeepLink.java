package dev.hui.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * The `hui://open?path=<path>` deep link: how another app — a launcher shortcut, a QR code, a bookmark — opens one
 * screen of the gateway's web UI. The link never carries an address of its own. It is opened over the gateway this app
 * remembers (`Gateway`), so a link cannot point the bridge at a host the user did not connect to, and a launch with no
 * remembered gateway ignores it.
 *
 * <p>Which path a link may name is the shell's decision, not the link's: it must be one the gateway's own address can
 * simply be prefixed to. So the raw value has to start with `/` (it must name a path, not a scheme or a host), and
 * neither it nor its decoded form may carry `://`, a backslash or a character a URL cannot hold. The path is kept
 * percent-encoded because the WebView is what decides which characters to encode; only a copy is decoded, to validate
 * it.
 *
 * <p>Pure {@link URI} logic, so {@code DeepLinkTest} pins it on the host JVM (`android.net.Uri` is a stub there).
 */
final class DeepLink {

    /** The link's scheme and host: `hui://open?path=…`. */
    static final String SCHEME = "hui";
    static final String HOST = "open";

    private DeepLink() {}

    /** The path the link names, still percent-encoded, or `null` when it is not a link this app opens. */
    static String path(String link) {
        URI uri = parse(link);
        if (uri == null) return null;
        if (!SCHEME.equalsIgnoreCase(lower(uri.getScheme())) || !HOST.equalsIgnoreCase(lower(uri.getHost()))) return null;
        String raw = queryValue(uri.getRawQuery(), "path");
        if (raw == null || !raw.startsWith("/") || raw.indexOf("://") >= 0) return null;
        for (int at = 0; at < raw.length(); at++) {
            char character = raw.charAt(at);
            // A URL cannot carry these; a space, a tab or an escape would end the address the app builds.
            if (character <= 0x20 || character == 0x7F || character == '\\') return null;
        }
        // `%3A%2F%2F` is `://` once decoded, and `%2F` at the front is a slash the app's own prefix would break against.
        String decoded = decode(raw);
        if (!decoded.startsWith("/") || decoded.indexOf("://") >= 0) return null;
        return raw;
    }

    /** The screen the link names, on the gateway this launch loaded: `gateway + path`. */
    static String url(String gateway, String path) {
        if (gateway == null || path == null) return null;
        return gateway + path;
    }

    /** One query parameter, by name. An empty value never counts, so `?path=` names nothing. */
    private static String queryValue(String query, String name) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            int assign = part.indexOf('=');
            if (assign <= 0) continue;
            if (!part.substring(0, assign).equalsIgnoreCase(name)) continue;
            String value = part.substring(assign + 1);
            return value.isEmpty() ? null : value;
        }
        return null;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            return value;
        }
    }

    private static URI parse(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value.trim());
            return uri.getScheme() == null ? null : uri;
        } catch (URISyntaxException ex) {
            return null;
        }
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
