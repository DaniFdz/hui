package dev.hui.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Where a link the WebView navigates to belongs. Capacitor's own check compares the host and the scheme, so a link to
 * the gateway over the other scheme (`http://gateway` while the app runs on `https://gateway`, which is what a
 * half-configured redirect or an old bookmark produces) would leave the app for the system browser; here it is upgraded
 * to the scheme the app already runs on and stays inside the page. Everything on another host, and every non-web scheme
 * (`mailto:`, `tel:`, `intent:`), goes to the system. `blob:`, `data:` and `about:` are the page's own resources and
 * never leave it.
 *
 * <p>Pure {@link URI} logic on purpose: `android.net.Uri` is a stub on the host JVM, and this decision is what
 * {@code ShellLinksTest} pins.
 */
final class ShellLinks {

    private ShellLinks() {}

    enum Target {
        /** The WebView loads it. */
        IN_APP,
        /** The gateway's own page over the other scheme: load it on the scheme the app runs on. */
        UPGRADE,
        /** Another origin or a non-web scheme: hand it to the system. */
        EXTERNAL
    }

    static Target target(String appUrl, String link) {
        URI app = parse(appUrl);
        URI url = parse(link);
        if (app == null || url == null) return Target.EXTERNAL;
        String scheme = lower(url.getScheme());
        if (scheme.equals("blob") || scheme.equals("data") || scheme.equals("about")) return Target.IN_APP;
        if (!scheme.equals("http") && !scheme.equals("https")) return Target.EXTERNAL;
        if (!sameHost(app, url)) return Target.EXTERNAL;
        return scheme.equals(lower(app.getScheme())) ? Target.IN_APP : Target.UPGRADE;
    }

    /** The same link on the scheme the app runs on, so a scheme-only redirect stays in the page. */
    static String upgraded(String appUrl, String link) {
        URI app = parse(appUrl);
        URI url = parse(link);
        if (app == null || url == null) return link;
        try {
            return new URI(lower(app.getScheme()), url.getUserInfo(), url.getHost(), url.getPort(), url.getPath(), url.getQuery(), url.getFragment())
                .toString();
        } catch (URISyntaxException ex) {
            return link;
        }
    }

    private static boolean sameHost(URI app, URI url) {
        String host = url.getHost();
        if (host == null || !host.equalsIgnoreCase(app.getHost())) return false;
        return samePort(app, url);
    }

    /**
     * Whether two addresses name the same port. An address without one means its scheme's default, so the gateway on
     * `https://host` and a link to `http://host` are one origin whose scheme has to be fixed, not two.
     */
    private static boolean samePort(URI app, URI url) {
        if (app.getPort() == url.getPort()) return true;
        return namedOrDefault(app) && namedOrDefault(url);
    }

    private static boolean namedOrDefault(URI uri) {
        return uri.getPort() == -1 || uri.getPort() == defaultPort(uri.getScheme());
    }

    private static int defaultPort(String scheme) {
        String value = lower(scheme);
        if (value.equals("http")) return 80;
        if (value.equals("https")) return 443;
        return -1;
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
