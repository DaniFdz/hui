package dev.hui.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * A gateway address the native side accepts: `http://` or `https://`, with a host, without credentials, without a
 * trailing slash. The Connect page checks the same thing before it calls the app; this is the check the app owns, so a
 * page cannot point the bridge at a `file:` or `javascript:` URL.
 */
final class GatewayAddress {

    private GatewayAddress() {}

    /** The normalized address, or `null` when the value is not a gateway address. */
    static String normalize(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        String lower = value.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) return null;
        try {
            URI uri = new URI(value);
            if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
            if (uri.getUserInfo() != null) return null;
            if (uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            String path = uri.getPath() == null ? "" : uri.getPath();
            while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
            return uri.getScheme().toLowerCase(Locale.ROOT) + "://" + uri.getAuthority().toLowerCase(Locale.ROOT) + path;
        } catch (URISyntaxException | IllegalArgumentException ex) {
            return null;
        }
    }
}
